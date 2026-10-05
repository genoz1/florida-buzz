require('dotenv').config();
const {production,slotFor}=require('../lib/reels');
async function main() {
  const runtime=production();
  const install=process.argv.indexOf('--install-voice');
  if(install>=0) {
    const bytes=await require('node:fs/promises').readFile(process.argv[install+1]);
    const checksum=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    if(checksum!==runtime.cfg.voiceHash)throw new Error('File does not match configured approved Qwen voice checksum');
    await runtime.store.asset(runtime.cfg.voicePath,bytes,'application/octet-stream');
    console.log('Approved voice installed in private storage. No generation submitted.');return;
  }
  if(!runtime.cfg.enabled||!runtime.cfg.generation)throw new Error('Reel feature and generation gates must be explicitly enabled');
  if(!runtime.cfg.falKey||!process.env.OPENAI_API_KEY)throw new Error('Existing provider credentials required');
  if(Object.values(runtime.cfg.caps).some(v=>v<=0))throw new Error('Explicit positive spending caps required before any live work');
  await runtime.store.seed();
  const result=process.argv.includes('--ideas')?await runtime.editorial.ideas():await runtime.pipeline.tick(process.argv.includes('--start')?slotFor():undefined);
  console.log(JSON.stringify(result,null,2));
}
if(require.main===module)main().catch(err=>{console.error('[reels]',err.message);process.exitCode=1;});
module.exports={main};
