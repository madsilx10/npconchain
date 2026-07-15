const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const CLIENT_ID   = "VC1weFM5WXJOQmxXZzI4TGZqcEs6MTpjaQ";
const REDIRECT_URI = "https://npconchain.xyz/api/airdrop/x/callback";
const SCOPE       = "tweet.read users.read";
const UA          = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const FOLLOW_TARGET = "npconchain";

let BEARER = '';
let CREATE_TWEET_QID = 'SoVnbfCycZ7fERGCwpZkYA'; // fallback, di-update saat fetchBearer

async function fetchBearer() {
  const pages = [
    'https://x.com/i/flow/login',
    'https://twitter.com/i/flow/login',
    'https://x.com/login',
    'https://x.com/',
  ];

  let jsUrl = null;
  for (const page of pages) {
    try {
      const r = await axios.get(page, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        maxRedirects: 3,
        validateStatus: null,
      });
      const html = typeof r.data === 'string' ? r.data : '';
      const m = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-f0-9]+\.js/);
      if (m) { jsUrl = m[0]; console.log('[*] Found main.js:', jsUrl); break; }
    } catch {}
  }

  if (!jsUrl) throw new Error('main.js URL not found in any X page');

  const js = await axios.get(jsUrl, {
    headers: { 'User-Agent': UA },
    validateStatus: null,
  });
  const src = typeof js.data === 'string' ? js.data : '';
  const patterns = [
    /AAAA+[A-Za-z0-9%+=\/-]*NRILg[A-Za-z0-9%+=\/-]+/,
    /Bearer['" ]+([A-Za-z0-9%+=\/-]{80,})/,
    /AAAA[A-Za-z0-9%+=\/-]{50,}/,
  ];
  let m = null;
  for (const p of patterns) { m = src.match(p); if (m) break; }
  if (!m) throw new Error('Bearer not found in main.js');

  BEARER = m[1] || m[0];
  console.log('[*] Bearer fetched OK');

  // Extract CreateTweet queryId dinamis dari bundle
  const qm = src.match(/"CreateTweet"\s*[,:{][^}]*?"queryId"\s*:\s*"([^"]{10,})"/);
  if (qm) {
    CREATE_TWEET_QID = qm[1];
    console.log('[*] CreateTweet queryId:', CREATE_TWEET_QID);
  } else {
    console.log('[!] CreateTweet queryId not found in bundle, using fallback:', CREATE_TWEET_QID);
  }
}

// Sesuaikan key-nya kalau ternyata beda di response tasks
const DAILY_TASK_KEYS = new Set(["daily_tweet", "daily_post", "daily_share"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genPKCE() {
  const verifier  = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function genState() {
  return crypto.randomBytes(16).toString('base64url');
}

function delay(min = 1500, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise(r => setTimeout(r, ms));
}

function xHeaders(authToken, ct0, contentType = 'application/x-www-form-urlencoded') {
  return {
    'Authorization': `Bearer ${BEARER}`,
    'Cookie': `auth_token=${authToken}; ct0=${ct0}`,
    'X-Csrf-Token': ct0,
    'User-Agent': UA,
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Client-Language': 'en',
    'Content-Type': contentType,
  };
}

// ─── NPC + Twitter OAuth ─────────────────────────────────────────────────────

async function getGuestToken() {
  const r = await axios.get('https://x.com', {
    headers: { 'User-Agent': UA },
    validateStatus: null,
  });
  const html = typeof r.data === 'string' ? r.data : '';

  // Coba dari cookie set-cookie
  for (const c of [].concat(r.headers['set-cookie'] || [])) {
    const m = c.match(/gt=(\d+)/);
    if (m) return m[1];
  }

  // Coba dari __NEXT_DATA__ atau embedded JSON
  const patterns = [
    /"gt"\s*:\s*"?(\d+)"?/,
    /"guestToken"\s*:\s*"?(\d+)"?/,
    /gt=(\d+)/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }

  throw new Error('guest token not found in x.com');
}
// 1. GET /api/airdrop/x/start → NPC generate state di server, redirect ke Twitter
// 2. Tangkap Twitter URL + session cookie NPC
// 3. Approve OAuth di Twitter → dapat code
// 4. GET /api/airdrop/x/callback?code=...&state=... + session cookie NPC → airdrop_session

async function startNpcOAuth() {
  const r = await axios.get('https://npconchain.xyz/api/airdrop/x/start', {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://npconchain.xyz/airdrop',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    },
    maxRedirects: 0,
    validateStatus: null,
  });

  const twitterUrl = r.headers['location'] || '';
  if (!twitterUrl.includes('x.com') && !twitterUrl.includes('twitter.com')) {
    throw new Error(`/api/airdrop/x/start no Twitter redirect: ${r.status} ${twitterUrl.slice(0,200)}`);
  }

  // Simpan semua cookie NPC dari response ini (berisi session state)
  const npcCookies = [].concat(r.headers['set-cookie'] || [])
    .map(c => c.split(';')[0]).join('; ');

  // Ekstrak state dari Twitter URL
  const parsed = new URL(twitterUrl);
  const state = parsed.searchParams.get('state') || '';

  return { twitterUrl, npcCookies, state };
}

async function twitterAuth(authToken, ct0, twitterUrl) {
  // Normalize domain + gunakan internal API path
  const apiUrl = twitterUrl
    .replace('https://twitter.com/', 'https://x.com/')
    .replace('/i/oauth2/authorize', '/i/api/2/oauth2/authorize');

  // Step 1: GET auth_code — butuh Bearer (valid) + Cookie
  const r1 = await axios.get(apiUrl, {
    headers: {
      'Authorization': `Bearer ${BEARER}`,
      'Cookie': `auth_token=${authToken}; ct0=${ct0}`,
      'X-Csrf-Token': ct0,
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Client-Language': 'en',
      'Referer': 'https://x.com/',
      'Origin': 'https://x.com',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
    validateStatus: null,
  });
  if (r1.status !== 200) throw new Error(`GET authorize: ${r1.status} ${JSON.stringify(r1.data).slice(0,200)}`);

  const authCode = r1.data?.auth_code;
  if (!authCode) throw new Error(`No auth_code: ${JSON.stringify(r1.data).slice(0,300)}`);

  // Step 2: POST approve → redirect_uri dengan code
  const r2 = await axios.post(
    'https://x.com/i/api/2/oauth2/authorize',
    `approval=true&code=${authCode}`,
    { headers: xHeaders(authToken, ct0), validateStatus: null }
  );
  if (r2.status !== 200) throw new Error(`POST authorize: ${r2.status} ${JSON.stringify(r2.data).slice(0,200)}`);

  const redirect = r2.data?.redirect_uri || '';
  const url = new URL(redirect);
  const code = url.searchParams.get('code');
  if (!code) throw new Error(`No code in redirect: ${JSON.stringify(r2.data).slice(0,200)}`);

  return code;
}

// ─── NPC Session ──────────────────────────────────────────────────────────────

async function getAirdropSession(code, state, npcCookies) {
  const r = await axios.get(`${REDIRECT_URI}?code=${code}&state=${state}`, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://npconchain.xyz/airdrop',
      'Cookie': npcCookies,
    },
    maxRedirects: 0,
    validateStatus: null,
  });

  for (const c of [].concat(r.headers['set-cookie'] || [])) {
    const m = c.match(/airdrop_session=([^;]+)/);
    if (m) return m[1];
  }

  const location = r.headers['location'];
  if (location) {
    const r2 = await axios.get(location.startsWith('http') ? location : `https://npconchain.xyz${location}`, {
      headers: { 'User-Agent': UA, 'Cookie': npcCookies },
      maxRedirects: 0,
      validateStatus: null,
    });
    for (const c of [].concat(r2.headers['set-cookie'] || [])) {
      const m = c.match(/airdrop_session=([^;]+)/);
      if (m) return m[1];
    }
  }

  console.log('[DEBUG] status:', r.status);
  console.log('[DEBUG] set-cookie:', JSON.stringify(r.headers['set-cookie']));
  console.log('[DEBUG] location:', r.headers['location']);
  throw new Error(`No airdrop_session. Status: ${r.status}`);
}

// ─── NPC API ──────────────────────────────────────────────────────────────────

async function npc(method, path, session, body = null) {
  const r = await axios({
    method,
    url: `https://npconchain.xyz${path}`,
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      'Origin': 'https://npconchain.xyz',
      'Referer': 'https://npconchain.xyz/airdrop',
      'Cookie': `airdrop_session=${session}`,
    },
    data: body,
    validateStatus: null,
  });
  return r.data;
}

// ─── Twitter Actions ──────────────────────────────────────────────────────────

async function followX(authToken, ct0) {
  const r = await axios.post(
    'https://api.twitter.com/1.1/friendships/create.json',
    `screen_name=${FOLLOW_TARGET}`,
    { headers: xHeaders(authToken, ct0), validateStatus: null }
  );
  return r.status === 200
    ? { ok: true }
    : { ok: false, err: JSON.stringify(r.data).slice(0, 200) };
}

async function postTweet(authToken, ct0, text, attempt = 0) {
  const qid = CREATE_TWEET_QID;
  const payload = {
    variables: {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
      withDownvotePerspective: false,
      withReactionsMetadata: false,
      withReactionsPerspective: false,
    },
    features: {
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      freedom_of_speech_not_reach_the_federation_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_fetch_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    },
    queryId: qid,
  };

  const r = await axios.post(
    `https://x.com/i/api/graphql/${qid}/CreateTweet`,
    payload,
    { headers: xHeaders(authToken, ct0, 'application/json'), validateStatus: null }
  );

  if (r.status === 200) {
    try {
      // Cek errors array dulu sebelum tweet_results
      const errors = r.data?.errors;
      if (errors?.length) {
        const e0 = errors[0];
        const code = e0?.code || e0?.extensions?.code;
        const msg  = e0?.message || JSON.stringify(e0);
        // 226 = AuthorizationError (akun locked/restricted/read-only) — jangan retry
        if (code === 226 || e0?.extensions?.name === 'AuthorizationError') {
          return { ok: false, err: `Akun restricted/locked (code 226): ${msg}` };
        }
        // 32 = bad auth token
        if (code === 32 || e0?.extensions?.name === 'Unauthorized') {
          return { ok: false, err: `Auth token invalid (code 32): ${msg}` };
        }
        // 187 = duplicate tweet
        if (code === 187) {
          return { ok: false, err: `Duplicate tweet (code 187) — tweet sebelumnya identik` };
        }
        return { ok: false, err: `Twitter error code ${code}: ${msg}` };
      }

      const tweetResults = r.data?.data?.create_tweet?.tweet_results;
      if (!tweetResults || Object.keys(tweetResults).length === 0) {
        if (attempt < 1) {
          console.log(`    [RETRY] tweet_results empty, waiting 60s...`);
          await new Promise(r => setTimeout(r, 60000));
          const padded = text + '\u200b'.repeat(attempt + 2);
          return postTweet(authToken, ct0, padded, attempt + 1);
        }
        return { ok: false, err: `tweet_results empty after ${attempt + 1} tries: ${JSON.stringify(r.data).slice(0, 200)}` };
      }
      // Handle berbagai kemungkinan struktur response
      const res      = tweetResults.result || tweetResults;
      const tweetId  = res?.rest_id || res?.legacy?.id_str;
      const username = res?.core?.user_results?.result?.legacy?.screen_name
                    || res?.legacy?.user_id_str; // fallback
      if (!tweetId) return { ok: false, err: `No tweetId: ${JSON.stringify(r.data).slice(0, 300)}` };
      if (!username) return { ok: false, err: `No username: ${JSON.stringify(r.data).slice(0, 300)}` };
      return { ok: true, url: `https://x.com/${username}/status/${tweetId}` };
    } catch (e) {
      return { ok: false, err: `Parse error: ${e.message} | ${JSON.stringify(r.data).slice(0, 200)}` };
    }
  }
  return { ok: false, err: `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` };
}

// ─── Build Tweet Text ─────────────────────────────────────────────────────────

const TWEET_OPENERS = [
  'join me on NPC \u00b7 Playable Characters',
  'hopping on NPC \u00b7 Playable Characters',
  'just joined NPC \u00b7 Playable Characters',
  'gm \u2014 found NPC \u00b7 Playable Characters',
  'been on NPC \u00b7 Playable Characters lately',
  'NPC \u00b7 Playable Characters is live',
  'check out NPC \u00b7 Playable Characters',
];
const TWEET_CTA = [
  'grab an invite code (one-time use):',
  "here's an invite code if you need one:",
  'dropping invite codes here:',
  'invite codes available (first come first served):',
  'got invite codes, grab one:',
  'use one of these invite codes:',
];

function buildTweetText(referralCodes, attempt = 0) {
  const codes  = referralCodes.map(c => c.code).join('\n');
  const opener = TWEET_OPENERS[attempt % TWEET_OPENERS.length];
  const cta    = TWEET_CTA[(attempt + 1) % TWEET_CTA.length];
  // zero-width space varies per attempt supaya X tidak deteksi duplikat
  const pad    = '\u200b'.repeat((attempt % 3) + 1);
  return `${opener}${pad}\n${cta}\n\n${codes}\n\nhttps://npconchain.xyz/airdrop`;
}

// ─── Posted URL Cache (posted.json) ──────────────────────────────────────────
// Key: auth_token (unik per akun X)

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveJson(file, authToken, value) {
  const data = loadJson(file);
  data[authToken] = value;
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const POSTED_FILE   = 'posted.json';    // auth_token -> tweet url
const FOLLOWED_FILE = 'followed.json';  // auth_token -> true
const SESSION_FILE  = 'sessions.json';  // auth_token -> airdrop_session

async function getOrCreateSession(authToken, ct0) {
  const cached = loadJson(SESSION_FILE)[authToken];
  if (cached) {
    try {
      const me = await npc('GET', '/api/airdrop/me', cached);
      if (me?.user) {
        console.log('[+] Session dari cache OK');
        return cached;
      }
    } catch {}
    console.log('[!] Session cache expired, OAuth ulang...');
  }

  console.log('[*] NPC OAuth start...');
  const { twitterUrl, npcCookies, state } = await startNpcOAuth();
  console.log('[*] Twitter OAuth...');
  const code = await twitterAuth(authToken, ct0, twitterUrl);
  console.log('[*] Getting airdrop_session...');
  const session = await getAirdropSession(code, state, npcCookies);
  saveJson(SESSION_FILE, authToken, session);
  console.log('[+] Session OK (disimpan)');
  return session;
}

// ─── Main Process ─────────────────────────────────────────────────────────────

async function runAccount(authToken, ct0, wallet, refCode, mode = 'all') {
  const tag = wallet.slice(0, 10) + '...';
  console.log(`\n${'='.repeat(40)}`);
  console.log(`[*] ${tag}`);

  // OAuth atau load session dari cache
  let session;
  try {
    if (mode === 'connect') {
      // Force OAuth baru walau ada cache
      console.log('[*] NPC OAuth start...');
      const { twitterUrl, npcCookies, state } = await startNpcOAuth();
      console.log('[*] Twitter OAuth...');
      const code = await twitterAuth(authToken, ct0, twitterUrl);
      console.log('[*] Getting airdrop_session...');
      session = await getAirdropSession(code, state, npcCookies);
      saveJson(SESSION_FILE, authToken, session);
      console.log('[+] Session OK (disimpan)');
      return; // mode connect selesai di sini
    }
    session = await getOrCreateSession(authToken, ct0);
  } catch (e) {
    console.log(`[!] ${e.message}`);
    return;
  }

  // Get /me (referral codes)
  const me = await npc('GET', '/api/airdrop/me', session);
  const referralCodes = me?.referral_codes || [];
  const xHandle = me?.user?.x_handle || tag;
  console.log(`[*] @${xHandle}`);

  // Referral + Wallet (skip di mode post, sudah pernah disubmit sebelumnya)
  let r;
  if (mode === 'post') {
    console.log(`    [SKIP] referral & wallet (mode: post)`);
  } else {
    console.log(`[*] Referral: ${refCode}`);
    r = await npc('POST', '/api/airdrop/referral', session, { code: refCode });
    console.log(`    -> ${JSON.stringify(r)}`);
    await delay();

    console.log(`[*] Wallet: ${wallet}`);
    r = await npc('POST', '/api/airdrop/wallet', session, { wallet });
    console.log(`    -> ${JSON.stringify(r)}`);
    await delay();
  }

  // Tasks
  console.log('[*] Fetching tasks...');
  const tasksResp = await npc('GET', '/api/airdrop/tasks', session);
  const tasks = tasksResp?.tasks || [];
  console.log(`[*] ${tasks.length} tasks found`);

  // ── Follow ──
  if (mode === 'post') {
    console.log(`    [SKIP] follow (mode: post)`);
  } else if (loadJson(FOLLOWED_FILE)[authToken]) {
    console.log(`    [SKIP] follow (already followed)`);
  } else {
    console.log(`[*] Follow @${FOLLOW_TARGET}...`);
    const fw = await followX(authToken, ct0);
    if (fw.ok) {
      saveJson(FOLLOWED_FILE, authToken, true);
      console.log(`[+] Followed @${FOLLOW_TARGET}`);
    } else {
      console.log(`[!] Follow: ${fw.err}`);
    }
    console.log('[*] Waiting 60s sebelum tweet...');
    await new Promise(r => setTimeout(r, 60000));
  }

  // ── Post tweet ──
  let tweetUrl = loadJson(POSTED_FILE)[authToken] || null;

  const postTask = tasks.find(t => t.key === 'genesis_post_link');
  if (postTask?.claimed) {
    console.log(`    [SKIP] genesis_post_link (already claimed)`);
  } else if (mode === 'daily' || mode === 'daily+task') {
    console.log(`    [SKIP] genesis_post_link (mode: ${mode})`);
  } else if (tweetUrl) {
    console.log(`[+] Tweet (from cache): ${tweetUrl}`);
  } else if (referralCodes.length === 0) {
    console.log(`    [SKIP] genesis_post_link (no referral codes)`);
  } else {
    console.log('[*] Posting tweet...');
    const tw = await postTweet(authToken, ct0, buildTweetText(referralCodes, 0));
    if (tw.ok) {
      tweetUrl = tw.url;
      saveJson(POSTED_FILE, authToken, tweetUrl);
      console.log(`[+] Tweet: ${tweetUrl}`);
    } else {
      console.log(`[!] Tweet failed: ${tw.err}`);
    }
    await delay();
  }

  // Process semua tasks
  for (const task of tasks) {
    const key = task.key || '';
    const tid = task.id  || '';
    const pts = task.points || 0;

    if (task.claimed) {
      console.log(`    [SKIP] ${key} (already claimed)`);
      continue;
    }

    // Skip berdasarkan mode
    if (mode === 'post') {
      // post mode: skip semua task kecuali genesis_post_link
      if (key !== 'genesis_post_link') {
        console.log(`    [SKIP] ${key} (mode: post)`);
        continue;
      }
    } else if (mode === 'daily') {
      if (!DAILY_TASK_KEYS.has(key)) {
        console.log(`    [SKIP] ${key} (mode: daily)`);
        continue;
      }
    } else if (mode === 'daily+task') {
      // skip genesis_post_link aja
      if (key === 'genesis_post_link') {
        console.log(`    [SKIP] ${key} (mode: daily+task)`);
        continue;
      }
    }
    // mode 'all': jalanin semua

    if (key === 'genesis_post_link') {
      if (!tweetUrl) {
        console.log(`    [SKIP] ${key} (no tweet url)`);
        continue;
      }
      console.log(`    [CLAIM] ${key} (${pts} pts)...`);
      r = await npc('POST', '/api/airdrop/claim', session, { task_id: tid, proof_url: tweetUrl });
    } else {
      console.log(`    [CLAIM] ${key} (${pts} pts)...`);
      r = await npc('POST', '/api/airdrop/claim', session, { task_id: tid });
    }

    console.log(`    -> ${JSON.stringify(r)}`);
    await delay();
  }

  console.log(`[+] Done: @${xHandle}`);
}

// ─── CLI Menu ─────────────────────────────────────────────────────────────────

function ask(rl, q) {
  return new Promise(res => rl.question(q, res));
}

// ─── Mode: Check Status ──────────────────────────────────────────────────────
async function checkStatus(authToken) {
  const sessionMap = loadJson(SESSION_FILE);
  const session    = sessionMap[authToken] || null;

  if (!session) {
    console.log('  Tweet    : ⚠️  no session (run mode 5 dulu)');
    console.log('  Task Post: ⚠️  no session');
    return;
  }

  try {
    const me = await npc('GET', '/api/airdrop/me', session);
    if (!me?.user) {
      console.log('  Tweet    : ⚠️  session expired (run mode 5 dulu)');
      console.log('  Task Post: ⚠️  session expired');
      return;
    }

    const tasksResp = await npc('GET', '/api/airdrop/tasks', session);
    const tasks     = tasksResp?.tasks || [];
    const postTask  = tasks.find(t => t.key === 'daily_spread_word_v2');

    const taskClaimed = postTask?.claimed ?? null;
    const tweetUrl    = postTask?.metadata?.url || postTask?.data?.url || null;

    const tweetLine = tweetUrl
      ? `✅ ${tweetUrl}`
      : taskClaimed
        ? '✅ (tidak ada URL tersimpan)'
        : '❌ belum post';

    const taskLine  = taskClaimed === true  ? '✅ sudah claim'
                    : taskClaimed === false ? '❌ belum claim'
                    : '⚠️  task tidak ditemukan';

    console.log(`  Tweet    : ${tweetLine}`);
    console.log(`  Task Post: ${taskLine}`);
  } catch (e) {
    console.log(`  ⚠️  Error: ${e.message}`);
  }
}


async function main() {
  // Load akun.txt: auth_token, ct0, blank (per akun)
  let akunLines;
  try {
    akunLines = fs.readFileSync('akun.txt', 'utf8').split('\n').map(l => l.trim());
  } catch {
    console.log('[!] akun.txt not found');
    return;
  }

  // Load wallet.txt: satu address per baris
  let wallets;
  try {
    wallets = fs.readFileSync('wallet.txt', 'utf8')
      .split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    console.log('[!] wallet.txt not found');
    return;
  }

  // Load reff.txt: satu ref code per baris, paired by index (1 reff sekali pake)
  let reffs;
  try {
    reffs = fs.readFileSync('reff.txt', 'utf8')
      .split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    console.log('[!] reff.txt not found');
    return;
  }

  // Parse akun.txt: tiap akun = auth_token, ct0, lalu blank
  const accounts = [];
  let i = 0;
  while (i < akunLines.length) {
    while (i < akunLines.length && !akunLines[i]) i++;
    if (i >= akunLines.length) break;
    const auth_token = akunLines[i++];
    const ct0        = akunLines[i++] || '';
    accounts.push({ auth_token, ct0 });
    while (i < akunLines.length && !akunLines[i]) i++;
  }

  // Pair akun + wallet + reff by index
  accounts.forEach((a, idx) => {
    a.wallet = wallets[idx] || '';
    a.reff   = reffs[idx]   || '';
  });
  const validAccounts = accounts.filter(a => a.auth_token && a.ct0 && a.wallet);

  console.log(`\n[*] ${validAccounts.length} accounts loaded`);
  if (!validAccounts.length) { console.log('[!] No valid accounts'); return; }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Pilih akun
  console.log('\nPilih akun:');
  console.log('1. 1 akun');
  console.log('2. Semua');
  console.log('3. Range');
  const pil = (await ask(rl, 'Pilih: ')).trim();

  let selected;
  if (pil === '1') {
    const idx = parseInt(await ask(rl, `Nomor akun (1-${validAccounts.length}): `)) - 1;
    selected = validAccounts.slice(idx, idx + 1);
  } else if (pil === '3') {
    const from = parseInt(await ask(rl, 'From (1-based): ')) - 1;
    const to   = parseInt(await ask(rl, 'To (1-based, inclusive): '));
    selected = validAccounts.slice(from, to);
  } else {
    selected = validAccounts;
  }

  // Pilih mode
  console.log('\nMode:');
  console.log('1. All');
  console.log('2. Daily');
  console.log('3. Post');
  console.log('4. Daily + Task (skip post)');
  console.log('5. Connect X (save session only)');
  console.log('6. Check Status');
  const modePil = (await ask(rl, 'Pilih: ')).trim();
  const mode = modePil === '2' ? 'daily'
             : modePil === '3' ? 'post'
             : modePil === '4' ? 'daily+task'
             : modePil === '5' ? 'connect'
             : modePil === '6' ? 'check'
             : 'all';

  rl.close();

  console.log(`\n[*] Running ${selected.length} account(s) | Mode: ${mode}`);

  for (let j = 0; j < selected.length; j++) {
    const { auth_token, ct0, wallet, reff } = selected[j];
    console.log(`\n[${j + 1}/${selected.length}]`);
    if (mode === 'check') {
      await checkStatus(auth_token, `[${j + 1}/${selected.length}]`);
    } else {
      await runAccount(auth_token, ct0, wallet, reff, mode);
    }

    if (j < selected.length - 1) {
      const s = (Math.random() * 5 + 5).toFixed(1);
      console.log(`\n[*] Cooldown ${s}s...`);
      await new Promise(r => setTimeout(r, parseFloat(s) * 1000));
    }
  }

  console.log('\n[*] All done');
}

main().catch(console.error);
