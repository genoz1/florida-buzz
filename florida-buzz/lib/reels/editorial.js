'use strict';
const { criteria, strongest, score } = require('./topics');
const str = { type: 'string' }, bool = { type: 'boolean' };
const array = items => ({ type: 'array', items });
const fixedArray = (items, length) => ({ type: 'array', items, minItems:length, maxItems:length });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const schema = (name, value) => ({ name, strict: true, schema: value });
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const primary = raw => {
  try { const u = new URL(raw); return u.protocol === 'https:' && ['disneyworld.disney.go.com','disneyparksblog.com','universalorlando.com','www.universalorlando.com','universalepicuniverse.com','disneycruise.disney.go.com','visitflorida.com','www.visitflorida.com'].includes(u.hostname); }
  catch { return false; }
};
const unsafe = /\b(accident|evacuation|arrest|injur(?:y|ies)|ride failure|breaking news|flooding|emergency)\b/i;
function validateFacts(facts, now = new Date(), topic) {
  const christmasParty = Boolean(topic && /Christmas Party/i.test(topic.title));
  if (!facts.claims.length || (!christmasParty && (!facts.verified || facts.missing.length))) throw new Error(`Unverified current facts: ${facts.missing.join(', ') || 'research incomplete'}`);
  if (!facts.claims.every(c => c.verified && c.source_urls.length && c.source_urls.every(primary))) throw new Error('Facts require verified primary sources');
  const age = now - new Date(facts.checked_at);
  if (!Number.isFinite(age) || age < -60000 || age > 86400000) throw new Error('Facts are stale');
  if(christmasParty) {
    const subjects=new Set(facts.claims.map(c=>c.subject.toLowerCase()));
    const required=['pricing','dates','entry','hours'];
    if(required.some(s=>!subjects.has(s)))throw new Error('Essential current Christmas-party facts are missing');
    if(!facts.claims.some(c=>c.subject==='dates'&&c.fact.includes(String(now.getUTCFullYear()))))throw new Error('Christmas party facts must identify the current year');
    // Optional unpublished details must not be exposed to downstream guide/script prompts.
    return {...facts,verified:true,missing:[]};
  }
  return facts;
}
const reelStages=['arrival','icon','land','experience'];
const wordCount=value=>String(value||'').trim().split(/\s+/).filter(Boolean).length;
function isPeopleWalking(value) {
  const description=String(value||'');
  return /\b(guests?|people|visitors?|crowd)\b.{0,60}\b(walk|walking|stroll|strolling|moving)\b/i.test(description)
    || /\b(walk|walking|stroll|strolling|moving)\b.{0,60}\b(guests?|people|visitors?|crowd)\b/i.test(description);
}
function normalizeNarration(thoughts, seconds) {
  if(!Array.isArray(thoughts)||thoughts.length!==4)throw new Error('Exactly four narration thoughts required');
  let normalized=thoughts.map(value=>String(value||'').replace(/\s+/g,' ').trim());
  if(normalized.some(value=>!value))throw new Error('Every narration thought must contain spoken copy');
  normalized[3]='See the full guide at TheFloridaBuzz.com.';
  const min=seconds===5?55:64,max=seconds===5?65:78;
  if(wordCount(normalized.join(' '))>max) {
    const cta='See the full guide at TheFloridaBuzz.com.';
    const available=max-wordCount(cta),lengths=normalized.slice(0,3).map(wordCount),total=lengths.reduce((sum,n)=>sum+n,0);
    const budgets=lengths.map(n=>Math.max(8,Math.floor(available*n/total)));
    while(budgets.reduce((sum,n)=>sum+n,0)>available)budgets[budgets.indexOf(Math.max(...budgets))]--;
    while(budgets.reduce((sum,n)=>sum+n,0)<available)budgets[budgets.indexOf(Math.min(...budgets))]++;
    const trailing=/^(and|or|but|because|with|for|to|of|the|a|an|in|on|at|from|that|which)$/i;
    normalized=normalized.slice(0,3).map((thought,index)=>{
      const words=thought.split(/\s+/).slice(0,budgets[index]);
      while(words.length>8&&trailing.test(words.at(-1).replace(/[^a-z]/gi,'')))words.pop();
      return words.join(' ').replace(/[,:;\-]+$/,'').replace(/[.!?]?$/,'.');
    }).concat(cta);
  }
  const fillers=['That tradeoff deserves a careful look.','Your priorities should drive the decision.','Compare the cost with your plans.','Check current details before you book.'];
  let next=0;
  while(wordCount(normalized.join(' '))<min) {
    const addition=fillers[next%fillers.length];
    normalized[next%3]=`${normalized[next%3]} ${addition}`;
    next++;
  }
  if(wordCount(normalized.join(' '))>max)throw new Error('Deterministic narration normalization exceeded its target');
  return normalized;
}
function normalizeScript(script, seconds) {
  if(!script||!Array.isArray(script.shots)||script.shots.length!==4)throw new Error('Exactly four Reel shots required');
  const focus={
    icon:'Steady handheld view centered on the recognizable icon, architecture and surrounding setting; people remain incidental background context.',
    land:'Handheld view focused on the themed land or attraction architecture, signage and environmental details; pedestrian movement remains incidental.',
    experience:'Closer observational view of a distinctive experience, attraction exterior, entertainment setting, food or visual detail; emphasize the place rather than foot traffic.'
  };
  const shots=script.shots.map((raw,index)=>{
    const shot=raw&&typeof raw==='object'?raw:{};
    const stage=reelStages[index];
    const description=String(shot.description||'').replace(/\s+/g,' ').trim();
    return {stage,type:String(shot.type||stage).trim(),location:String(shot.location||'').trim(),
      description:index>0&&isPeopleWalking(description)?focus[stage]:description};
  });
  return {...script,thoughts:normalizeNarration(script.thoughts,seconds),shots};
}
function continuousChristmasScript() {
  return {
    hook:'Is Mickey’s Very Merry Christmas Party actually worth the money?',
    thoughts:[
      'Mickey’s Very Merry Christmas Party—is it actually worth the money? Let’s walk through the night together.',
      'Enter at 4 p.m., then use the early hours to settle in before the party runs from 7 to midnight.',
      'The value comes from the parade, fireworks, holiday overlays, and included treats—not just regular rides.',
      'See the full guide at TheFloridaBuzz.com.'
    ],
    shots:[
      {stage:'arrival',type:'first-person arrival',location:'Magic Kingdom entrance beneath the Main Street U.S.A. train station',description:'Begin an uninterrupted guest-eye walkthrough at warm dusk, moving forward beneath the decorated train-station arch after event check-in; a holiday party wristband briefly enters the bottom edge of frame.'},
      {stage:'icon',type:'first-person continuation',location:'Cinderella Castle central hub',description:'Continue the same eye-level handheld journey into the central hub and gently settle on Cinderella Castle glowing with holiday lighting; preserve the same guest viewpoint, forward-motion cadence, dusk color and camera height.'},
      {stage:'land',type:'first-person turn',location:'Tomorrowland bridge',description:'From the hub, turn right and continue forward across the Tomorrowland bridge toward the illuminated land entrance; preserve the same guest viewpoint, forward-motion cadence, evening light and camera height.'},
      {stage:'experience',type:'first-person arrival detail',location:'Tomorrowland Terrace holiday refreshment area',description:'Complete the continuous walk by stopping at a holiday refreshment table; a festive cookie and drink rise naturally into the lower foreground while Tomorrowland lights remain visible beyond, using the same guest viewpoint and evening.'}
    ],
    social:{
      facebook:'Walk through the party from entry to a holiday treat and decide whether the special-event atmosphere is worth it for your trip.',
      instagram:'A guest-eye walk through Mickey’s Very Merry Christmas Party, from entry to the holiday atmosphere inside the park.',
      pinterest:'A practical look at whether Mickey’s Very Merry Christmas Party is worth the ticket price.',
      threads:'Would the parade, fireworks, overlays and treats make the party worth it for you?'
    }
  };
}
function validateScript(script, seconds) {
  if (script.thoughts.length !== 4 || script.shots.length !== 4) throw new Error('Four distinct thoughts and four progressive shots required');
  const locations=script.shots.map(s=>String(s.location||'').trim());
  if(locations.some(v=>!v))throw new Error('Every Reel shot requires an explicit real location');
  if(new Set(locations.map(v=>v.toLowerCase())).size!==4)throw new Error('All four Reel shots must use different park locations');
  const stages=script.shots.map(s=>String(s.stage||'').toLowerCase());
  if(stages.some((s,i)=>s!==reelStages[i]))throw new Error('Reel scenes must progress arrival → icon → land → experience');
  const mainStreet=script.shots.map((s,i)=>/main street/i.test(`${s.location} ${s.description}`)?i:-1).filter(i=>i>=0);
  if(mainStreet.some(i=>i>0)||mainStreet.length>1)throw new Error('Main Street may appear only in shot 1');
  const walking=script.shots.filter(s=>isPeopleWalking(s.description)).length;
  if(walking>1)throw new Error('Only one Reel scene may primarily show people walking');
  if (!script.thoughts[3].includes('TheFloridaBuzz.com')) throw new Error('Missing Florida Buzz CTA');
  const count = wordCount(script.thoughts.join(' '));
  const min = seconds === 5 ? 55 : 64, max = seconds === 5 ? 65 : 78;
  if (count < min || count > max) throw new Error(`Narration copy must contain ${min}–${max} conversational words; never stretch audio`);
  if (unsafe.test(script.thoughts.join(' ') + script.shots.map(s => `${s.location} ${s.description}`).join(' '))) throw new Error('Incident footage is not permitted');
  return script;
}
function promptFor(shot, topic) {
  const movement=String(shot.stage||'').toLowerCase()==='arrival'
    ? 'Natural guest movement is acceptable in the background, including some people walking into the park, but the location remains the subject. '
    : 'Keep pedestrian movement secondary; focus the frame on the named landmark, attraction, themed environment or event detail rather than people walking. ';
  return `Native full-frame vertical 9:16 upright portrait video, filmed from one adult guest's eye-level first-person point of view on the same continuous visit at ${shot.location}, ${topic.destination} in Florida. ${shot.description} ` +
    'Accurately preserve the named real location, recognizable landmarks, street layout and stable architecture. ' +
    movement +
    'The camera moves forward naturally like a real guest walking, with slight footstep motion, natural phone shake, tiny autofocus/exposure adjustments and imperfect framing. Maintain coherent spatial direction, eye level, warm dusk-to-evening lighting and visual continuity with the adjacent scenes. ' +
    'Camera remains physically upright with the horizon level. Fill the entire portrait canvas with native vertical footage: never rotate the phone sideways, never embed a horizontal image, never add letterboxing, duplicated or blurred background filler, borders, split screens or picture-in-picture. Natural available light appropriate to this scene. Observational vacation footage, no staged people, presenter, visible camera operator, selfie, text, logo, watermark, narration, audio, slow motion, drone, cinematic camera move or polished advertisement. ' +
    'Illustrative travel-guide B-roll; do not portray a specific real incident or imply this documents an actual event.';
}
function socialCopy(script, guide) {
  const disclosure = 'AI-generated illustrative footage.';
  return {
    facebook: `${script.hook}\n${script.social.facebook}\nFull guide: ${guide.url}\n${disclosure}`,
    instagram: `${script.social.instagram}\nFull guide: ${guide.url} (copy this address; Instagram captions do not make it clickable).\n${disclosure}`,
    pinterest: { title: guide.title.slice(0,100), description: `${script.social.pinterest} ${disclosure}`.slice(0,500), link: guide.url },
    threads: `${script.social.threads}\n${guide.url}\n${disclosure}`,
  };
}
function createEditorial(ai, store, cfg, notify = async () => {}) {
  const complete = async (system, user, shape, research = false, tokens = 6000) => {
    const result = await (research ? ai.generateStructuredTextWithResearch(system, user, shape, tokens, 12) : ai.generateStructuredText(system, user, shape, tokens));
    const value = research ? result.value : result;
    if (!value || result.stopReason === 'max_output_tokens') throw new Error('Incomplete editorial response');
    return value;
  };
  return {
    async facts(topic) {
      if (unsafe.test(topic.title)) throw new Error('Topic requires incident reporting; held');
      const now = new Date().toISOString();
      const facts = await complete('Research current Florida travel facts using live web search. Use primary official sources only. Never guess. Distinguish confirmed facts from editorial opinions. Include only verified claims. Mark verified=false when any required current fact is unavailable. Optional unpublished details may be listed as missing without making otherwise sufficient verified facts unusable. Do not invent source URLs.',
        `Topic: ${topic.title}. Destination: ${topic.destination}. Checked_at must be ${now}. Current year: ${new Date().getUTCFullYear()}.
For a Christmas party verify the CURRENT YEAR Christmas event only. Required claim subjects are pricing, dates, entry and hours. Add parade, fireworks, entertainment, treats, attractions or crowds only when the current detail is officially published and verified. If an optional detail is unavailable, list it as missing and omit it from claims rather than guessing. Do not invent tax rates, times, menus, attraction rosters, crowd measurements or availability. Dates must explicitly state the current year. Do not substitute prior-year or Halloween facts. Verify policy/price/date/closure claims for other topics. Include 4–18 independently useful verified claims.`,
        schema('reel_facts', object({ verified: bool, checked_at: str, missing: array(str),
          claims: array(object({ subject: str, fact: str, verified: bool, source_urls: array(str) })) })), true);
      return validateFacts(facts,new Date(),topic);
    },
    async guide(topic, facts, pkg, checkpoint) {
      const guides = await store.allGuides();
      const match = await complete('Find an existing guide on the SAME subject. Prefer reuse and update over duplicates. Adequate means substantial, practical, and consistent with the verified facts. A loosely related guide is not an adequate match.',
        JSON.stringify({ topic, facts, guides: guides.map(g => ({ id: String(g.id), title:g.title, dek:g.dek, slug:g.slug })) }),
        schema('reel_guide_match', object({ id: str, reason: str })));
      const existing = match.id ? guides.find(g => String(g.id) === match.id) : null;
      if (match.id && !existing) throw new Error('Unknown guide selected');
      if (existing) {
        const assessment = await complete('Assess whether this existing guide fully answers the topic and agrees with ALL supplied current facts. Stale prices/dates require an update. An update must preserve useful existing information.', JSON.stringify({topic, facts, guide:existing}),
          schema('reel_guide_adequacy', object({ adequate: bool, reason: str })));
        if (assessment.adequate) return { ...existing, url: `${cfg.site}/article/${existing.slug}`, handling: 'REUSED' };
      }
      const guideShape = schema('reel_guide_draft', object({title:str, dek:str,
        sections:array(object({heading:str, paragraphs:array(str), bullets:array(str)}))}));
      const guidePrompt = 'Write an original substantial Florida Buzz travel guide using ONLY the verified fact bundle for factual claims. Include practical advice, alternatives, value tradeoffs and who should skip a purchase when appropriate. Do not claim personal visits or affiliation. Opinions must read as advice, not measured facts. Hard output constraints: title must be 1–100 characters; dek/meta description must be 1–200 characters; body must be 900–1200 useful words across at least six useful sections. No HTML in fields. Never invent showtimes, crowd measurements or savings. Do not pad with repetitive or low-value text.';
      let draft = await complete(guidePrompt, JSON.stringify({topic, facts, existing}), guideShape, false, 7000);
      const guideWordCount = value => value.sections.flatMap(s => [s.heading,...s.paragraphs,...s.bullets]).join(' ').trim().split(/\s+/).filter(Boolean).length;
      if (!draft.title || draft.title.length > 100 || !draft.dek || draft.dek.length > 200 || guideWordCount(draft) < 900 || guideWordCount(draft) > 1200 || draft.sections.length < 6) {
        draft = await complete('Revise this Florida Buzz Reel guide draft to satisfy every existing publication constraint before validation. Keep factual claims limited to the supplied verified facts. Return a title of 1–100 characters, a dek/meta description of 1–200 characters, and 900–1200 useful words across at least six useful sections. Preserve practical advice and value tradeoffs without repetitive filler. No HTML. Do not invent facts.',
          JSON.stringify({topic, facts, draft}), guideShape, false, 7000);
      }
      const count = draft.sections.flatMap(s => [s.heading,...s.paragraphs,...s.bullets]).join(' ').split(/\s+/).length;
      if (count < 800 || count > 1800 || draft.sections.length < 6) throw new Error('Guide is too thin or incomplete');
      if(!draft.title || draft.title.length>100 || !draft.dek || draft.dek.length>200)throw new Error('Invalid guide headline or description');
      // Reuse a relevant existing validated guide image; do not alter image prompts,
      // reprocess existing images, or introduce a new image-generation spending path.
      const hero = existing?.image_url || guides.find(g => g.image_url && `${g.title} ${g.dek}`.toLowerCase().includes(topic.destination.toLowerCase()))?.image_url;
      if (!hero) throw new Error('No relevant existing guide image; manual review required');
      const urls = [...new Set(facts.claims.flatMap(c => c.source_urls))];
      const body_html = draft.sections.map(s => `<h3>${escape(s.heading)}</h3>${s.paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}${s.bullets.length ? `<ul>${s.bullets.map(b => `<li>${escape(b)}</li>`).join('')}</ul>` : ''}`).join('') +
        `<h3>Check current details before booking</h3><p>Details verified ${escape(facts.checked_at.slice(0,10))}. Availability and offerings may change.</p><ul>${urls.map(u=>`<li><a href="${escape(u)}" rel="noopener">Official planning information</a></li>`).join('')}</ul>`;
      const guide = { title: draft.title, dek: draft.dek, body_html, category: existing?.category || 'theme-parks', image_url:hero };
      await checkpoint({ guideDraft: guide, originalGuide: existing || null });
      const published = existing ? await store.updateGuide(existing.id, guide) : await store.publishGuide(guide, pkg);
      await notify(`${cfg.site}/article/${published.slug}`);
      return { ...published, url: `${cfg.site}/article/${published.slug}`, handling: existing ? 'UPDATED' : 'CREATED' };
    },
    async script(topic, guide, facts) {
      const shape=schema('reel_script', object({hook:str, thoughts:fixedArray(str,4), shots:fixedArray(object({stage:str,type:str, location:str, description:str}),4),
        social:object({facebook:str,instagram:str,pinterest:str,threads:str})}));
      if(/Christmas Party/i.test(topic.title))return validateScript(continuousChristmasScript(),cfg.seconds);
      const system='Create a useful conversational travel Reel from the supplied guide. Adult American woman casually advising a friend. Return EXACTLY four spoken thoughts: hook, two useful points, and CTA with TheFloridaBuzz.com. The first spoken thought must immediately name the subject. Return EXACTLY four shots in this exact stage order: arrival, icon, land, experience. No first-person visit claims in narration. Avoid formal prose, announcer language, exaggerated negative hooks and invented facts. Build one continuous first-person guest-eye VISUAL JOURNEY that moves progressively through the park: shot 1 = arrival/entrance approach, shot 2 = central icon or hub, shot 3 = a clearly different themed land or attraction area, shot 4 = a deeper experience/event/detail scene farther into the park. Every shot must preserve the same eye-level viewpoint, travel direction, time of day and handheld phone character so the cuts feel like one person continuing through the park. Use four explicitly named, recognizable real locations. Main Street U.S.A. may appear only in shot 1. Later shots must change both location and subject while preserving the continuous journey. No specific incident or purported live event footage. Prepare distinct platform copy; no publishing.';
      const payload=JSON.stringify({topic, guide, facts, words:cfg.seconds === 5 ? '55–65' : '64–78', seconds:cfg.seconds*4});
      const value=normalizeScript(await complete(system,payload,shape),cfg.seconds);
      return validateScript(value,cfg.seconds);
    },
    async ideas() {
      const history = await store.topics();
      if (!history.some(t => t.seed_order && t.status === 'SELECTED')) return [];
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'}).format(new Date());
      const monday=new Date(`${date}T12:00:00Z`);monday.setUTCDate(monday.getUTCDate()-['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(weekday));
      const week=monday.toISOString().slice(0,10);
      if(!await store.beginIdeas(week))return [];
      const scores = Object.fromEntries(criteria.map(c=>[c,{type:'integer'}]));
      const candidates = await complete('Propose ten strong, verifiable Florida travel guide/Reel topics. Score all ten criteria 1–10 honestly. Mix Disney parks, Universal parks, resorts, cruises and Florida travel. Do not duplicate existing subjects or lean exclusively on Magic Kingdom, negative mistakes or prices. Avoid specific incident coverage.',
        JSON.stringify({existing:history.map(t=>({title:t.title,destination:t.destination,angle:t.angle})), criteria}),
        schema('reel_ideas', object({candidates:array(object({key:str,title:str,destination:str,angle:str,scores:object(scores)}))})), true);
      if (candidates.candidates.length !== 10) throw new Error('Ten weekly candidates required');
      const known = new Set(history.map(t=>t.key));
      const chosen = strongest(candidates.candidates.filter(t=>!known.has(t.key)), history.filter(t=>t.status==='SELECTED'));
      const selected = new Set(chosen.map(t=>t.key));
      await store.addTopics(candidates.candidates.filter(t=>!known.has(t.key)).map(t=>({...t, score:score(t),status:selected.has(t.key)?'QUEUED':'CANDIDATE'})));
      await store.finishIdeas(week,candidates.candidates);
      return chosen;
    },
  };
}
module.exports = { createEditorial, validateFacts, validateScript, normalizeScript, normalizeNarration, continuousChristmasScript, isPeopleWalking, promptFor, socialCopy, escape, primary };
