import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createApp, loadConfig } from '../server.mjs';

const SECRET = 'client-secret-VALUE-for-tests';
const COOKIE_SECRET = 'c'.repeat(40);
const PUBLIC = 'https://kendo-baikal.ru';

// ---- мок GitHub ----
let gh, ghUrl;
const codes = new Map(); // code -> login (одноразовые)
const revoked = [];
let userStatus = 200;
let tokenMode = 'ok';

before(async () => {
  gh = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
      const p = JSON.parse(body);
      assert.equal(p.client_secret, SECRET);
      if (tokenMode === 'fail') return json(500, { message: 'boom' });
      const login = codes.get(p.code);
      if (!login) return json(200, { error: 'bad_verification_code' });
      codes.delete(p.code); // повторное использование кода → ошибка, как у GitHub
      return json(200, { access_token: `gho_token_${login}`, token_type: 'bearer' });
    }
    if (req.method === 'GET' && req.url === '/user') {
      if (userStatus !== 200) return json(userStatus, { message: 'x' });
      const m = /^Bearer gho_token_(.+)$/.exec(req.headers.authorization ?? '');
      return m ? json(200, { login: m[1] }) : json(401, {});
    }
    if (req.method === 'DELETE' && req.url.startsWith('/applications/')) {
      revoked.push(JSON.parse(body).access_token);
      return json(204, {});
    }
    json(404, {});
  });
  gh.listen(0, '127.0.0.1');
  await once(gh, 'listening');
  ghUrl = `http://127.0.0.1:${gh.address().port}`;
});
after(() => gh.close());
beforeEach(() => { codes.clear(); revoked.length = 0; userStatus = 200; tokenMode = 'ok'; });

// ---- приложение под тестом ----
const logs = [];
async function start(overrides = {}, { now } = {}) {
  const config = loadConfig({
    GITHUB_CLIENT_ID: 'Iv1.testclient',
    GITHUB_CLIENT_SECRET: SECRET,
    COOKIE_SECRET,
    ALLOWED_USERS: ' Alice , bob ',
    GITHUB_OAUTH_URL: ghUrl,
    GITHUB_API_URL: ghUrl,
    ...overrides,
  });
  logs.length = 0;
  const server = createApp(config, { log: (e) => logs.push(JSON.stringify(e)), now });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`, server };
}
const get = (base, path, headers = {}) => fetch(base + path, { redirect: 'manual', headers });

/** Проходит /oauth/auth, возвращает {state, cookie}. */
async function begin(base) {
  const r = await get(base, '/oauth/auth?provider=github&site_id=kendo-baikal.ru&scope=repo');
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { loc, state: loc.searchParams.get('state'), cookie, setCookie: r.headers.get('set-cookie') };
}

test('/oauth/auth: редирект на GitHub с state, cookie HttpOnly+Secure+Lax, область задаёт сервер', async () => {
  const { base, server } = await start();
  const { loc, setCookie, state } = await begin(base);
  assert.equal(loc.origin, ghUrl);
  assert.equal(loc.pathname, '/login/oauth/authorize');
  assert.equal(loc.searchParams.get('client_id'), 'Iv1.testclient');
  assert.equal(loc.searchParams.get('redirect_uri'), `${PUBLIC}/oauth/callback`);
  assert.equal(loc.searchParams.get('scope'), 'public_repo'); // scope=repo из запроса игнорируется
  assert.ok(state.split('.').length === 3);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  server.close();
});

test('успешный вход: страница с postMessage только на PUBLIC_ORIGIN, протокол Decap/Sveltia', async () => {
  const { base, server } = await start();
  codes.set('code-1', 'Alice'); // регистр логина отличается от списка
  const { state, cookie } = await begin(base);
  const r = await get(base, `/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`, { cookie });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /authorization:github:success:/);
  assert.ok(html.includes('gho_token_Alice'));
  assert.ok(html.includes(`"${PUBLIC}"`));
  assert.ok(!html.includes('postMessage(m,"*")') && !/postMessage\([^)]*\*/.test(html));
  assert.match(html, /authorizing:github/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-/);
  assert.ok(!/unsafe-inline/.test(csp));
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  server.close();
});

test('чужой логин: страница отказа на русском, токен не отдаётся и отзывается', async () => {
  const { base, server } = await start();
  codes.set('code-2', 'mallory');
  const { state, cookie } = await begin(base);
  const r = await get(base, `/oauth/callback?code=code-2&state=${encodeURIComponent(state)}`, { cookie });
  assert.equal(r.status, 403);
  const html = await r.text();
  assert.match(html, /Доступ запрещён/);
  assert.ok(!html.includes('gho_token'));
  assert.ok(!html.includes('authorization:github'));
  assert.deepEqual(revoked, ['gho_token_mallory']);
  server.close();
});

test('пустой ALLOWED_USERS запрещает всех', async () => {
  const { base, server } = await start({ ALLOWED_USERS: '' });
  codes.set('c', 'alice');
  const { state, cookie } = await begin(base);
  const r = await get(base, `/oauth/callback?code=c&state=${encodeURIComponent(state)}`, { cookie });
  assert.equal(r.status, 403);
  assert.ok(!(await r.text()).includes('gho_token'));
  server.close();
});

test('логин в HTML-странице отказа экранируется', async () => {
  const { base, server } = await start();
  codes.set('c', '<img src=x>');
  const { state, cookie } = await begin(base);
  const r = await get(base, `/oauth/callback?code=c&state=${encodeURIComponent(state)}`, { cookie });
  const html = await r.text();
  assert.ok(!html.includes('<img src=x>'));
  server.close();
});

test('неверный state: подделка, чужая cookie, без cookie — отказ без обращения к GitHub', async () => {
  const { base, server } = await start();
  codes.set('code-3', 'alice');
  const a = await begin(base);
  const b = await begin(base);
  const forged = a.state.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  for (const [state, cookie] of [[forged, a.cookie], [a.state, b.cookie], [a.state, ''], ['garbage', a.cookie], ['', a.cookie]]) {
    const r = await get(base, `/oauth/callback?code=code-3&state=${encodeURIComponent(state)}`, { cookie });
    assert.equal(r.status, 400);
    assert.ok(!(await r.text()).includes('gho_token'));
  }
  assert.ok(codes.has('code-3'), 'код не должен был уходить в GitHub');
  server.close();
});

test('просроченный state (> 10 минут) отклоняется', async () => {
  let t = 1_000_000;
  const { base, server } = await start({}, { now: () => t });
  codes.set('code-4', 'alice');
  const { state, cookie } = await begin(base);
  t += 10 * 60 * 1000 + 1;
  const r = await get(base, `/oauth/callback?code=code-4&state=${encodeURIComponent(state)}`, { cookie });
  assert.equal(r.status, 400);
  server.close();
});

test('повторное использование state и кода: второй раз вход невозможен', async () => {
  const { base, server } = await start();
  codes.set('code-5', 'alice');
  const { state, cookie } = await begin(base);
  const url = `/oauth/callback?code=code-5&state=${encodeURIComponent(state)}`;
  assert.equal((await get(base, url, { cookie })).status, 200);
  const again = await get(base, url, { cookie });
  assert.equal(again.status, 400); // state одноразовый
  // и сам код у GitHub одноразовый: свежий state, старый код
  const s2 = await begin(base);
  const r = await get(base, `/oauth/callback?code=code-5&state=${encodeURIComponent(s2.state)}`, { cookie: s2.cookie });
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes('gho_token'));
  server.close();
});

test('ошибка GitHub (500 / отказ пользователя / сбой /user): понятная страница без деталей', async () => {
  const { base, server } = await start();
  tokenMode = 'fail';
  let s = await begin(base);
  let r = await get(base, `/oauth/callback?code=x&state=${encodeURIComponent(s.state)}`, { cookie: s.cookie });
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes('boom'));

  tokenMode = 'ok';
  s = await begin(base);
  r = await get(base, `/oauth/callback?error=access_denied&state=${encodeURIComponent(s.state)}`, { cookie: s.cookie });
  assert.equal(r.status, 400);

  codes.set('ok', 'alice');
  userStatus = 500;
  s = await begin(base);
  r = await get(base, `/oauth/callback?code=ok&state=${encodeURIComponent(s.state)}`, { cookie: s.cookie });
  assert.equal(r.status, 502);
  assert.deepEqual(revoked, ['gho_token_alice']);
  server.close();
});

test('в логах нет токенов, кодов, state и секретов', async () => {
  const { base, server } = await start();
  codes.set('SECRET-CODE-123', 'alice');
  codes.set('SECRET-CODE-456', 'mallory');
  for (const code of ['SECRET-CODE-123', 'SECRET-CODE-456', 'nope']) {
    const s = await begin(base);
    await get(base, `/oauth/callback?code=${code}&state=${encodeURIComponent(s.state)}`, { cookie: s.cookie });
    await get(base, `/oauth/callback?code=${code}&state=BAD`, { cookie: s.cookie });
  }
  const all = logs.join('\n');
  assert.ok(logs.length > 0);
  for (const bad of ['gho_token', 'SECRET-CODE', SECRET, COOKIE_SECRET, 'state=', 'code=']) {
    assert.ok(!all.includes(bad), `в логах найдено «${bad}»`);
  }
  server.close();
});

test('rate limit по IP; X-Forwarded-For учитывается только с частного адреса (последний элемент)', async () => {
  const { base, server } = await start();
  // соединение с 127.0.0.1 — «частное», значит Traefik; берём правый элемент XFF
  let last;
  for (let i = 0; i < 31; i++) last = await get(base, '/oauth/auth', { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' });
  assert.equal(last.status, 429);
  // другой клиент (другой правый элемент) не задет, подмена левого элемента не помогает обойти лимит
  const other = await get(base, '/oauth/auth', { 'x-forwarded-for': '1.1.1.1, 8.8.8.8' });
  assert.equal(other.status, 302);
  const spoof = await get(base, '/oauth/auth', { 'x-forwarded-for': '5.5.5.5, 9.9.9.9' });
  assert.equal(spoof.status, 429);
  // healthz лимитом не ограничивается
  assert.equal((await get(base, '/oauth/healthz')).status, 200);
  server.close();
});

test('healthz, 404, 405', async () => {
  const { base, server } = await start();
  const h = await get(base, '/oauth/healthz');
  assert.equal(h.status, 200);
  assert.equal(await h.text(), 'ok\n');
  assert.equal((await get(base, '/oauth/other')).status, 404);
  assert.equal((await fetch(`${base}/oauth/auth`, { method: 'POST' })).status, 405);
  server.close();
});

test('конфигурация: короткий COOKIE_SECRET и небезопасные URL отклоняются', () => {
  const ok = { GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b', COOKIE_SECRET: 'x'.repeat(32) };
  assert.doesNotThrow(() => loadConfig(ok));
  assert.throws(() => loadConfig({ ...ok, COOKIE_SECRET: 'short' }), /32/);
  assert.throws(() => loadConfig({ ...ok, GITHUB_CLIENT_SECRET: '' }), /GITHUB_CLIENT_SECRET/);
  assert.throws(() => loadConfig({ ...ok, GITHUB_OAUTH_URL: 'http://evil.example' }), /https/);
  assert.equal(loadConfig(ok).scope, 'public_repo');
});

test('процесс: стартует из env, отдаёт healthz, ничего секретного не пишет в stdout', async () => {
  const port = await new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(port), GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: SECRET, COOKIE_SECRET, ALLOWED_USERS: 'alice' },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  try {
    let ok = false;
    for (let i = 0; i < 50 && !ok; i++) {
      try { ok = (await fetch(`http://127.0.0.1:${port}/oauth/healthz`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(ok, 'сервер не поднялся');
    assert.ok(!out.includes(SECRET) && !out.includes(COOKIE_SECRET));
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  const bad = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { PATH: process.env.PATH } });
  const [code] = await once(bad, 'exit');
  assert.equal(code, 1);
});

test('скрипт страницы входа по протоколу Sveltia: рукопожатие, ответ только своему origin', async () => {
  const vm = await import('node:vm');
  const { base, server } = await start();
  codes.set('c', 'alice');
  const { state, cookie } = await begin(base);
  const r = await get(base, `/oauth/callback?code=c&state=${encodeURIComponent(state)}`, { cookie });
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(await r.text())[1];

  const sent = [];
  let listener;
  const opener = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const window = { opener, addEventListener: (_t, fn) => (listener = fn) };
  vm.runInNewContext(script, { window });

  // 1) попап сообщил открывателю о себе, адресуя только kendo-baikal.ru
  assert.deepEqual(sent, [{ data: 'authorizing:github', origin: PUBLIC }]);
  // 2) чужое сообщение / чужой origin игнорируется
  listener({ origin: 'https://evil.example', source: opener, data: 'authorizing:github' });
  listener({ origin: PUBLIC, source: {}, data: 'authorizing:github' });
  assert.equal(sent.length, 1);
  // 3) ответ CMS → токен уходит в формате Decap, строго на PUBLIC_ORIGIN
  listener({ origin: PUBLIC, source: opener, data: 'authorizing:github' });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].origin, PUBLIC);
  const m = /^authorization:github:success:(.+)$/.exec(sent[1].data);
  assert.deepEqual(JSON.parse(m[1]), { token: 'gho_token_alice', provider: 'github' });
  server.close();
});
