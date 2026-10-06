'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const normalize = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function run(binary, args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const process = spawn(binary, args, { stdio: ['ignore','pipe','pipe'] });
    let stdout = Buffer.alloc(0), stderr = '';
    const timer = setTimeout(() => process.kill('SIGKILL'), timeout);
    process.stdout.on('data', b => { stdout = Buffer.concat([stdout,b]); if(stdout.length>15e6) process.kill('SIGKILL'); });
    process.stderr.on('data', b => { stderr = (stderr+b).slice(-10000); });
    process.once('error', err => { clearTimeout(timer); reject(err); });
    process.once('close', code => { clearTimeout(timer); code===0 ? resolve(stdout) : reject(new Error(`Media command failed (${code}): ${stderr.slice(-800)}`)); });
  });
}
function wordBoundaries(thoughts, chunks) {
  const expected = normalize(thoughts.join(' '));
  if (normalize(chunks.map(c=>c.text).join(' ')) !== expected) throw new Error('Narration transcript differs from approved script; manual review');
  let offset = 0;
  const words = chunks.map(c => {
    if (!Array.isArray(c.timestamp) || !c.timestamp.every(Number.isFinite) || c.timestamp[0] > c.timestamp[1]) throw new Error('Invalid word timing');
    const w = {...c, offset}; offset += normalize(c.text).length; return w;
  });
  offset = 0;
  const boundaries = thoughts.slice(0,-1).map(t => {
    offset += normalize(t).length;
    const index = words.findIndex(w=>w.offset >= offset);
    if (index <= 0) throw new Error('Cannot locate spoken thought boundary');
    return (words[index-1].timestamp[1]+words[index].timestamp[0])/2;
  });
  return { words, boundaries };
}
function naturalPauses(pcm, sampleRate, thoughts, chunks, pauses = [.4,.4,.7]) {
  const { words, boundaries } = wordBoundaries(thoughts, chunks);
  const hop = Math.round(sampleRate * .005), samples = pcm.length / 2, quiet = [];
  for (let i=0; i+hop<=samples; i+=hop) {
    let sum=0; for(let j=0;j<hop;j++) sum+=(pcm.readInt16LE((i+j)*2)/32768)**2;
    quiet.push(Math.sqrt(sum/hop)<10**(-38/20));
  }
  const gaps=[]; let start=null;
  quiet.concat(false).forEach((q,i)=>{ if(q && start===null) start=i; if(!q && start!==null) { if((i-start)*.005>=.05) gaps.push([start*.005,i*.005]); start=null; } });
  const selected=boundaries.map((b,i)=>{
    const options=gaps.filter(g=>Math.abs((g[0]+g[1])/2-b)<.6).sort((a,c)=>Math.abs((a[0]+a[1])/2-b)-Math.abs((c[0]+c[1])/2-b));
    if (!options.length) throw new Error('No safe silent boundary; do not cut speech');
    return [...options[0],pauses[i]];
  });
  if (selected.some((g,i)=>i && selected[i-1][1]>=g[0])) throw new Error('Overlapping pause boundaries');
  const parts=[]; let last=0;
  for (const [s,e,p] of selected) { parts.push(pcm.subarray(Math.round(last*sampleRate)*2,Math.round(s*sampleRate)*2),Buffer.alloc(Math.round(p*sampleRate)*2)); last=e; }
  parts.push(pcm.subarray(Math.round(last*sampleRate)*2));
  const remap = v => {
    let delta=0;
    for(const [s,e,p] of selected) { if(v>=e) delta+=p-(e-s); else if(v>=s) return s+delta+(v-s)/(e-s)*p; }
    return v+delta;
  };
  const audio=Buffer.concat(parts);
  return { pcm:audio, duration:audio.length/2/sampleRate, words:words.map(w=>({...w,timestamp:w.timestamp.map(remap)})), pauses:selected, speed:1 };
}
function fitDuration(duration, videoDuration) {
  if (duration < videoDuration*.75 || duration > videoDuration-.2) throw new Error('Narration does not fit: revise copy manually; never slow or stretch speech');
}
const stamp = n => {const c=Math.round(n*100);return `${Math.floor(c/360000)}:${String(Math.floor(c/6000)%60).padStart(2,'0')}:${String(Math.floor(c/100)%60).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
function captions(words, duration) {
  const safe = s=>s.replace(/[{}\\\r\n]/g,' ');
  let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,DejaVu Sans,43,&H00FFFFFF,&H00FFFFFF,&H00191919,&HA0000000,-1,0,0,0,100,100,0,0,1,3,1,2,58,58,250,1\nStyle: Brand,DejaVu Sans,22,&H00FFFFFF,&H00FFFFFF,&H00303030,&HA0000000,-1,0,0,0,100,100,2,0,1,1.5,0,7,45,45,90,1\nStyle: Label,DejaVu Sans,18,&H00FFFFFF,&H00FFFFFF,&H00303030,&HA0000000,0,0,0,0,100,100,0,0,1,1,0,7,45,45,122,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,${stamp(0)},${stamp(duration)},Brand,,0,0,0,,FLORIDA BUZZ\nDialogue: 0,${stamp(0)},${stamp(duration)},Label,,0,0,0,,AI-generated illustrative footage\n`;
  const groups=[];
  for(const word of words) {
    const last=groups.at(-1);
    if(!last || last.words.length>=5 || word.timestamp[0]-last.end>.28 || last.text.length+word.text.length>45) groups.push({words:[word],text:word.text.trim(),start:word.timestamp[0],end:word.timestamp[1]});
    else {last.words.push(word);last.text+=' '+word.text.trim();last.end=word.timestamp[1];}
  }
  for(const [i,g] of groups.entries()) {
    const end=Math.min(i+1<groups.length?groups[i+1].start-.02:duration,Math.max(g.end,g.start+.1)+.15);
    if(g.start<0 || end>duration || end<=g.start) throw new Error('Caption timing outside Reel');
    const w=safe(g.text).split(' ');const text=w.length>3?w.slice(0,Math.ceil(w.length/2)).join(' ')+'\\N'+w.slice(Math.ceil(w.length/2)).join(' '):safe(g.text);
    ass+=`Dialogue: 1,${stamp(g.start)},${stamp(end)},Caption,,0,0,0,,${text}\n`;
  }
  return ass;
}
function createMedia(cfg, env=process.env) {
  const ffmpeg=require('ffmpeg-static'), ffprobe=require('ffprobe-static').path;
  async function probe(file) {return JSON.parse((await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file])).toString());}
  async function download(url, file) {
    const u=new URL(url); const storageHost=env.SUPABASE_URL?new URL(env.SUPABASE_URL).hostname:'';
    if(u.protocol!=='https:' || !(u.hostname==='fal.media'||u.hostname.endsWith('.fal.media')||u.hostname===storageHost)) throw new Error('Unexpected media URL');
    const response=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(120000)});
    if(!response.ok) throw new Error('Source media download failed');
    const reader=response.body.getReader();let length=0;const handle=await fs.open(file,'w');
    try {
      while(true){
        const {done,value}=await reader.read();if(done)break;
        length+=value.length;if(length>104857600){await reader.cancel();throw new Error('Source exceeds media size limit');}
        await handle.write(Buffer.from(value));
      }
    } catch(error) {
      await fs.rm(file,{force:true}).catch(()=>{});throw error;
    } finally {await handle.close();}
    return file;
  }
  const frames=async(file,dir,seconds)=>{
    const output=[];
    for(const [i,time] of [.25,1,2,3,seconds-.25].entries()) {
      const frame=path.join(dir,`frame-${i}.jpg`);
      await run(ffmpeg,['-v','error','-y','-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=360:640',frame]);
      output.push(await fs.readFile(frame));
    }
    return output;
  };
  return { probe, download,
    async prepareNarration(audio, transcript, thoughts, dir) {
      const sr=48000;
      const pcm=await run(ffmpeg,['-v','error','-i',audio,'-f','s16le','-ac','1','-ar',String(sr),'pipe:1']);
      const timing=naturalPauses(pcm,sr,thoughts,transcript.chunks), duration=cfg.seconds*4;
      fitDuration(timing.duration,duration);
      const raw=path.join(dir,'narration-paused.pcm'), ass=path.join(dir,'captions.ass'), paused=path.join(dir,'Narration-Qwen.wav');
      await fs.writeFile(raw,timing.pcm);await fs.writeFile(ass,captions(timing.words,duration));
      await run(ffmpeg,['-v','error','-y','-f','s16le','-ar',String(sr),'-ac','1','-i',raw,paused]);
      return {ass,paused,timing:{duration:timing.duration,pauses:timing.pauses,speed:1,words:timing.words},quality:{audio:true,captions:true,oldNarrator:false}};
    },
    async review(file, context) {
      const info=await probe(file), v=info.streams.find(s=>s.codec_type==='video');
      const rotation=Number(v?.tags?.rotate ?? v?.side_data_list?.find(x=>Number.isFinite(Number(x.rotation)))?.rotation ?? 0);
      if(rotation%360!==0)return {classification:'REGENERATE_ONCE',issues:['Clip is rotated or sideways'],correction:'Keep the phone physically upright with a level horizon; output true portrait video with no rotation metadata.'};
      if(!v || v.width*16!==v.height*9 || Number(info.format.duration)<cfg.seconds-.15) return {classification:'REGENERATE_ONCE',issues:['Wrong aspect ratio or truncated clip'],correction:'Use a complete upright 9:16 portrait shot.'};
      if(v.width<720||v.height<1280)return {classification:'MANUAL_REVIEW',issues:['Source below 720×1280; automatic upscaling is disabled'],correction:''};
      const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-review-'));
      try {
        const images=await frames(file,dir,cfg.seconds);
        const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),
          body:JSON.stringify({model:env.REELS_REVIEW_MODEL||env.AI_IMAGE_VALIDATION_MODEL||env.AI_TEXT_MODEL||'gpt-5.6-terra',
            instructions:'Review five ordered frames from a travel-guide video for visible severe artifacts and temporal instability. Check malformed/reversed heads, hands, duplicate guests, sliding or impossible walking, backwards strollers, disappearing objects, severe flicker, warped or changing landmarks/buildings, wrong location, broken prominent signage, impossible camera motion. Reject only genuinely unusable clips. PASS plausible tourist footage. REGENERATE_ONCE only a clear correctable severe failure. MANUAL_REVIEW when evidence is ambiguous or motion cannot be judged confidently. Do not demand perfect tiny background faces or signage. Return actual visible defects, not speculative ones.',
            input:[{role:'user',content:[{type:'input_text',text:JSON.stringify(context)},...images.map(b=>({type:'input_image',image_url:`data:image/jpeg;base64,${b.toString('base64')}`,detail:'high'}))]}],
            max_output_tokens:1500,text:{format:{type:'json_schema',name:'reel_clip_review',strict:true,schema:{type:'object',properties:{classification:{type:'string',enum:['PASS','REGENERATE_ONCE','MANUAL_REVIEW']},issues:{type:'array',items:{type:'string'}},correction:{type:'string'}},required:['classification','issues','correction'],additionalProperties:false}}}})});
        if(!response.ok) throw new Error('Video quality reviewer unavailable');
        const result=await response.json();if(result.status!=='completed')throw new Error('Incomplete video review');
        const text=result.output_text||(result.output||[]).flatMap(o=>(o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text)).join('');
        const review=JSON.parse(text);
        if(!['PASS','REGENERATE_ONCE','MANUAL_REVIEW'].includes(review.classification)||!Array.isArray(review.issues))throw new Error('Invalid quality review');
        return review;
      } finally {await fs.rm(dir,{recursive:true,force:true});}
    },
    async finalReview(file, context) {
      const info=await probe(file),v=info.streams.find(s=>s.codec_type==='video');
      const rotation=Number(v?.tags?.rotate ?? v?.side_data_list?.find(x=>Number.isFinite(Number(x.rotation)))?.rotation ?? 0);
      if(!v||v.width!==720||v.height!==1280||rotation%360!==0)return {classification:'MANUAL_REVIEW',issues:['Final Reel is not true upright 720×1280 portrait video']};
      const duration=Number(info.format.duration),dir=await fs.mkdtemp(path.join(os.tmpdir(),'reel-final-review-'));
      try {
        const times=[.5,2.5,5.5,7.5,10.5,12.5,15.5,Math.max(0,duration-.5)].filter(t=>t<duration);
        const images=[];
        for(const [i,time] of times.entries()){
          const frame=path.join(dir,`final-${i}.jpg`);
          await run(ffmpeg,['-v','error','-y','-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=360:640',frame]);
          images.push(await fs.readFile(frame));
        }
        const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),
          body:JSON.stringify({model:env.REELS_REVIEW_MODEL||env.AI_IMAGE_VALIDATION_MODEL||env.AI_TEXT_MODEL||'gpt-5.6-terra',
            instructions:'Review the assembled vertical travel Reel as a whole. FAIL unless: (1) every scene is visually upright with a level horizon, never sideways; (2) the video clearly progresses through the park in four stages—arrival/entry, central icon/hub, themed land/attraction area, deeper experience/event/detail scene; (3) the four shots are meaningfully different locations AND compositions, not repeated crowds or people walking; (4) Main Street may appear only in the first stage; later shots must visibly move deeper into different park areas; (5) no more than one scene may primarily be people walking; (6) captions are fully visible in a safe lower-middle area, not in the bottom social-app control zone and not clipped; (7) no severe AI artifacts. Be strict: a Reel that feels like four variations of the same walkway/crowd scene is a publication failure.',
            input:[{role:'user',content:[{type:'input_text',text:JSON.stringify(context)},...images.map(b=>({type:'input_image',image_url:`data:image/jpeg;base64,${b.toString('base64')}`,detail:'high'}))]}],
            max_output_tokens:1200,text:{format:{type:'json_schema',name:'final_reel_review',strict:true,schema:{type:'object',properties:{classification:{type:'string',enum:['PASS','MANUAL_REVIEW']},issues:{type:'array',items:{type:'string'}}},required:['classification','issues'],additionalProperties:false}}}})});
        if(!response.ok)throw new Error('Final Reel reviewer unavailable');
        const result=await response.json();if(result.status!=='completed')throw new Error('Incomplete final Reel review');
        const text=result.output_text||(result.output||[]).flatMap(o=>(o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text)).join('');
        const review=JSON.parse(text);
        if(!['PASS','MANUAL_REVIEW'].includes(review.classification)||!Array.isArray(review.issues))throw new Error('Invalid final Reel review');
        return review;
      } finally {await fs.rm(dir,{recursive:true,force:true});}
    },
    async assemble(clips, audio, transcript, thoughts, dir) {
      const sr=48000;
      const pcm=await run(ffmpeg,['-v','error','-i',audio,'-f','s16le','-ac','1','-ar',String(sr),'pipe:1']);
      const timing=naturalPauses(pcm,sr,thoughts,transcript.chunks), duration=cfg.seconds*4;
      fitDuration(timing.duration,duration);
      const raw=path.join(dir,'narration-paused.pcm'), ass=path.join(dir,'captions.ass'), master=path.join(dir,'Florida-Buzz-Reel.mp4');
      await fs.writeFile(raw,timing.pcm);await fs.writeFile(ass,captions(timing.words,duration));

      // Normalize source clips sequentially so production never decodes all four
      // 720x1280 inputs in one FFmpeg graph. This keeps peak memory bounded.
      const work=path.join(dir,'normalized-clips');
      await fs.mkdir(work,{recursive:true});
      try {
        const normalized=[];
        for(let i=0;i<clips.length;i++) {
          const out=path.join(work,`clip-${i+1}.mp4`);
          await run(ffmpeg,['-v','error','-y','-i',clips[i],'-an',
            '-vf',`scale=720:1280,setsar=1,fps=24,trim=duration=${cfg.seconds},setpts=PTS-STARTPTS`,
            '-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p',out]);
          normalized.push(out);
        }

        const list=path.join(work,'concat.txt');
        const escapeConcat=file=>file.replace(/'/g,"'\\''");
        await fs.writeFile(list,normalized.map(file=>`file '${escapeConcat(file)}'`).join('\n'));
        const joined=path.join(work,'joined.mp4');
        await run(ffmpeg,['-v','error','-y','-f','concat','-safe','0','-i',list,'-c','copy',joined]);

        await run(ffmpeg,['-v','error','-y','-i',joined,'-f','s16le','-ar',String(sr),'-ac','1','-i',raw,
          '-filter_complex',`[0:v]ass=${ass}[v];[1:a]acompressor=threshold=0.12:ratio=1.5:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7,apad[a]`,
          '-map','[v]','-map','[a]','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p',
          '-c:a','aac','-b:a','160k','-ar',String(sr),'-t',String(duration),'-movflags','+faststart',master]);
      } finally {
        await fs.rm(work,{recursive:true,force:true});
      }

      const info=await probe(master);
      if(!info.streams.some(s=>s.codec_type==='audio')||!info.streams.some(s=>s.codec_type==='video'&&s.width===720&&s.height===1280)||Math.abs(Number(info.format.duration)-duration)>.15)throw new Error('Rendered Reel failed stream/duration validation');
      // Decode the entire final media to catch truncation or invalid packets.
      await run(ffmpeg,['-v','error','-i',master,'-f','null','-']);
      const paused=path.join(dir,'Narration-Qwen.wav');
      await run(ffmpeg,['-v','error','-y','-f','s16le','-ar',String(sr),'-ac','1','-i',raw,paused]);
      return {master,ass,paused,timing:{duration:timing.duration,pauses:timing.pauses,speed:1,words:timing.words},quality:{vertical:true,audio:true,decode:true,captions:true,oldNarrator:false}};
    },
  };
}
module.exports={createMedia,naturalPauses,wordBoundaries,fitDuration,captions,run};
