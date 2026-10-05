'use strict';
const crypto=require('node:crypto');
function createRouter({store,cfg,fal,env=process.env}) {
  const router=require('express').Router();
  const secret=env.ADMIN_PASSWORD;
  if(!secret || secret.length<12)throw new Error('Reel admin requires an existing ADMIN_PASSWORD of at least 12 characters');
  const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);};
  const csrf=(id,period=Math.floor(Date.now()/3600000))=>crypto.createHmac('sha256',secret).update(`reels:${id}:${period}`).digest('hex');
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex, nofollow');
    const raw=Buffer.from((req.get('authorization')||'').replace(/^Basic /,''),'base64').toString();
    const separator=raw.indexOf(':');
    if(!equal(separator>=0?raw.slice(separator+1):'',secret))return res.status(401).set('WWW-Authenticate','Basic realm="Florida Buzz Reel review"').send('Admin authentication required');
    next();
  });
  const handle=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.get('/',handle(async(req,res)=>res.render('admin-reels',{packages:await store.packages(),totals:await store.totals(),cfg})));
  router.get('/:id',handle(async(req,res)=>{
    const pkg=await store.package(req.params.id);let gens=await store.generations(pkg);
    // Reconcile known failed/held requests too; this is a free billing GET,
    // never a generation or a retry of the original POST.
    if(fal) {
      try {
        for(const g of gens.filter(g=>g.request_id&&g.actual_usd===null&&['COMPLETE','FAILED'].includes(g.status))) {
          const billing=await fal.actual(g);if(billing)await store.recordBilling(g,billing);
        }
        gens=await store.generations(pkg);
      }catch(err){console.error('[reels billing pending]',err.message);}
    }
    if(gens.length && gens.every(g=>g.actual_usd!==null))pkg.data.actualCost=gens.reduce((s,g)=>s+Number(g.actual_usd),0);
    const assets=gens.filter(g=>g.review?.asset).map(g=>({path:g.review.asset,label:`Shot ${g.shot}, attempt ${g.attempt}`,review:g.review,actual:g.actual_usd}));
    if(pkg.data.master)assets.unshift({path:pkg.data.master,label:'Finished Reel'});
    if(pkg.data.pausedAudio)assets.push({path:pkg.data.pausedAudio,label:'Qwen narration'});
    for(const a of assets)a.url=await store.signed(a.path);
    res.render('admin-reel-detail',{pkg,gens,assets,csrf:csrf(pkg.id)});
  }));
  router.post('/:id/decision',handle(async(req,res)=>{
    const token=req.body.csrf,period=Math.floor(Date.now()/3600000);
    if(!equal(token,csrf(req.params.id,period))&&!equal(token,csrf(req.params.id,period-1)))return res.status(403).send('Expired or invalid form token');
    await store.decision(req.params.id,req.body.action);
    res.redirect(303,`/admin/reels/${req.params.id}`);
  }));
  router.use((err,req,res,next)=>{console.error('[reels admin]',err.message);res.status(503).send('Reel review is temporarily unavailable. Check feature configuration and migration.');});
  return router;
}
module.exports={createRouter};
