'use strict';
const {config}=require('./config');
const {createStore}=require('./store');
const {createFal}=require('./fal');
const {createEditorial}=require('./editorial');
const {createMedia}=require('./media');
const {createPipeline}=require('./pipeline');
const {createRouter}=require('./router');
const ONE_SHOT=Object.freeze({id:'89ff4e0b-8c0f-4943-a87b-4af371350d8b',topic:'christmas-party-2026',marker:'christmas-party-guide-reel-2026-10-05'});
function production(env=process.env) {
  const cfg=config(env),{supabase}=require('../supabase');
  const store=createStore(supabase,cfg),fal=createFal(cfg);
  const editorial=createEditorial(require('../aiText'),store,cfg,require('../indexnow').notifyIndexNow);
  return {cfg,store,fal,editorial,pipeline:createPipeline({cfg,store,fal,editorial,media:createMedia(cfg,env)})};
}
function slotFor(now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
async function resumeOneShot(runtime,schedule=fn=>setTimeout(fn,15000)) {
  const {cfg,store,pipeline}=runtime;
  if(!cfg.enabled||!cfg.generation||cfg.schedules)throw new Error('One-shot Reel resume requires generation on and schedules off');
  if(!cfg.falKey||Object.values(cfg.caps).some(v=>v<=0))throw new Error('One-shot Reel resume requires credentials and explicit positive spending caps');
  const pkg=await store.resumeHeldPackage(ONE_SHOT.id,ONE_SHOT.topic,ONE_SHOT.marker);
  if(pkg.status==='READY_FOR_APPROVAL')return pkg;
  const advance=async()=>{
    const current=await store.package(ONE_SHOT.id);
    if(current.status!=='WORKING'||current.topic_key!==ONE_SHOT.topic||current.data?.oneShotResume!==ONE_SHOT.marker)return current;
    await pipeline.tick();
    const updated=await store.package(ONE_SHOT.id);
    if(updated.status==='WORKING')schedule(()=>advance().catch(err=>console.error('[reels one-shot]',err.message)));
    else console.log('[reels one-shot]',JSON.stringify({id:updated.id,status:updated.status,guide:updated.data?.guide?.url,actualCost:updated.data?.actualCost,balanceAfter:updated.data?.balanceAfter,master:updated.data?.master}));
    return updated;
  };
  return advance();
}
function mount(app,env=process.env) {
  // No imports, schedules or DB operations when the new independent gate is off.
  if(env.REELS_ENABLED!=='true')return;
  try {
    const runtime=production(env),{cfg,store,pipeline,editorial}=runtime;
    app.use('/admin/reels',createRouter({store,cfg,fal:runtime.fal,env}));
    resumeOneShot(production({...env,REELS_GENERATION_ENABLED:'true',REELS_SCHEDULES_ENABLED:'false'}))
      .catch(err=>console.error('[reels one-shot]',err.message));
    if(!cfg.generation||!cfg.schedules)return;
    if(!cfg.falKey||!env.OPENAI_API_KEY||Object.values(cfg.caps).some(v=>v<=0))throw new Error('Reel generation requires credentials and explicit positive spending caps');
    const cron=require('node-cron');
    if(!cron.validate(cfg.cron)||!cron.validate(cfg.ideasCron))throw new Error('Invalid Reel cadence');
    // Seed and validate schema before registering any scheduled work.
    store.seed().then(()=>{
      cron.schedule(cfg.cron,()=>pipeline.tick(slotFor()).then(r=>console.log('[reels]',JSON.stringify(r))),{timezone:cfg.timezone});
      cron.schedule('* * * * *',()=>pipeline.tick().then(r=>{if(!r.skipped)console.log('[reels]',JSON.stringify(r));}),{timezone:cfg.timezone});
      let ideasBusy=false;
      cron.schedule(cfg.ideasCron,async()=>{if(ideasBusy)return;ideasBusy=true;try{await editorial.ideas();}catch(err){console.error('[reels ideas]',err.message);}finally{ideasBusy=false;}},{timezone:cfg.timezone});
    }).catch(err=>console.error('[reels disabled]',err.message));
  } catch(err) {console.error('[reels disabled]',err.message);}
}
module.exports={mount,production,slotFor,resumeOneShot,ONE_SHOT};
