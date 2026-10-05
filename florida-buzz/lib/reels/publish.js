'use strict';
const {postToFacebookPage}=require('../facebook');
const {createPost:createInstagramPost}=require('../instagram');
const {createPost:createThreadsPost}=require('../threads');
const {createVideoPin}=require('../pinterest');

function createPublisher(env=process.env,channels={facebook:postToFacebookPage,instagram:createInstagramPost,pinterest:createVideoPin,threads:createThreadsPost}) {
  const required=['FB_PAGE_ID','FB_PAGE_ACCESS_TOKEN','INSTAGRAM_ACCESS_TOKEN','INSTAGRAM_USER_ID','PINTEREST_BOARD_ID','THREADS_ACCESS_TOKEN','THREADS_USER_ID'];
  return {async publish({pkg,masterUrl,coverImageUrl,save}) {
    if(!pkg.data?.guide?.url)throw new Error('Reel guide URL missing; publication blocked');
    if(!masterUrl||!coverImageUrl)throw new Error('Reel master or Pinterest cover missing; publication blocked');
    const missing=required.filter(key=>!env[key]);if(missing.length)throw new Error(`Reel social publishing credentials missing: ${missing.join(', ')}`);
    if(!env.PINTEREST_ACCESS_TOKEN&&!(env.PINTEREST_REFRESH_TOKEN&&env.PINTEREST_APP_ID&&env.PINTEREST_APP_SECRET))throw new Error('Reel social publishing credentials missing: Pinterest access or refresh credentials');
    let journal={...(pkg.data.publication||{})};
    const run=async(name,fn)=>{
      if(journal[name]?.status==='POSTED')return;
      if(journal[name])throw new Error(`${name} Reel publication is ambiguous; review before retrying`);
      journal={...journal,[name]:{status:'SUBMITTING',startedAt:new Date().toISOString()}};await save({publication:journal});
      try {const result=await fn();journal={...journal,[name]:{status:'POSTED',id:result?.id||result?.postId||null,postedAt:new Date().toISOString()}};await save({publication:journal});}
      catch(error){journal={...journal,[name]:{...journal[name],status:'AMBIGUOUS',error:error.message}};await save({publication:journal});throw error;}
    };
    const social=pkg.data.social,guide=pkg.data.guide;
    await run('pinterest',()=>channels.pinterest({videoUrl:masterUrl,coverImageUrl,title:social.pinterest.title,description:social.pinterest.description,link:social.pinterest.link}));
    await run('facebook',()=>channels.facebook({message:social.facebook,link:guide.url,videoUrl:masterUrl,returnResult:true,logDetail:`Reel ${pkg.id}`}));
    await run('instagram',()=>channels.instagram({caption:social.instagram,videoUrl:masterUrl,logDetail:`Reel ${pkg.id}`}));
    await run('threads',()=>channels.threads({text:social.threads,videoUrl:masterUrl}));
    return journal;
  }};
}
module.exports={createPublisher};
