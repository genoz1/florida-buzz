'use strict';
const crypto=require('node:crypto');
const { seeds } = require('./topics');
async function checked(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
function createStore(client, cfg) {
  if (!client) throw new Error('Reel pipeline requires existing Supabase service client');
  const rpc = (name, args) => checked(client.rpc(name, args));
  return {
    async seed() { await checked(client.from('reel_topics').upsert(seeds, { onConflict: 'key', ignoreDuplicates: true })); },
    claim: slot => rpc('reels_claim', { p_slot: slot || null }),
    lease: (token, release = false) => rpc('reels_lease', { p_token: token, p_release: release }),
    pause: (token, reason) => rpc('reels_pause', {p_token:token,p_reason:reason}),
    async beginIdeas(week) {
      const rows=await checked(client.from('reel_idea_batches').upsert({week,status:'CREATING'}, {onConflict:'week',ignoreDuplicates:true}).select('week'));
      return rows.length===1;
    },
    finishIdeas: (week,candidates,status='COMPLETE') => checked(client.from('reel_idea_batches').update({candidates,status}).eq('week',week)),
    save: (token, pkg, patch, status = 'WORKING') => rpc('reels_write', { p_token: token, p_package: pkg.id, p_data: patch, p_status: status }),
    generations: pkg => checked(client.from('reel_generations').select('*').eq('package_id', pkg.id).order('created_at')),
    reserve: (token, pkg, item, quote, balance) => rpc('reels_reserve', { p_token: token, p_package: pkg.id,
      p_kind: item.kind, p_shot: item.shot || 0, p_attempt: item.attempt || 0, p_endpoint: item.endpoint,
      p_input: item.input, p_quote: quote, p_caps: cfg.caps, p_balance: balance }),
    generation: (token, id, patch) => rpc('reels_generation_write', { p_token: token, p_id: id, p_patch: patch }),
    recordBilling: (generation,billing) => checked(client.from('reel_generations')
      .update({actual_usd:billing.amount,billing:billing.events}).eq('id',generation.id)
      .eq('request_id',generation.request_id).is('actual_usd',null)),
    topic: key => checked(client.from('reel_topics').select('*').eq('key', key).single()),
    topics: () => checked(client.from('reel_topics').select('*').order('created_at')),
    addTopics: topics => checked(client.from('reel_topics').upsert(topics, { onConflict: 'key', ignoreDuplicates: true })),
    packages: () => checked(client.from('reel_packages').select('*').order('created_at', { ascending: false }).limit(100)),
    package: id => checked(client.from('reel_packages').select('*').eq('id', id).single()),
    packageForTopic: key => checked(client.from('reel_packages').select('*').eq('topic_key', key).maybeSingle()),
    rejectWorkingForTopic: key => checked(client.from('reel_packages').update({status:'REJECTED',updated_at:new Date().toISOString()}).eq('topic_key',key).eq('status','WORKING').select('id')),
    async allGuides() {
      const guides = [];
      for (let offset = 0; ; offset += 500) {
        const page = await checked(client.from('articles').select('id,slug,title,dek,body_html,category,image_url,published_at').order('id').range(offset, offset + 499));
        guides.push(...page);
        if (page.length < 500) break;
      }
      return guides;
    },
    guide: id => checked(client.from('articles').select('*').eq('id', id).single()),
    updateGuide: (id, guide) => checked(client.from('articles').update(guide).eq('id',id).select('*').single()),
    async publishGuide(guide, pkg) {
      // Stable slug makes a lost insert receipt recoverable without a second guide.
      const slug = `guide-${pkg.topic_key}`;
      const existing = await checked(client.from('articles').select('*').eq('slug', slug).maybeSingle());
      if (existing) return existing;
      return checked(client.from('articles').insert({ slug, title: guide.title, dek: guide.dek,
        body_html: guide.body_html, image_url: guide.image_url, category: guide.category,
        source_name: 'The Florida Buzz', source_url: cfg.site, is_evergreen: true,
        published_at: new Date().toISOString() }).select('*').single());
    },
    async asset(path, bytes, contentType) {
      await checked(client.storage.from(cfg.bucket).upload(path, bytes, { contentType, upsert: true }));
      return path;
    },
    async voice() {
      if(!/^[a-f0-9]{64}$/i.test(cfg.voiceHash||''))throw new Error('Approved private Qwen voice checksum is not configured');
      const blob=await checked(client.storage.from(cfg.bucket).download(cfg.voicePath));
      const bytes=Buffer.from(await blob.arrayBuffer());
      if(crypto.createHash('sha256').update(bytes).digest('hex')!==cfg.voiceHash.toLowerCase())throw new Error('Stored Qwen voice differs from approved voice');
      const signed=await checked(client.storage.from(cfg.bucket).createSignedUrl(cfg.voicePath,86400));
      return signed.signedUrl;
    },
    async signed(path, seconds = 3600) {
      if (!path || path.includes('..')) throw new Error('Invalid asset path');
      const result = await checked(client.storage.from(cfg.bucket).createSignedUrl(path, seconds));
      return result.signedUrl;
    },
    async decision(id, action) {
      if (!['APPROVED', 'REJECTED'].includes(action)) throw new Error('Invalid decision');
      const rows = await checked(client.from('reel_packages').update({ status: action, decision_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'READY_FOR_APPROVAL').select('id'));
      if (rows.length !== 1) throw new Error('Only a ready package may be approved or rejected');
      // This changes review state only. There is deliberately no publishing call.
    },
    async totals() {
      const rows = await checked(client.from('reel_generations').select('created_at,reserved_usd,actual_usd,kind,attempt').order('created_at'));
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const today = day.format(new Date());
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone, weekday: 'short' }).format(new Date());
      const monday = new Date(`${today}T12:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() - ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(weekday));
      const week = monday.toISOString().slice(0, 10);
      const sum = predicate => rows.filter(predicate).reduce((s, r) => s + Number(r.actual_usd ?? r.reserved_usd), 0);
      return { day: sum(r => day.format(new Date(r.created_at)) === today), week: sum(r => day.format(new Date(r.created_at)) >= week),
        month: sum(r => day.format(new Date(r.created_at)).slice(0,7) === today.slice(0,7)),
        actual: rows.reduce((s,r) => s + Number(r.actual_usd || 0), 0), pending: rows.filter(r => r.actual_usd === null).length };
    },
  };
}
module.exports = { createStore, checked };
