'use strict';

// Prefer article content over navigation, cookie notices and related-story cards.
// This supplies evidence to the writer; it never grants source text authority.
function extractSourceText(html) {
  const clean=String(html||'').replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ');
  const articles=[...clean.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m=>m[1]);
  const main=clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const content=articles.length ? articles.sort((a,b)=>b.length-a.length)[0] : main ? main[1] : clean;
  const text=content.replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi,'\n')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&ndash;/gi,'–').replace(/&mdash;/gi,'—')
    .replace(/&rdquo;|&ldquo;/gi,'"').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();
  return text.length>=200 ? text.slice(0,12000) : null;
}

function feedEvidence(item) {
  // Full feed HTML often contains the actual facts omitted by contentSnippet.
  return item['content:encoded'] || item.content || item.contentSnippet || item.title;
}
module.exports={extractSourceText,feedEvidence};
