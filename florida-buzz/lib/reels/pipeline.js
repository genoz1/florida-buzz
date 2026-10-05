'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {KLING,QWEN,WHISPER,videoInput,voiceInput}=require('./config');
const {promptFor,socialCopy,validateFacts}=require('./editorial');
function createPipeline({cfg,store,fal,editorial,media}) {
  let busy=false;
  async function tick(slot) {
    if(busy || !cfg.enabled || !cfg.generation) return {skipped:'disabled or already running'};
    busy=true;let claim,heartbeat;
    try {
      claim=await store.claim(slot);
      if(!claim) return {skipped:'no work or another worker holds lease'};
      const token=claim.token;let pkg=claim.package;
      const save=async(patch,status='WORKING')=>{pkg=await store.save(token,pkg,patch,status);return pkg;};
      let leaseLost=false;
      heartbeat=setInterval(()=>store.lease(token).then(ok=>{if(!ok)leaseLost=true;}).catch(()=>{leaseLost=true;}),30000);
      heartbeat.unref();
      const assertLease=async()=>{if(leaseLost || !await store.lease(token))throw new Error('Worker lease lost');};
      // The approved embedding is private, never a public repository asset.
      // Verify it before editorial or generation work, with no voice fallback.
      const approvedVoice=await store.voice();
      const topic=await store.topic(pkg.topic_key);
      if(topic.status==='EXISTING_PROOF')throw new Error('Existing proof must never be regenerated');
      if(!pkg.data.facts) await save({facts:await editorial.facts(topic)});
      validateFacts(pkg.data.facts,new Date(),topic);
      if(!pkg.data.guide) await save({guide:await editorial.guide(topic,pkg.data.facts,pkg,save)});
      if(!pkg.data.script) {
        const script=await editorial.script(topic,pkg.data.guide,pkg.data.facts);
        await save({script,social:socialCopy(script,pkg.data.guide)});
      }
      const gens=await store.generations(pkg);
      // Lost POST receipts are deliberately held, never retried or assumed free.
      if(gens.some(g=>g.status==='SUBMITTING'))return await save({warning:'Ambiguous paid submission. Reconcile the fal request in the dashboard; do not resubmit automatically.'},'MANUAL_REVIEW');
      const pending=gens.find(g=>g.status==='QUEUED');
      if(pending) {
        const outcome=await fal.poll(pending);
        if(!outcome)return {waiting:pending.request_id};
        if(outcome.failed) {
          await store.generation(token,pending.id,{status:'FAILED',review:{classification:'MANUAL_REVIEW',issues:[outcome.refusal?'REFUSED':'Provider request failed'],correction:''}});
          return await save({warning:outcome.refusal?'REFUSED: original prompt preserved; no workaround attempted.':'Provider failure. Inspect in fal before any further spending.'},'MANUAL_REVIEW');
        }
        await store.generation(token,pending.id,{status:'COMPLETE',result:outcome.result});
        return {completed:pending.request_id};
      }
      // Reconcile real request charges before any subsequent paid submission.
      const unreconciled=gens.find(g=>g.request_id && g.actual_usd===null);
      if(unreconciled) {
        const billing=await fal.actual(unreconciled);
        if(!billing)return {waitingForBilling:unreconciled.request_id};
        await store.generation(token,unreconciled.id,{actual_usd:billing.amount,billing:billing.events});
        return {reconciled:unreconciled.request_id};
      }
      const submit=async(item,quantity)=>{
        await assertLease();
        const quote=await fal.quote(item.endpoint,quantity),balance=await fal.balance();
        const reservation=await store.reserve(token,pkg,item,quote,balance);
        if(!reservation.new_reservation)throw new Error('Existing paid reservation; do not resubmit');
        // No retry wrapper around this POST, even for network timeouts/5xx.
        const receipt=await fal.submit(item.endpoint,item.input);
        await store.generation(token,reservation.id,{status:'QUEUED',...receipt});
        await save({lastQuote:quote,verifiedBalanceBefore:balance});
        return {submitted:receipt.request_id};
      };
      for(let shot=1;shot<=4;shot++) {
        const attempts=gens.filter(g=>g.kind==='clip'&&g.shot===shot).sort((a,b)=>a.attempt-b.attempt),last=attempts.at(-1);
        const prompt=promptFor(pkg.data.script.shots[shot-1],topic);
        if(!last)return await submit({kind:'clip',shot,attempt:0,endpoint:KLING,input:videoInput(prompt,cfg.seconds)},cfg.seconds);
        if(last.status==='FAILED')return await save({warning:`Shot ${shot} failed; manual review required.`},'MANUAL_REVIEW');
        if(!last.review) {
          const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-clip-'));
          try {
            const source=path.join(dir,'source.mp4');await media.download(last.result.video.url,source);
            const asset=await store.asset(`${pkg.id}/clip-${shot}-attempt-${last.attempt}.mp4`,await fs.readFile(source),'video/mp4');
            const review=await media.review(source,{topic:topic.title,shot:pkg.data.script.shots[shot-1],seconds:cfg.seconds});
            await store.generation(token,last.id,{review:{...review,asset}});
            return {reviewed:shot,classification:review.classification};
          } finally {await fs.rm(dir,{recursive:true,force:true});}
        }
        if(last.review.classification==='PASS')continue;
        if(last.review.classification==='REGENERATE_ONCE'&&last.attempt===0) {
          return await submit({kind:'clip',shot,attempt:1,endpoint:KLING,input:videoInput(`${prompt} Correct only this severe visible defect: ${last.review.correction}`,cfg.seconds)},cfg.seconds);
        }
        return await save({warning:`Shot ${shot}: ${last.attempt?'replacement failed; maximum one replacement reached':'requires manual review'}.`},'MANUAL_REVIEW');
      }
      const narration=gens.find(g=>g.kind==='narration');
      if(!narration) {
        return await submit({kind:'narration',endpoint:QWEN,input:voiceInput(pkg.data.script.thoughts.join('\n\n'),approvedVoice)},pkg.data.script.thoughts.join(' ').length);
      }
      if(!pkg.data.audioAsset) {
        const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-audio-'));
        try {
          const file=path.join(dir,'original.mp3');await media.download(narration.result.audio.url,file);
          const audioAsset=await store.asset(`${pkg.id}/Narration-Qwen-original.mp3`,await fs.readFile(file),'audio/mpeg');
          const info=await media.probe(file);await save({audioAsset,audioDuration:Number(info.format.duration)});
          return {savedNarration:true};
        } finally {await fs.rm(dir,{recursive:true,force:true});}
      }
      const transcript=gens.find(g=>g.kind==='transcript');
      if(!transcript)return await submit({kind:'transcript',endpoint:WHISPER,input:{audio_url:await store.signed(pkg.data.audioAsset,86400),task:'transcribe',chunk_level:'word',batch_size:64}},pkg.data.audioDuration);
      if(!pkg.data.master) {
        const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-assembly-'));
        try {
          const clips=[];
          for(let shot=1;shot<=4;shot++) {
            const g=gens.filter(g=>g.kind==='clip'&&g.shot===shot&&g.review?.classification==='PASS').sort((a,b)=>b.attempt-a.attempt)[0];
            const file=path.join(dir,`clip-${shot}.mp4`);await media.download(await store.signed(g.review.asset),file);clips.push(file);
          }
          const audio=path.join(dir,'audio.mp3');await media.download(await store.signed(pkg.data.audioAsset),audio);
          const output=await media.assemble(clips,audio,transcript.result,pkg.data.script.thoughts,dir);
          const master=await store.asset(`${pkg.id}/Florida-Buzz-Reel.mp4`,await fs.readFile(output.master),'video/mp4');
          const captionAsset=await store.asset(`${pkg.id}/captions.ass`,await fs.readFile(output.ass),'text/plain');
          const pausedAudio=await store.asset(`${pkg.id}/Narration-Qwen-paused.wav`,await fs.readFile(output.paused),'audio/wav');
          await save({master,captionAsset,pausedAudio,narrationTiming:output.timing,quality:output.quality});
        } finally {await fs.rm(dir,{recursive:true,force:true});}
      }
      const actualCost=gens.reduce((sum,g)=>sum+Number(g.actual_usd),0);
      return await save({actualCost,balanceAfter:await fal.balance(),warning:'AI-assisted frame review cannot prove every frame. Watch the entire Reel before approval. Approval records a decision only; it does not publish.'},'READY_FOR_APPROVAL');
    } catch(error) {
      if(claim) {
        try {
          const ambiguous=(await store.generations(claim.package)).some(g=>g.status==='SUBMITTING');
          if(/cap reached|spending cap|Insufficient verified/.test(error.message))await store.pause(claim.token,error.message);
          await store.save(claim.token,claim.package,{warning:error.refusal?'REFUSED: original prompt preserved; no workaround attempted.':error.message},ambiguous||error.refusal?'MANUAL_REVIEW':'HELD');
        } catch { /* lease owner alone can update */ }
      }
      return {held:error.message};
    } finally {
      clearInterval(heartbeat);
      if(claim)await store.lease(claim.token,true).catch(()=>{});
      busy=false;
    }
  }
  return {tick};
}
module.exports={createPipeline};
