// Thin wrapper around Pinterest's v5 API for creating pins.
// While on Pinterest's "Trial" access tier, pin creation is blocked on the
// production API (returns a 403) — Pinterest requires using their Sandbox API
// instead until "Standard" access is approved. Set PINTEREST_USE_SANDBOX=true
// to test/demo against Sandbox; remove it (or set to false) once Standard
// access is granted to switch back to production automatically.
const { logPost } = require('./postLog');

const PINTEREST_API_BASE = process.env.PINTEREST_USE_SANDBOX === 'true'
  ? 'https://api-sandbox.pinterest.com'
  : 'https://api.pinterest.com';

// In-memory cache for the life of this process — each cron/script run gets a
// fresh process, so this mainly avoids refreshing twice within one run.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function refreshAccessToken() {
  if (!process.env.PINTEREST_REFRESH_TOKEN || !process.env.PINTEREST_APP_ID || !process.env.PINTEREST_APP_SECRET) {
    return null; // no refresh credentials set up — caller falls back to the static env var
  }
  const basicAuth = Buffer.from(`${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`).toString('base64');
  const res = await fetch(`${PINTEREST_API_BASE}/v5/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.PINTEREST_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) {
    console.error(`  [pinterest] token refresh failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + ((data.expires_in || 3600) - 120) * 1000; // refresh 2 min early
  return cachedToken;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;
  return process.env.PINTEREST_ACCESS_TOKEN || null; // fallback for before refresh is set up
}

async function createPin({ imageUrl, title, description, link }) {
  const token = await getAccessToken();
  const res = await fetch(`${PINTEREST_API_BASE}/v5/pins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      link,
      title,
      description,
      board_id: process.env.PINTEREST_BOARD_ID,
      media_source: {
        source_type: 'image_url',
        url: imageUrl,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    await logPost({ platform: 'pinterest', status: 'failed', detail: errText });
    throw new Error(`Pinterest API error ${res.status}: ${errText}`);
  }

  await logPost({ platform: 'pinterest', status: 'success', detail: title ? title.slice(0, 100) : null });
  return res.json();
}

async function createVideoPin({ videoUrl, coverImageUrl, title, description, link }) {
  const token=await getAccessToken();
  if(!token||!process.env.PINTEREST_BOARD_ID)throw new Error('Pinterest video publishing is not configured.');
  const registered=await fetch(`${PINTEREST_API_BASE}/v5/media`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({media_type:'video'})});
  const registration=await registered.json().catch(()=>({}));
  if(!registered.ok)throw new Error(`Pinterest video registration failed: ${JSON.stringify(registration)}`);
  const video=await fetch(videoUrl);if(!video.ok)throw new Error(`Pinterest could not download Reel: ${video.status}`);
  const form=new FormData();for(const [key,value] of Object.entries(registration.upload_parameters||{}))form.append(key,value);
  form.append('file',await video.blob(),'Florida-Buzz-Reel.mp4');
  const uploaded=await fetch(registration.upload_url,{method:'POST',body:form});
  if(!uploaded.ok)throw new Error(`Pinterest video upload failed: ${uploaded.status}`);
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    const response=await fetch(`${PINTEREST_API_BASE}/v5/media/${registration.media_id}`,{headers:{Authorization:`Bearer ${token}`}}),state=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(`Pinterest video status failed: ${JSON.stringify(state)}`);
    if(state.status==='succeeded'){ready=true;break;}if(state.status==='failed')throw new Error(`Pinterest video processing failed: ${JSON.stringify(state)}`);
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  if(!ready)throw new Error('Pinterest video processing did not finish in time.');
  const res=await fetch(`${PINTEREST_API_BASE}/v5/pins`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({link,title,description,board_id:process.env.PINTEREST_BOARD_ID,media_source:{source_type:'video_id',cover_image_url:coverImageUrl,media_id:registration.media_id}})});
  if(!res.ok){const detail=await res.text();await logPost({platform:'pinterest',status:'failed',detail});throw new Error(`Pinterest API error ${res.status}: ${detail}`);}
  await logPost({platform:'pinterest',status:'success',detail:title?.slice(0,100)});return res.json();
}

module.exports = { createPin, createVideoPin };
