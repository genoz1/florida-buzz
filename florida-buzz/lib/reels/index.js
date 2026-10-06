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

async function runControlledChristmasTest(env=process.env) {
  const testEnv={...env,REELS_ENABLED:'true',REELS_GENERATION_ENABLED:'true',REELS_SCHEDULES_ENABLED:'false',REELS_AUTO_PUBLISH_ENABLED:'false',REELS_PACKAGE_CAP_USD:'3',REELS_DAY_CAP_USD:'5',REELS_WEEK_CAP_USD:'8',REELS_MONTH_CAP_USD:'24'};
  const runtime=production(testEnv),{store,pipeline}=runtime;
  const key='christmas-party-2026-controlled-walkthrough-v4';
  const slot='quality-test-christmas-controlled-walkthrough-v4';
  await store.clearPause();
  await store.rejectWorkingForTopic('christmas-party-2026');
  await store.addTopics([{
    key,
    title:'Is Mickey’s Very Merry Christmas Party actually worth the money?',
    destination:'Magic Kingdom',
    angle:'value',
    status:'QUEUED',
    seed_order:2,
    score:100
  }]);
  for(let i=0;i<180;i++) {
    const pkg=await store.packageForTopic(key);
    if(pkg && ['READY_FOR_APPROVAL','MANUAL_REVIEW','HELD','REJECTED','APPROVED'].includes(pkg.status)) {
      console.log('[reels controlled test]',JSON.stringify({id:pkg.id,status:pkg.status,warning:pkg.data?.warning||null}));
      return;
    }
    const result=await pipeline.tick(slot);
    if(!result.skipped)console.log('[reels controlled test]',JSON.stringify(result));
    await new Promise(resolve=>setTimeout(resolve,8000));
  }
  console.error('[reels controlled test] timed out before terminal review state');
}

function slotFor(now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function mount(app,env=process.env) {
  // Emergency quality hold: regular generation, schedules and auto-publishing stay off.
  // One controlled Christmas quality test runs separately and stops at READY_FOR_APPROVAL.
  const reelEnv={...env,REELS_ENABLED:'false',REELS_GENERATION_ENABLED:'false',REELS_SCHEDULES_ENABLED:'false',REELS_AUTO_PUBLISH_ENABLED:'false'};
  try {
    const runtime=production(reelEnv),{cfg,store,pipeline,editorial}=runtime;
    app.use('/admin/reels',createRouter({store,cfg,fal:runtime.fal,env:reelEnv}));
    runControlledChristmasTest(env).catch(err=>console.error('[reels controlled test]',err.message));
    if(!cfg.enabled||!cfg.generation||!cfg.schedules){console.log('[reels disabled] emergency quality hold');return;}
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
