'use strict';
const { KLING, SEEDANCE, SEEDANCE_IMAGE, QWEN, WHISPER, MERGE_VIDEOS, MERGE_AUDIO_VIDEO, AUTO_SUBTITLE } = require('./config');
const ENDPOINTS = new Set([KLING, SEEDANCE, SEEDANCE_IMAGE, QWEN, WHISPER]);
const UTILITIES = new Set([MERGE_VIDEOS, MERGE_AUDIO_VIDEO, AUTO_SUBTITLE]);
function queueUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'queue.fal.run' || url.username || url.password) throw new Error('Unexpected fal queue URL');
  return url.href;
}
function createFal({ falKey, billingKey }, fetcher = fetch) {
  async function json(url, method = 'GET', body, billing = false) {
    const response = await fetcher(url, { method, redirect: 'error',
      headers: { Authorization: `Key ${billing ? billingKey : falKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    if (!response.ok) {
      let detail='';try{detail=JSON.stringify(await response.json());}catch{}
      const error=new Error(`fal ${response.status}; inspect request in fal dashboard`);
      error.refusal=/moderation|safety|content_policy|refus/i.test(detail);
      throw error;
    }
    return response.json();
  }
  const platform = (path, query = {}) => json(`https://api.fal.ai/v1/${path}?${new URLSearchParams(query)}`, 'GET', undefined, true);
  return {
    async quote(endpoint, quantity) {
      if (!ENDPOINTS.has(endpoint)) throw new Error('Unapproved model');
      const data = await platform('models/pricing', { endpoint_id: endpoint });
      const price = data.prices?.find(p => p.endpoint_id === endpoint);
      const seedance = endpoint === SEEDANCE || endpoint === SEEDANCE_IMAGE;
      const validUnit = seedance ? /token|second/i : endpoint === KLING ? /second/i : endpoint === QWEN ? /character|1000/i : /second|minute/i;
      if (!price || price.currency !== 'USD' || !validUnit.test(price.unit) || !(price.unit_price > 0)) throw new Error('Model pricing unavailable or changed; manual review required');
      // Qwen is billed in thousand-character blocks; reserve at least one block.
      const roundedCharacters=Math.max(1000,Math.ceil(quantity/1000)*1000);
      const videoTokens=720*1280*quantity*24/1024;
      const units = endpoint === QWEN ? (/1000|1k|thousand/i.test(price.unit)?roundedCharacters/1000:roundedCharacters)
        : seedance && /token/i.test(price.unit) ? (/1000|1k|thousand/i.test(price.unit)?videoTokens/1000:videoTokens)
        : endpoint === WHISPER && /minute/i.test(price.unit) ? quantity / 60 : quantity;
      return { ...price, quantity: units, amount: Math.ceil(price.unit_price * units * 1e6 - 1e-9) / 1e6 };
    },
    async balance() {
      const data = await platform('account/billing', { expand: 'credits' });
      if (data.credits?.currency !== 'USD' || !Number.isFinite(data.credits?.current_balance)) throw new Error('Cannot verify existing fal balance');
      return data.credits.current_balance;
    },
    async submit(endpoint, input) {
      if (!ENDPOINTS.has(endpoint)) throw new Error('Unapproved model');
      const result = await json(`https://queue.fal.run/${endpoint}`, 'POST', input);
      if (!result.request_id) throw new Error('Missing fal request ID; do not resubmit');
      return { request_id: result.request_id, status_url: queueUrl(result.status_url), response_url: queueUrl(result.response_url) };
    },
    async submitUtility(endpoint, input) {
      if (!UTILITIES.has(endpoint)) throw new Error('Unapproved utility');
      const result = await json(`https://queue.fal.run/${endpoint}`, 'POST', input);
      if (!result.request_id) throw new Error('Missing fal utility request ID; do not resubmit');
      return { request_id: result.request_id, status_url: queueUrl(result.status_url), response_url: queueUrl(result.response_url) };
    },
    async poll(generation) {
      const status = await json(queueUrl(generation.status_url));
      if (status.error || status.error_type) return { failed: true, refusal: /moderation|safety|content_policy|refus/i.test(`${status.error} ${status.error_type}`) };
      if (status.status !== 'COMPLETED') return null;
      try { return { result: await json(queueUrl(generation.response_url)) }; }
      catch (error) { return { failed: true, refusal: error.refusal===true, error: error.message }; }
    },
    async actual(generation) {
      let data;
      try {
        data = await platform('models/billing-events', { request_id: generation.request_id, start: generation.created_at, limit: '100' });
      } catch (error) {
        // A completed request must not strand the one controlled production
        // package when fal throttles its reporting API. The reservation came
        // from fal's live price quote immediately before submission, so it is
        // the conservative charge to persist until the dashboard catches up.
        if (/fal 429/.test(error.message) && Number.isFinite(Number(generation.reserved_usd))) {
          return { amount:Number(generation.reserved_usd), events:[{
            request_id:generation.request_id, endpoint_id:generation.endpoint,
            cost_total:Number(generation.reserved_usd), source:'verified-reservation-fallback'
          }] };
        }
        throw error;
      }
      // This query is already scoped to one provider request ID. fal can report
      // the concrete serving route instead of the submitted alias, so matching
      // endpoint_id as well can strand a completed request indefinitely.
      const events = data.billing_events?.filter(e => e.request_id === generation.request_id);
      if (!events?.length) return null;
      if (events.some(e => !Number.isFinite(e.cost_total) || e.cost_total < 0)) throw new Error('Invalid fal billing record');
      return { amount: events.reduce((s, e) => s + e.cost_total, 0), events };
    },
  };
}
module.exports = { createFal, queueUrl };
