const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const CLIENT_ID   = "VC1weFM5WXJOQmxXZzI4TGZqcEs6MTpjaQ";
const REDIRECT_URI = "https://npconchain.xyz/api/airdrop/x/callback";
const SCOPE       = "tweet.read users.read";
const BEARER      = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const UA          = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const FOLLOW_TARGET = "npconchain";

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

// ─── Twitter OAuth (PKCE) ─────────────────────────────────────────────────────

async function twitterAuth(authToken, ct0) {
  const { challenge } = genPKCE();
  const state = genState();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state,
  });

  // Step 1: GET authorize → auth_code
  const r1 = await axios.get(`https://x.com/i/api/2/oauth2/authorize?${params}`, {
    headers: xHeaders(authToken, ct0),
    validateStatus: null,
  });
  if (r1.status !== 200) throw new Error(`GET authorize: ${r1.status} ${JSON.stringify(r1.data).slice(0,200)}`);

  const authCode = r1.data?.auth_code;
  if (!authCode) throw new Error(`No auth_code: ${JSON.stringify(r1.data).slice(0,200)}`);

  // Step 2: POST authorize (approve) → redirect dengan code
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

  return { code, state };
}

// ─── NPC Session ──────────────────────────────────────────────────────────────

async function getAirdropSession(code, state) {
  const r = await axios.get(`${REDIRECT_URI}?code=${code}&state=${state}`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://npconchain.xyz/airdrop' },
    maxRedirects: 10,
    validateStatus: null,
  });

  const cookies = [].concat(r.headers['set-cookie'] || []);
  for (const c of cookies) {
    const m = c.match(/airdrop_session=([^;]+)/);
    if (m) return m[1];
  }
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

async function postTweet(authToken, ct0, text) {
  const payload = {
    variables: {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
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
    },
    queryId: 'a1p9RWpkYKBjWv_I3WzS-A',
  };

  const r = await axios.post(
    'https://twitter.com/i/api/graphql/a1p9RWpkYKBjWv_I3WzS-A/CreateTweet',
    payload,
    { headers: xHeaders(authToken, ct0, 'application/json'), validateStatus: null }
  );

  if (r.status === 200) {
    try {
      const res      = r.data.data.create_tweet.tweet_results.result;
      const tweetId  = res.rest_id;
      const username = res.core.user_results.result.legacy.screen_name;
      return { ok: true, url: `https://x.com/${username}/status/${tweetId}` };
    } catch {
      return { ok: false, err: JSON.stringify(r.data).slice(0, 200) };
    }
  }
  return { ok: false, err: JSON.stringify(r.data).slice(0, 200) };
}

// ─── Build Tweet Text ─────────────────────────────────────────────────────────

function buildTweetText(referralCodes) {
  const codes = referralCodes.map(c => c.code).join('\n');
  return `join me on NPC · Playable Characters\ngrab an invite code (one-time use):\n\n${codes}\n\nhttps://npconchain.xyz/airdrop`;
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

// ─── Main Process ─────────────────────────────────────────────────────────────

async function process(authToken, ct0, wallet, refCode, mode = 'all') {
  const tag = wallet.slice(0, 10) + '...';
  console.log(`\n${'='.repeat(40)}`);
  console.log(`[*] ${tag}`);

  // Twitter OAuth
  console.log('[*] Twitter OAuth...');
  let code, state;
  try {
    ({ code, state } = await twitterAuth(authToken, ct0));
  } catch (e) {
    console.log(`[!] ${e.message}`);
    return;
  }

  // NPC session
  console.log('[*] Getting airdrop_session...');
  let session;
  try {
    session = await getAirdropSession(code, state);
  } catch (e) {
    console.log(`[!] ${e.message}`);
    return;
  }
  console.log('[+] Session OK');

  // Get /me (referral codes)
  const me = await npc('GET', '/api/airdrop/me', session);
  const referralCodes = me?.referral_codes || [];
  const xHandle = me?.user?.x_handle || tag;
  console.log(`[*] @${xHandle}`);

  // Referral
  console.log(`[*] Referral: ${refCode}`);
  let r = await npc('POST', '/api/airdrop/referral', session, { code: refCode });
  console.log(`    -> ${JSON.stringify(r)}`);
  await delay();

  // Wallet
  console.log(`[*] Wallet: ${wallet}`);
  r = await npc('POST', '/api/airdrop/wallet', session, { wallet });
  console.log(`    -> ${JSON.stringify(r)}`);
  await delay();

  // Tasks
  console.log('[*] Fetching tasks...');
  const tasksResp = await npc('GET', '/api/airdrop/tasks', session);
  const tasks = tasksResp?.tasks || [];
  console.log(`[*] ${tasks.length} tasks found`);

  // ── Follow ──
  // Cek followed.json — kalau sudah, skip total, zero API call ke Twitter
  if (loadJson(FOLLOWED_FILE)[authToken]) {
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
    await delay();
  }

  // ── Post tweet ──
  // Cek posted.json dulu — kalau ada, pakai URL lama, zero API call ke Twitter
  let tweetUrl = loadJson(POSTED_FILE)[authToken] || null;

  const postTask = tasks.find(t => t.key === 'genesis_post_link');
  if (postTask?.claimed) {
    console.log(`    [SKIP] genesis_post_link (already claimed)`);
  } else if (mode === 'daily') {
    console.log(`    [SKIP] genesis_post_link (not daily)`);
  } else if (tweetUrl) {
    console.log(`[+] Tweet (from cache): ${tweetUrl}`);
  } else if (referralCodes.length === 0) {
    console.log(`    [SKIP] genesis_post_link (no referral codes)`);
  } else {
    console.log('[*] Posting tweet...');
    const tw = await postTweet(authToken, ct0, buildTweetText(referralCodes));
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

    // Daily mode: skip task yg bukan daily
    if (mode === 'daily' && !DAILY_TASK_KEYS.has(key)) {
      console.log(`    [SKIP] ${key} (not daily)`);
      continue;
    }

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
  const modePil = (await ask(rl, 'Pilih: ')).trim();
  const mode = modePil === '2' ? 'daily' : 'all';

  rl.close();

  console.log(`\n[*] Running ${selected.length} account(s) | Mode: ${mode}`);

  for (let j = 0; j < selected.length; j++) {
    const { auth_token, ct0, wallet, reff } = selected[j];
    console.log(`\n[${j + 1}/${selected.length}]`);
    await process(auth_token, ct0, wallet, reff, mode);

    if (j < selected.length - 1) {
      const s = (Math.random() * 5 + 5).toFixed(1);
      console.log(`\n[*] Cooldown ${s}s...`);
      await new Promise(r => setTimeout(r, parseFloat(s) * 1000));
    }
  }

  console.log('\n[*] All done');
}

main().catch(console.error);
