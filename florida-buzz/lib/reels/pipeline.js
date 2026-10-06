'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {KLING,QWEN,WHISPER,MERGE_VIDEOS,MERGE_AUDIO_VIDEO,AUTO_SUBTITLE,videoInput,voiceInput}=require('./config');
const {promptFor,socialCopy,validateFacts}=require('./editorial');
function createPipeline({cfg,store,fal,editorial,media,publisher}) {
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
      if(!pkg.data.pausedAudio) {
        const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-audio-final-'));
        try {
          const audio=path.join(dir,'audio.mp3');await media.download(await store.signed(pkg.data.audioAsset),audio);
          const output=await media.prepareNarration(audio,transcript.result,pkg.data.script.thoughts,dir);
          const captionAsset=await store.asset(`${pkg.id}/captions.ass`,await fs.readFile(output.ass),'text/plain');
          const pausedAudio=await store.asset(`${pkg.id}/Narration-Qwen-paused.wav`,await fs.readFile(output.paused),'audio/wav');
          await save({captionAsset,pausedAudio,narrationTiming:output.timing,quality:output.quality,assemblyBalanceBefore:await fal.balance()});
          return {preparedNarration:true};
        } finally {await fs.rm(dir,{recursive:true,force:true});}
      }

      const utility=async(key,endpoint,input)=>{
        const state=pkg.data[key];
        if(!state) {
          await assertLease();
          await save({[key]:{status:'SUBMITTING',endpoint}});
          const receipt=await fal.submitUtility(endpoint,input);
          await save({[key]:{status:'QUEUED',endpoint,...receipt}});
          return {stop:{submittedUtility:receipt.request_id,step:key}};
        }
        if(state.status==='SUBMITTING') {
          return {stop:await save({warning:`Ambiguous ${key} utility submission; do not resubmit automatically.`},'MANUAL_REVIEW')};
        }
        if(state.status==='QUEUED') {
          const outcome=await fal.poll(state);
          if(!outcome)return {stop:{waitingUtility:state.request_id,step:key}};
          if(outcome.failed)return {stop:await save({warning:`Remote Reel utility failed at ${key}.`},'MANUAL_REVIEW')};
          await save({[key]:{...state,status:'COMPLETE',result:outcome.result}});
          return {stop:{completedUtility:state.request_id,step:key}};
        }
        if(state.status!=='COMPLETE')return {stop:await save({warning:`Unexpected remote assembly state at ${key}.`},'MANUAL_REVIEW')};
        return {result:state.result};
      };

      const clipUrls=[];
      for(let shot=1;shot<=4;shot++) {
        const g=gens.filter(g=>g.kind==='clip'&&g.shot===shot&&g.review?.classification==='PASS').sort((a,b)=>b.attempt-a.attempt)[0];
        clipUrls.push(await store.signed(g.review.asset,21600));
      }

      const videoMerge=await utility('remoteVideoMerge',MERGE_VIDEOS,{video_urls:clipUrls,target_fps:24,resolution:{width:720,height:1280}});
      if(videoMerge.stop)return videoMerge.stop;

      const audioMerge=await utility('remoteAudioMerge',MERGE_AUDIO_VIDEO,{
        video_url:videoMerge.result.video.url,
        audio_url:await store.signed(pkg.data.pausedAudio,21600),
        start_offset:0
      });
      if(audioMerge.stop)return audioMerge.stop;

      const subtitled=await utility('remoteSubtitle',AUTO_SUBTITLE,{
        video_url:audioMerge.result.video.url,
        language:'en',font_name:'Montserrat',font_size:48,font_weight:'bold',
        font_color:'white',highlight_color:'white',stroke_width:3,stroke_color:'black',
        background_color:'none',position:'bottom',y_offset:-300,words_per_subtitle:4,enable_animation:false
      });
      if(subtitled.stop)return subtitled.stop;

      if(!pkg.data.master) {
        const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-remote-master-'));
        try {
          const masterFile=path.join(dir,'Florida-Buzz-Reel.mp4');
          await media.download(subtitled.result.video.url,masterFile);
          const info=await media.probe(masterFile),v=info.streams.find(s=>s.codec_type==='video'),a=info.streams.find(s=>s.codec_type==='audio');
          const expected=cfg.seconds*4;
          if(!v||!a||v.width!==720||v.height!==1280||Math.abs(Number(info.format.duration)-expected)>.75)throw new Error('Remote Reel failed stream/duration validation');
          const finalReview=await media.finalReview(masterFile,{topic:topic.title,shots:pkg.data.script.shots,captionSafeZone:'lower-middle, clear of bottom app controls'});
          if(finalReview.classification!=='PASS')return await save({finalReview,warning:`Final Reel quality review failed: ${finalReview.issues.join('; ')}`},'MANUAL_REVIEW');
          const master=await store.asset(`${pkg.id}/Florida-Buzz-Reel.mp4`,await fs.readFile(masterFile),'video/mp4');
          const balanceAfter=await fal.balance();
          const remoteAssemblyCost=Math.max(0,Number(pkg.data.assemblyBalanceBefore||balanceAfter)-balanceAfter);
          await save({master,finalReview,remoteAssemblyCost,balanceAfter,quality:{...(pkg.data.quality||{}),vertical:true,audio:true,captions:true,remoteAssembly:true,finalReview:true,oldNarrator:false}});
        } finally {await fs.rm(dir,{recursive:true,force:true});}
      }
      const balanceAfter=pkg.data.balanceAfter??await fal.balance();
      const actualCost=gens.reduce((sum,g)=>sum+Number(g.actual_usd),0)+Number(pkg.data.remoteAssemblyCost||0);
      await save({actualCost,balanceAfter});
      const publication=await publisher.publish({pkg,masterUrl:await store.signed(pkg.data.master,21600),coverImageUrl:pkg.data.guide.image_url,save});
      return await save({publication,publishedAt:new Date().toISOString(),warning:'Automated Reel passed factual, media and publication checks.'},'APPROVED');
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
