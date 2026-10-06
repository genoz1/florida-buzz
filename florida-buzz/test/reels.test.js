require('node:test')('Christmas facts omit unpublished optional details but keep required used facts verified',()=>{
  const topic={title:"Is Mickey's Very Merry Christmas Party Actually Worth the Money?"};
  const core={...facts(),verified:false,missing:['exact cookie flavors are not published'],claims:facts().claims.filter(c=>['pricing','dates','entry','hours'].includes(c.subject))};
  const checked=validateFacts(core,new Date(),topic);
  assert.equal(checked.verified,true);assert.deepEqual(checked.missing,[]);
  assert.deepEqual(checked.claims.map(c=>c.subject),['pricing','dates','entry','hours']);
  assert.throws(()=>validateFacts({...core,claims:core.claims.filter(c=>c.subject!=='pricing')},new Date(),topic),/Essential current Christmas-party facts/);
  assert.throws(()=>validateFacts({...core,claims:core.claims.map((c,i)=>i?c:{...c,verified:false})},new Date(),topic),/verified primary sources/);
});
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {config,KLING,QWEN,MERGE_VIDEOS,MERGE_AUDIO_VIDEO,AUTO_SUBTITLE,voiceInput,videoInput}=require('../lib/reels/config');
const {seeds,score,strongest,selectQueued,criteria}=require('../lib/reels/topics');
const {createFal,queueUrl}=require('../lib/reels/fal');
const {validateFacts,validateScript,normalizeScript,normalizeNarration,promptFor,socialCopy,createEditorial}=require('../lib/reels/editorial');
const {naturalPauses,fitDuration,captions}=require('../lib/reels/media');
const {createPipeline}=require('../lib/reels/pipeline');
const {createPublisher}=require('../lib/reels/publish');
const facts=()=>({verified:true,checked_at:new Date().toISOString(),missing:[],claims:['pricing','dates','entry','hours','parade','fireworks','entertainment','treats','attractions','crowds'].map(subject=>({subject,fact:`Verified ${new Date().getUTCFullYear()} ${subject} rule`,verified:true,source_urls:['https://disneyworld.disney.go.com/events/']}))});
const thoughts=['A lot of people get to Magic Kingdom later than they probably should.','If you want shorter waits and an easier start to the day, that first hour after opening can make a big difference.','The key is knowing which rides are worth doing right away and which ones can wait until later.','We’ve got the full Magic Kingdom morning strategy at TheFloridaBuzz.com.'];
const script=()=>({hook:'A useful planning question',thoughts,shots:[{stage:'arrival',type:'establishing',location:'Main Street U.S.A.',description:'Arrival view up Main Street toward Cinderella Castle'},{stage:'icon',type:'castle',location:'Cinderella Castle hub',description:'Castle hub and forecourt with holiday atmosphere'},{stage:'land',type:'land',location:'Fantasyland',description:'Fantasyland attraction area with recognizable architecture'},{stage:'experience',type:'detail',location:'Tomorrowland',description:'Tomorrowland evening attraction detail with distinct architecture'}],social:{facebook:'Plan your morning.',instagram:'A calmer start.',pinterest:'Magic Kingdom morning tips.',threads:'What would you do first?'}});
test('seed order skips the existing proof and starts with Christmas party',()=>{assert.equal(selectQueued(seeds).key,'christmas-party-2026');assert.equal(seeds.length,10);assert.equal(seeds[0].status,'EXISTING_PROOF');});
test('topic scores require usefulness/verifiability and selection favors variety',()=>{
  const topic=(key,destination,angle,value)=>({key,destination,angle,scores:Object.fromEntries(criteria.map(c=>[c,value]))});
  assert.equal(score(topic('x','MK','value',6)),0);
  assert.throws(()=>score({...topic('x','MK','value',8),scores:{}}));
  const picked=strongest([topic('a','Magic Kingdom','mistake',10),topic('b','Magic Kingdom','value',9),topic('c','Epic Universe','strategy',9),topic('d','Cruises','value',8)]);
  assert.deepEqual(picked.map(t=>t.key),['a','c','d']);
});
test('facts fail closed on stale, missing, unverified or secondary-only facts',()=>{
  assert.ok(validateFacts(facts()));
  assert.throws(()=>validateFacts({...facts(),missing:['price']}));
  assert.throws(()=>validateFacts({...facts(),checked_at:'2020-01-01'}));
  assert.throws(()=>validateFacts({...facts(),claims:[{verified:true,source_urls:['https://example.com']}] }));
});
test('script requires progressive park movement and distinct scenes',()=>{
  assert.ok(validateScript(script(),5));
  assert.throws(()=>validateScript({...script(),thoughts:['Too short']},5));
  assert.match(promptFor(script().shots[0],{destination:'Magic Kingdom'}),/Main Street U\.S\.A\./);
  assert.throws(()=>validateScript({...script(),shots:script().shots.map((s,i)=>({...s,location:i?'Main Street U.S.A.':s.location}))},5),/Main Street|different park locations/);
  const badStages=script().shots.map((s,i)=>({...s,stage:i===2?'icon':s.stage}));
  assert.throws(()=>validateScript({...script(),shots:badStages},5),/arrival.*icon.*land.*experience/);
  const walking=script().shots.map((s,i)=>({...s,description:i<2?'Guests walking through the area':s.description}));
  assert.throws(()=>validateScript({...script(),shots:walking},5),/Only one Reel scene may primarily show people walking/);
  assert.throws(()=>validateScript({...script(),shots:script().shots.map(s=>({...s,description:'Breaking news evacuation'}))},6));
});
test('script normalization fixes stage order and true walking scenes without treating walkway as walking',()=>{
  const raw=script();
  raw.shots=raw.shots.map((shot,index)=>({...shot,stage:'creative-'+index,
    description:index===0?'Guests walking toward the entrance':index===1?'People strolling around the castle':index===2?'A quiet walkway frames the attraction':shot.description}));
  const normalized=normalizeScript(raw,5);
  assert.deepEqual(normalized.shots.map(shot=>shot.stage),['arrival','icon','land','experience']);
  assert.match(normalized.shots[0].description,/Guests walking/);
  assert.doesNotMatch(normalized.shots[1].description,/walking|strolling/i);
  assert.match(normalized.shots[2].description,/walkway/);
  assert.doesNotThrow(()=>validateScript(normalized,5));
});
test('duplicate locations and Main Street after arrival remain hard failures',()=>{
  const duplicate=script();duplicate.shots[2].location=duplicate.shots[1].location;
  assert.throws(()=>validateScript(normalizeScript(duplicate,5),5),/different park locations/);
  const mainStreet=script();mainStreet.shots[3].description='Main Street holiday storefront detail';
  assert.throws(()=>validateScript(normalizeScript(mainStreet,5),5),/Main Street may appear only in shot 1/);
});
test('narration length is deterministically normalized and keeps the CTA',()=>{
  const short=['Worth it?','The event has tradeoffs.','Plan for your priorities.','Read TheFloridaBuzz.com.'];
  const padded=normalizeNarration(short,5),paddedCount=padded.join(' ').split(/\s+/).length;
  assert.ok(paddedCount>=55&&paddedCount<=65);assert.match(padded[3],/TheFloridaBuzz\.com/);
  const long=thoughts.map(value=>`${value} ${Array.from({length:35},()=> 'extra').join(' ')}`);
  const trimmed=normalizeNarration(long,5),trimmedCount=trimmed.join(' ').split(/\s+/).length;
  assert.ok(trimmedCount>=55&&trimmedCount<=65);assert.match(trimmed[3],/TheFloridaBuzz\.com/);
  const missingCta=normalizeNarration(['Is it worth it?','Compare the price with the included event time.','Think about the entertainment, treats, and attraction access.','Read the complete planning guide before deciding.'],5);
  assert.match(missingCta[3],/TheFloridaBuzz\.com/);assert.doesNotThrow(()=>validateScript({...script(),thoughts:missingCta},5));
});
test('later Kling prompts focus on places instead of inheriting generic people-walking direction',()=>{
  const prompts=script().shots.map(shot=>promptFor(shot,{destination:'Magic Kingdom'}));
  assert.match(prompts[0],/some people walking/);
  for(const prompt of prompts.slice(1)){assert.match(prompt,/pedestrian movement secondary/);assert.doesNotMatch(prompt,/some people walking/);}
});
test('Kling and Qwen inputs preserve approved models and exact cloned voice settings',()=>{
  assert.deepEqual(videoInput('Real Magic Kingdom',5),{prompt:'Real Magic Kingdom',duration:'5',aspect_ratio:'9:16',generate_audio:false,cfg_scale:.5});
  const input=voiceInput('Hello','https://voice.example/approved');
  assert.equal(input.speaker_voice_embedding_file_url,'https://voice.example/approved');assert.equal(input.language,'English');assert.equal(input.max_new_tokens,1000);assert.equal(input.temperature,.9);assert.equal(input.voice,undefined);
});
test('social copy links directly to guide; all platforms remain drafts',()=>{
  const copy=socialCopy(script(),{title:'Morning strategy',url:'https://thefloridabuzz.com/article/morning'});
  assert.match(copy.facebook,/\/article\/morning/);assert.equal(copy.pinterest.link,'https://thefloridabuzz.com/article/morning');assert.match(copy.instagram,/not make it clickable/);assert.match(copy.threads,/illustrative footage/);
});
test('fal only submits approved endpoints once and resumes returned queue URLs',async()=>{
  const calls=[];const fal=createFal({falKey:'test',billingKey:'test'},async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>url.includes('status')?{status:'COMPLETED'}:url.includes('response')?{video:{url:'https://v3.fal.media/test.mp4'}}:{request_id:'r1',status_url:'https://queue.fal.run/kling/requests/r1/status',response_url:'https://queue.fal.run/kling/requests/r1/response'}};
  });
  const receipt=await fal.submit(KLING,videoInput('test'));assert.equal(receipt.request_id,'r1');assert.ok((await fal.poll(receipt)).result.video);
  assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
  const utility=await fal.submitUtility(MERGE_VIDEOS,{video_urls:['https://v3.fal.media/a.mp4']});assert.equal(utility.request_id,'r1');
  await assert.rejects(()=>fal.submit('some/other/model',{}));await assert.rejects(()=>fal.submitUtility('some/other/utility',{}));assert.throws(()=>queueUrl('https://evil.example/collect-key'));
});
test('fal billing records are per-request actual charges, never quotes',async()=>{
  const fal=createFal({falKey:'test',billingKey:'test'},async()=>({ok:true,json:async()=>({billing_events:[{request_id:'r',endpoint_id:KLING,cost_total:.42},{request_id:'other',endpoint_id:KLING,cost_total:9}]})}));
  assert.equal((await fal.actual({request_id:'r',endpoint:KLING,created_at:new Date().toISOString()})).amount,.42);
});
test('Qwen quote handles character versus thousand-character units conservatively',async()=>{
  for(const [unit,unit_price] of [['character',.00009],['1000 characters',.09]]){
    const fal=createFal({falKey:'test',billingKey:'test'},async()=>({ok:true,json:async()=>({prices:[{endpoint_id:QWEN,unit,unit_price,currency:'USD'}]})}));
    assert.equal((await fal.quote(QWEN,380)).amount,.09);
  }
});
test('native audio gaps are replaced without stretching spoken samples and captions remap',()=>{
  const sr=1000,parts=[];const chunks=[];let at=0;
  ['One.','Two.','Three.','Four.'].forEach((text,i)=>{const b=Buffer.alloc(2000);for(let j=0;j<1000;j++)b.writeInt16LE(10000,j*2);parts.push(b);chunks.push({text,timestamp:[at,at+1]});at+=1;if(i<3){parts.push(Buffer.alloc(1600));at+=.8;}});
  const out=naturalPauses(Buffer.concat(parts),sr,['One.','Two.','Three.','Four.'],chunks);
  assert.equal(out.speed,1);assert.ok(Math.abs(out.duration-5.5)<.001);assert.deepEqual(out.pauses.map(g=>g[2]),[.4,.4,.7]);
  const spoken=Buffer.alloc(8000);for(let i=0;i<4000;i++)spoken.writeInt16LE(10000,i*2);
  const kept=[];for(let i=0;i<out.pcm.length;i+=2)if(out.pcm.readInt16LE(i)!==0)kept.push(out.pcm.subarray(i,i+2));assert.deepEqual(Buffer.concat(kept),spoken);
  assert.match(captions(out.words,6),/FLORIDA BUZZ/);assert.match(captions(out.words,6),/illustrative footage/);
  assert.throws(()=>fitDuration(5,20));assert.throws(()=>fitDuration(25,24));assert.doesNotThrow(()=>fitDuration(19,20));
});

async function fixture(options={}) {
  const cfg={...config({REELS_ENABLED:'true',REELS_GENERATION_ENABLED:'true',REELS_AUTO_PUBLISH_ENABLED:options.noPublish?'false':'true',REELS_SHOT_SECONDS:'6'}),caps:{single:2,package:3,day:3,week:6,month:24}};
  const pkg={id:'p1',topic_key:'christmas-party-2026',status:'WORKING',data:{}},gens=[],submitted=[],utilitySubmitted=[];let leased=false;
  const store={
    voice:async()=> {if(options.missingVoice)throw new Error('Approved private Qwen voice unavailable');return 'https://v3.fal.media/private-approved-voice';},
    claim:async()=>{if(leased||pkg.status!=='WORKING')return null;leased=true;return {token:'lease',package:structuredClone(pkg)};},
    lease:async(token,release)=>{if(release)leased=false;return true;},
    save:async(token,p,patch,status='WORKING')=>{assert.ok(leased,'lease must be held until awaited saves complete');pkg.data={...pkg.data,...patch};pkg.status=status;return structuredClone(pkg);},
    topic:async()=>({key:pkg.topic_key,title:'Christmas party value',destination:'Magic Kingdom',status:'SELECTED'}),
    generations:async()=>structuredClone(gens),
    reserve:async(token,p,item,quote)=>{
      assert.ok(leased);if(options.cap)throw new Error('package spending cap reached');
      const existing=gens.find(g=>g.kind===item.kind&&g.shot===(item.shot||0)&&g.attempt===(item.attempt||0));if(existing)return {...existing,new_reservation:false};
      const g={...item,id:`g${gens.length+1}`,shot:item.shot||0,attempt:item.attempt||0,status:'SUBMITTING',actual_usd:null,created_at:new Date().toISOString(),quote};gens.push(g);return {...g,new_reservation:true};
    },
    generation:async(token,id,patch)=>{assert.ok(leased,'paid request receipt must be saved before lease release');Object.assign(gens.find(g=>g.id===id),patch);},
    pause:async()=>{},asset:async(p)=>p,signed:async p=>'https://v3.fal.media/'+p,
  };
  const fal={quote:async()=>({amount:.1}),balance:async()=>4.4,
    submit:async(endpoint,input)=>{submitted.push({endpoint,input});await Promise.resolve();if(options.lostReceipt)throw new Error('POST timeout');return {request_id:`r${submitted.length}`,status_url:'https://queue.fal.run/x/status',response_url:'https://queue.fal.run/x/response'};},
    submitUtility:async(endpoint,input)=>{utilitySubmitted.push({endpoint,input});return {request_id:`u${utilitySubmitted.length}`,status_url:'https://queue.fal.run/u/status',response_url:'https://queue.fal.run/u/response'};},
    poll:async g=>{
      if(g.endpoint===MERGE_VIDEOS)return {result:{video:{url:'https://v3.fal.media/merged-video.mp4'}}};
      if(g.endpoint===MERGE_AUDIO_VIDEO)return {result:{video:{url:'https://v3.fal.media/merged-audio.mp4'}}};
      if(g.endpoint===AUTO_SUBTITLE)return {result:{video:{url:'https://v3.fal.media/subtitled.mp4'},transcription:'test'}};
      return options.refused?{failed:true,refusal:true}:{result:g.kind==='clip'?{video:{url:'https://v3.fal.media/clip.mp4'}}:g.kind==='narration'?{audio:{url:'https://v3.fal.media/audio.mp3'}}:{chunks:[]}};
    },actual:async()=>({amount:.1,events:[]})};
  const editorial={facts:async()=>facts(),guide:async()=>({title:'Christmas party guide',url:'https://thefloridabuzz.com/article/party',image_url:'https://thefloridabuzz.com/party.jpg',body_html:'Substantial guide'}),script:async()=>script()};
  let finalReviewCalls=0;
  const media={download:async(u,p)=>{await fs.writeFile(p,'fixture');return p;},probe:async()=>({format:{duration:24},streams:[{codec_type:'video',width:720,height:1280},{codec_type:'audio'}]}),review:async()=>({classification:options.failedReview?'REGENERATE_ONCE':'PASS',issues:options.failedReview?['Severe malformed foreground person']:[],correction:'Fix the malformed person'}),finalReview:async()=>{finalReviewCalls++;return options.finalReviewIssue?{classification:'MANUAL_REVIEW',issues:[options.finalReviewIssue]}:{classification:'PASS',issues:[]};},
    prepareNarration:async(a,t,s,dir)=>{const ass=path.join(dir,'captions.ass'),paused=path.join(dir,'paused.wav');for(const f of [ass,paused])await fs.writeFile(f,'fixture');return {ass,paused,timing:{duration:20,speed:1},quality:{audio:true,captions:true,oldNarrator:false}};}};
  const published=[];const publisher={publish:async input=>{published.push(input);if(options.publishFail)throw new Error('Instagram Reel publish failed');return {facebook:{status:'POSTED'},instagram:{status:'POSTED'},pinterest:{status:'POSTED'},threads:{status:'POSTED'}};}};
  return {pipeline:createPipeline({cfg,store,fal,editorial,media,publisher}),pkg,gens,submitted,utilitySubmitted,published,get finalReviewCalls(){return finalReviewCalls;}};
}
test('full mocked pipeline produces paid media once, assembles remotely, and publishes once',async()=>{
  const f=await fixture();for(let i=0;i<80&&f.pkg.status==='WORKING';i++)await f.pipeline.tick('2026-10-05');
  assert.equal(f.pkg.status,'APPROVED',f.pkg.data.warning);assert.equal(f.submitted.filter(s=>s.endpoint===KLING).length,4);assert.equal(f.submitted.filter(s=>s.endpoint===QWEN).length,1);assert.equal(f.gens.length,6);assert.deepEqual(f.utilitySubmitted.map(s=>s.endpoint),[MERGE_VIDEOS,MERGE_AUDIO_VIDEO,AUTO_SUBTITLE]);assert.ok(Math.abs(f.pkg.data.actualCost-.6)<1e-8);assert.ok(f.pkg.data.social.facebook.includes('/article/party'));assert.ok(f.pkg.data.master);assert.equal(f.pkg.data.quality.remoteAssembly,true);assert.equal(f.pkg.data.quality.finalReview,true);assert.equal(f.published.length,1);
  await f.pipeline.tick('2026-10-05');assert.equal(f.submitted.length,6,'published package must not submit paid media again');assert.equal(f.utilitySubmitted.length,3,'published package must not resubmit assembly utilities');assert.equal(f.published.length,1);
});
test('controlled Reel test reaches review-ready state without social publishing',async()=>{const f=await fixture({noPublish:true});for(let i=0;i<80&&f.pkg.status==='WORKING';i++)await f.pipeline.tick('quality-test');assert.equal(f.pkg.status,'READY_FOR_APPROVAL',f.pkg.data.warning);assert.ok(f.pkg.data.master);assert.equal(f.published.length,0);assert.match(f.pkg.data.warning,/Social publishing remains disabled/);});
test('one automatic replacement maximum; second failed review stops spending',async()=>{const f=await fixture({failedReview:true});for(let i=0;i<30&&f.pkg.status==='WORKING';i++)await f.pipeline.tick();assert.equal(f.pkg.status,'MANUAL_REVIEW');assert.equal(f.submitted.length,2);assert.deepEqual(f.gens.map(g=>g.attempt),[0,1]);});
test('refusal preserves explicit prompt and submits no alternatives',async()=>{const f=await fixture({refused:true});await f.pipeline.tick();await f.pipeline.tick();assert.equal(f.pkg.status,'MANUAL_REVIEW');assert.match(f.pkg.data.warning,/REFUSED/);assert.equal(f.submitted.length,1);assert.match(f.submitted[0].input.prompt,/Magic Kingdom/);});
test('lost paid receipt survives restarts as manual review and is never submitted twice',async()=>{const f=await fixture({lostReceipt:true});await f.pipeline.tick();await f.pipeline.tick();assert.equal(f.pkg.status,'MANUAL_REVIEW');assert.equal(f.gens[0].status,'SUBMITTING');assert.equal(f.submitted.length,1);});
test('spending ceiling stops before paid POST',async()=>{const f=await fixture({cap:true});await f.pipeline.tick();assert.equal(f.pkg.status,'HELD');assert.equal(f.submitted.length,0);});
test('missing approved private voice stops before any paid generation',async()=>{const f=await fixture({missingVoice:true});await f.pipeline.tick();assert.equal(f.pkg.status,'HELD');assert.equal(f.submitted.length,0);assert.match(f.pkg.data.warning,/private Qwen voice/);});
test('final assembled Reel QA blocks a repetitive four-scene montage',async()=>{const f=await fixture({finalReviewIssue:'Four repetitive crowd and walking scenes'});for(let i=0;i<80&&f.pkg.status==='WORKING';i++)await f.pipeline.tick();assert.equal(f.pkg.status,'MANUAL_REVIEW');assert.equal(f.published.length,0);assert.match(f.pkg.data.warning,/repetitive crowd/);});
test('final assembled Reel QA blocks captions in the bottom social UI region',async()=>{const f=await fixture({finalReviewIssue:'Captions are too low and overlap social app controls'});for(let i=0;i<80&&f.pkg.status==='WORKING';i++)await f.pipeline.tick();assert.equal(f.pkg.status,'MANUAL_REVIEW');assert.equal(f.published.length,0);assert.match(f.pkg.data.warning,/Captions are too low/);});
test('an existing master is re-reviewed and cannot bypass persisted final QA',async()=>{const f=await fixture();f.pkg.data.master='p1/legacy-master.mp4';for(let i=0;i<80&&f.pkg.status==='WORKING';i++)await f.pipeline.tick();assert.equal(f.pkg.status,'APPROVED',f.pkg.data.warning);assert.equal(f.finalReviewCalls,1);assert.equal(f.pkg.data.finalReview.master,'p1/legacy-master.mp4');assert.ok(f.pkg.data.finalReview.passedAt);});
test('social publication failure holds a completed package instead of claiming success',async()=>{const f=await fixture({publishFail:true});for(let i=0;i<50&&f.pkg.status==='WORKING';i++)await f.pipeline.tick();assert.equal(f.pkg.status,'HELD');assert.match(f.pkg.data.warning,/publish failed/);});
test('concurrent workers in one process do not overlap',async()=>{const f=await fixture();await Promise.all([f.pipeline.tick(),f.pipeline.tick()]);assert.equal(f.submitted.length,1);});
test('configuration parser retains safe explicit gates and spending defaults',()=>{assert.equal(config({}).enabled,false);assert.equal(config({}).generation,false);assert.equal(config({}).schedules,false);assert.equal(config({}).autoPublish,false);assert.equal(config({}).caps.package,0);});
test('automatic publisher reuses one master and journals every existing social channel',async()=>{
  const calls=[],env={FB_PAGE_ID:'1',FB_PAGE_ACCESS_TOKEN:'x',INSTAGRAM_ACCESS_TOKEN:'x',INSTAGRAM_USER_ID:'1',PINTEREST_BOARD_ID:'1',PINTEREST_ACCESS_TOKEN:'x',THREADS_ACCESS_TOKEN:'x',THREADS_USER_ID:'1'};
  const channel=name=>async input=>{calls.push({name,input});return {id:name};},publisher=createPublisher(env,{facebook:channel('facebook'),instagram:channel('instagram'),pinterest:channel('pinterest'),threads:channel('threads')});
  const master='p/Florida-Buzz-Reel.mp4';
  const pkg={id:'p',data:{master,finalReview:{classification:'PASS',master,passedAt:new Date().toISOString()},quality:{finalReview:true},guide:{url:'https://thefloridabuzz.com/article/party'},social:socialCopy(script(),{title:'Guide',url:'https://thefloridabuzz.com/article/party'})}};
  const save=async patch=>{Object.assign(pkg.data,patch);return pkg;};await publisher.publish({pkg,masterUrl:'https://signed.example/reel.mp4',coverImageUrl:'https://thefloridabuzz.com/cover.jpg',save});
  assert.deepEqual(calls.map(c=>c.name),['pinterest','facebook','instagram','threads']);for(const call of calls)assert.equal(call.input.videoUrl,'https://signed.example/reel.mp4');
  assert.ok(Object.values(pkg.data.publication).every(item=>item.status==='POSTED'));
  await publisher.publish({pkg,masterUrl:'https://signed.example/reel.mp4',coverImageUrl:'https://thefloridabuzz.com/cover.jpg',save});assert.equal(calls.length,4,'restart must not duplicate published channels');
});
test('publisher rejects a master without persisted master-specific final QA proof',async()=>{
  const publisher=createPublisher({});
  await assert.rejects(()=>publisher.publish({pkg:{id:'legacy',data:{master:'legacy.mp4'}},masterUrl:'https://signed.example/legacy.mp4',coverImageUrl:'https://example.com/cover.jpg',save:async()=>{}}),/lacks persisted final QA proof/);
});
test('existing adequate guide is reused without insert/update and all guides are searched',async()=>{
  let writes=0;const guide={id:'g',slug:'existing-party',title:'Christmas Party',dek:'Value',body_html:'Existing substantial current guide',image_url:'image'};
  const store={allGuides:async()=>[guide],publishGuide:async()=>{writes++;},updateGuide:async()=>{writes++;}};
  const ai={generateStructuredText:async(system,user,s)=>s.name==='reel_guide_match'?{id:'g',reason:'same subject'}:{adequate:true,reason:'current'}};
  const result=await createEditorial(ai,store,{site:'https://thefloridabuzz.com'}).guide({title:'Christmas party'},facts(),{id:'p'},async()=>{});
  assert.equal(result.handling,'REUSED');assert.equal(result.url,'https://thefloridabuzz.com/article/existing-party');assert.equal(writes,0);
});
test('new substantial guide uses verified facts, relevant existing image and a direct article URL',async()=>{
  let inserted,checkpoint;
  const paragraphs=Array.from({length:6},(_,i)=>({heading:`Planning point ${i+1}`,paragraphs:[Array.from({length:140},()=> 'useful').join(' ')],bullets:[]}));
  const ai={generateStructuredText:async(system,user,s)=>s.name==='reel_guide_match'?{id:'',reason:'no same-subject guide'}:{title:'Christmas party value',dek:'Who gets the most value',sections:paragraphs}};
  const store={allGuides:async()=>[{id:'other',title:'Magic Kingdom morning strategy',dek:'Arrival',image_url:'https://existing.example/castle.jpg'}],publishGuide:async(g,p)=>{inserted=g;return {...g,slug:'guide-christmas'};}};
  const result=await createEditorial(ai,store,{site:'https://thefloridabuzz.com'}).guide({title:'Christmas party value',destination:'Magic Kingdom'},facts(),{id:'p',topic_key:'christmas'},async p=>{checkpoint=p;});
  assert.equal(result.handling,'CREATED');assert.equal(result.url,'https://thefloridabuzz.com/article/guide-christmas');assert.equal(inserted.image_url,'https://existing.example/castle.jpg');assert.match(inserted.body_html,/Official planning information/);assert.ok(checkpoint.guideDraft);assert.equal(inserted.category,'theme-parks');
});
test('Reel guide writer repairs output to the existing validator limits before publishing',async()=>{   let inserted,draftCalls=0;   const sections=words=>Array.from({length:6},(_,i)=>({heading:`Useful section ${i+1}`,paragraphs:[Array.from({length:words},()=> 'useful').join(' ')],bullets:[]}));   const ai={generateStructuredText:async(system,user,s)=>{     if(s.name==='reel_guide_match')return {id:'',reason:'no same-subject guide'};     draftCalls++;     if(draftCalls===1)return {title:'T'.repeat(101),dek:'D'.repeat(201),sections:sections(60)};     assert.match(system,/title of 1–100 characters/);assert.match(system,/900–1200 useful words/);assert.match(system,/without repetitive filler/);     return {title:'Christmas party value guide',dek:'A practical guide based only on verified current details.',sections:sections(160)};   }};   const store={allGuides:async()=>[{id:'other',title:'Magic Kingdom morning strategy',dek:'Arrival',image_url:'https://existing.example/castle.jpg'}],publishGuide:async g=>{inserted=g;return {...g,slug:'guide-christmas'};}};   const result=await createEditorial(ai,store,{site:'https://thefloridabuzz.com'}).guide({title:'Christmas party value',destination:'Magic Kingdom'},facts(),{id:'p',topic_key:'christmas'},async()=>{});   assert.equal(draftCalls,2);assert.equal(result.handling,'CREATED');assert.ok(inserted.title.length<=100);assert.ok(inserted.dek.length<=200); });  test('admin requires authentication and valid CSRF, and approval only changes review state',async()=>{
  const express=require('express'),{createRouter}=require('../lib/reels/router');
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../views'));app.use(express.urlencoded({extended:false}));
  let status='READY_FOR_APPROVAL',decisions=0;
  const pkg={id:'p',data:{script:script(),social:socialCopy(script(),{title:'Guide',url:'https://thefloridabuzz.com/article/guide'})}};
  const store={package:async()=>({...pkg,status}),generations:async()=>[],decision:async(id,action)=>{assert.equal(status,'READY_FOR_APPROVAL');assert.ok(['APPROVED','REJECTED'].includes(action));status=action;decisions++;}};
  app.use('/admin/reels',createRouter({store,cfg:{},env:{ADMIN_PASSWORD:'a-long-test-password'}}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const url=`http://127.0.0.1:${server.address().port}/admin/reels/p`,headers={Authorization:'Basic '+Buffer.from('admin:a-long-test-password').toString('base64')};
    assert.equal((await fetch(url)).status,401);
    const html=await (await fetch(url,{headers})).text();assert.match(html,/READY_FOR_APPROVAL/);assert.match(html,/do not publish|does not publish|never call a social publisher/i);
    const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
    assert.equal((await fetch(url+'/decision',{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:'action=APPROVED&csrf=wrong',redirect:'manual'})).status,403);assert.equal(decisions,0);
    assert.equal((await fetch(url+'/decision',{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'APPROVED',csrf}),redirect:'manual'})).status,303);assert.equal(status,'APPROVED');assert.equal(decisions,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('actual FFmpeg assembly normalizes sequentially, cleans intermediates, and decodes a complete vertical master',async()=>{
  const {createMedia,run}=require('../lib/reels/media'),ffmpeg=require('ffmpeg-static');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-media-test-'));
  try{
    const source=path.join(dir,'color.mp4');await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=navy:s=720x1280:r=24:d=6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source]);
    const raw=path.join(dir,'input.pcm'),audio=path.join(dir,'input.wav'),parts=[],chunks=[];let at=0;const sr=48000;
    ['One.','Two.','Three.','Four.'].forEach((text,i)=>{const pcm=Buffer.alloc(sr*5*2);for(let j=0;j<sr*5;j++)pcm.writeInt16LE(Math.round(Math.sin(j/sr*2*Math.PI*220)*6000),j*2);parts.push(pcm);chunks.push({text,timestamp:[at,at+5]});at+=5;if(i<3){parts.push(Buffer.alloc(sr*.8*2));at+=.8;}});
    await fs.writeFile(raw,Buffer.concat(parts));await run(ffmpeg,['-v','error','-y','-f','s16le','-ar',String(sr),'-ac','1','-i',raw,audio]);
    const output=await createMedia({...config({REELS_SHOT_SECONDS:'6'})}).assemble([source,source,source,source],audio,{chunks},['One.','Two.','Three.','Four.'],dir);
    assert.equal(output.quality.decode,true);assert.equal(output.quality.oldNarrator,false);assert.equal(output.timing.speed,1);assert.ok(Math.abs(output.timing.duration-21.5)<.01);assert.match(await fs.readFile(output.ass,'utf8'),/Four\./);assert.equal((await fs.readdir(dir)).includes('normalized-clips'),false,'temporary normalized clips must be cleaned up');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('sideways media fails deterministic clip review before visual-model review',async()=>{
  const {createMedia,run}=require('../lib/reels/media'),ffmpeg=require('ffmpeg-static');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-sideways-test-'));
  try{
    const sideways=path.join(dir,'sideways.mp4');
    await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=red:s=1280x720:r=24:d=5','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',sideways]);
    const review=await createMedia(config({REELS_SHOT_SECONDS:'5'}),{}).review(sideways,{});
    assert.equal(review.classification,'REGENERATE_ONCE');assert.match(review.issues.join(' '),/aspect ratio|portrait/i);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
