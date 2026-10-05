'use strict';
const {config}=require('./config');
const {createStore}=require('./store');
const {createFal}=require('./fal');
const {createEditorial}=require('./editorial');
const {createMedia}=require('./media');
const {createPipeline}=require('./pipeline');
const {createRouter}=require('./router');
const {createPublisher}=require('./publish');
function production(env=process.env) {
  const cfg=config(env),{supabase}=require('../supabase');
  const store=createStore(supabase,cfg),fal=createFal(cfg);
  const editorial=createEditorial(require('../aiText'),store,cfg,require('../indexnow').notifyIndexNow);
  return {cfg,store,fal,editorial,pipeline:createPipeline({cfg,store,fal,editorial,media:createMedia(cfg,env),publisher:createPublisher(env)})};
}
function slotFor(now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function mount(app,env=process.env) {
  const reelEnv={...env,REELS_ENABLED:'true',REELS_GENERATION_ENABLED:'true',REELS_SCHEDULES_ENABLED:'true'};
  try {
    const runtime=production(reelEnv),{cfg,store,pipeline,editorial}=runtime;
    app.use('/admin/reels',createRouter({store,cfg,fal:runtime.fal,env:reelEnv}));
    if(!cfg.falKey||!reelEnv.OPENAI_API_KEY||Object.values(cfg.caps).some(v=>v<=0))throw new Error('Reel generation requires credentials and explicit positive spending caps');
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
module.exports={mount,production,slotFor};
