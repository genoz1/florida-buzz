'use strict';

const fs = require('fs');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';

function youtubeConfigured(cfg) {
  return !!(cfg.youtubeClientId && cfg.youtubeClientSecret && cfg.youtubeRefreshToken);
}

async function responseError(response, label) {
  const detail = (await response.text()).slice(0, 2000);
  return new Error(`${label} failed (${response.status}): ${detail}`);
}

async function accessToken(cfg, fetchImpl = fetch) {
  if (!youtubeConfigured(cfg)) throw new Error('YouTube OAuth credentials are not configured');
  const body = new URLSearchParams({
    client_id: cfg.youtubeClientId,
    client_secret: cfg.youtubeClientSecret,
    refresh_token: cfg.youtubeRefreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw await responseError(response, 'YouTube OAuth refresh');
  const data = await response.json();
  if (!data.access_token) throw new Error('YouTube OAuth refresh returned no access token');
  return data.access_token;
}

async function beginResumableUpload({ cfg, token, metadata, fileSize, fetchImpl = fetch }) {
  const endpoint = `${UPLOAD_URL}?part=snippet,status&uploadType=resumable&notifySubscribers=false`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(fileSize),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw await responseError(response, 'YouTube resumable upload start');
  const location = response.headers.get('location');
  if (!location) throw new Error('YouTube did not return a resumable upload URL');
  return location;
}

async function uploadVideo({ cfg, filePath, title, description, tags = [], privacyStatus, madeForKids = false, fetchImpl = fetch }) {
  const stat = await fs.promises.stat(filePath);
  const token = await accessToken(cfg, fetchImpl);
  const metadata = {
    snippet: {
      title: String(title || 'Florida Buzz Disney Podcast').slice(0, 100),
      description: String(description || '').slice(0, 5000),
      tags: tags.map(String).slice(0, 30),
      categoryId: '24',
    },
    status: {
      privacyStatus: privacyStatus || cfg.youtubePrivacyStatus || 'private',
      selfDeclaredMadeForKids: !!madeForKids,
      embeddable: true,
      license: 'youtube',
    },
  };
  const location = await beginResumableUpload({ cfg, token, metadata, fileSize: stat.size, fetchImpl });
  const response = await fetchImpl(location, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': String(stat.size),
      'Content-Type': 'video/mp4',
    },
    body: fs.createReadStream(filePath),
    duplex: 'half',
  });
  if (!response.ok) throw await responseError(response, 'YouTube video upload');
  const video = await response.json();
  if (!video.id) throw new Error('YouTube upload completed without a video ID');
  return { id: video.id, url: `https://youtu.be/${video.id}`, privacyStatus: metadata.status.privacyStatus, token };
}

/** Upload a custom thumbnail so Studio does not fall back to the cover frame. */
async function uploadThumbnail({ cfg, videoId, imageBuffer, token, fetchImpl = fetch }) {
  const access = token || (await accessToken(cfg, fetchImpl));
  const endpoint = `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'image/png',
      'Content-Length': String(imageBuffer.length),
    },
    body: imageBuffer,
  });
  if (!response.ok) throw await responseError(response, 'YouTube thumbnail upload');
  return response.json();
}

module.exports = { accessToken, beginResumableUpload, uploadThumbnail, uploadVideo, youtubeConfigured };
