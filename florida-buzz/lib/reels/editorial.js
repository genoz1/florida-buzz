'use strict';
const { criteria, strongest, score } = require('./topics');
const str = { type: 'string' }, bool = { type: 'boolean' };
const array = items => ({ type: 'array', items });
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
function validateScript(script, seconds) {
  if (script.thoughts.length !== 4 || script.shots.length !== 4) throw new Error('Four distinct thoughts and four progressive shots required');
  const locations=script.shots.map(s=>String(s.location||'').trim());
  if(locations.some(v=>!v))throw new Error('Every Reel shot requires an explicit real location');
  if(new Set(locations.map(v=>v.toLowerCase())).size!==4)throw new Error('All four Reel shots must use different park locations');
  const stages=script.shots.map(s=>String(s.stage||'').toLowerCase());
  const expectedStages=['arrival','icon','land','experience'];
  if(stages.some((s,i)=>s!==expectedStages[i]))throw new Error('Reel scenes must progress arrival → icon → land → experience');
  const mainStreet=script.shots.map((s,i)=>/main street/i.test(`${s.location} ${s.description}`)?i:-1).filter(i=>i>=0);
  if(mainStreet.some(i=>i>0)||mainStreet.length>1)throw new Error('Main Street may appear only in shot 1');
  const walking=script.shots.filter(s=>{
    const d=String(s.description||'');
    return /\b(guests?|people|visitors?|crowd)\b.{0,60}\b(walk|walking|stroll|strolling|moving)\b/i.test(d)
      || /\b(walk|walking|stroll|strolling|moving)\b.{0,60}\b(guests?|people|visitors?|crowd)\b/i.test(d);
  }).length;
  if(walking>1)throw new Error('Only one Reel scene may primarily show people walking');
  if (!script.thoughts[3].includes('TheFloridaBuzz.com')) throw new Error('Missing Florida Buzz CTA');
  const count = script.thoughts.join(' ').split(/\s+/).length;
  const min = seconds === 5 ? 55 : 64, max = seconds === 5 ? 65 : 78;
  if (count < min || count > max) throw new Error(`Narration copy must contain ${min}–${max} conversational words; never stretch audio`);
  if (unsafe.test(script.thoughts.join(' ') + script.shots.map(s => `${s.location} ${s.description}`).join(' '))) throw new Error('Incident footage is not permitted');
  return script;
}
function promptFor(shot, topic) {
  return `Vertical 9:16 upright portrait ordinary guest handheld iPhone video at ${shot.location}, ${topic.destination} in Florida. ${shot.description} ` +
    'Accurately preserve the named real location, recognizable landmarks, street layout and stable architecture. ' +
    'Realistic casual crowd and stroller motion, normal human walking, slight natural phone shake, tiny autofocus/exposure adjustments, imperfect framing. ' +
    'Camera remains physically upright with the horizon level; never rotate the phone sideways and never output landscape footage inside a portrait frame. Natural available light appropriate to this scene. Observational vacation footage, no staged people, presenter, text, narration, audio, slow motion, drone, cinematic camera move or polished advertisement. ' +
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
      const shape=schema('reel_script', object({hook:str, thoughts:array(str), shots:array(object({stage:str,type:str, location:str, description:str})),
        social:object({facebook:str,instagram:str,pinterest:str,threads:str})}));
      const system='Create a useful conversational travel Reel from the supplied guide. Adult American woman casually advising a friend. Return EXACTLY four spoken thoughts: hook, two useful points, and CTA with TheFloridaBuzz.com. Return EXACTLY four shots in this exact stage order: arrival, icon, land, experience. No first-person visit claims. Avoid formal prose, announcer language, exaggerated negative hooks and invented facts. Build a VISUAL JOURNEY that moves progressively through the park: shot 1 = arrival/entrance approach, shot 2 = central icon or hub, shot 3 = a clearly different themed land or attraction area, shot 4 = a deeper experience/event/detail scene farther into the park. Use four explicitly named, recognizable real locations. Main Street U.S.A. may appear only in shot 1. Do not use more than one people-walking scene. Later shots must change both location and subject/composition: landmark, attraction/land, entertainment/detail/food/ride exterior—not repeated crowds walking. No specific incident or purported live event footage. Prepare distinct platform copy; no publishing.';
      const payload=JSON.stringify({topic, guide, facts, words:cfg.seconds === 5 ? '55–65' : '64–78', seconds:cfg.seconds*4});
      let value=await complete(system,payload,shape);
      try { return validateScript(value,cfg.seconds); }
      catch(firstError) {
        value=await complete('Repair this Reel script to satisfy the validator exactly. Keep the same verified facts and overall message. Return EXACTLY four thoughts and EXACTLY four shots with stages in this exact order: arrival, icon, land, experience. Use four different named park locations. Main Street may appear only in shot 1. At most one shot may primarily show people walking. Keep the CTA in thought 4 with TheFloridaBuzz.com. Keep narration within the required word count. Do not invent facts.',
          JSON.stringify({topic,guide,facts,invalid:value,error:firstError.message,words:cfg.seconds === 5 ? '55–65' : '64–78'}),shape);
        return validateScript(value,cfg.seconds);
      }
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
module.exports = { createEditorial, validateFacts, validateScript, promptFor, socialCopy, escape, primary };
