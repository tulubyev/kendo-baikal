// Минимальный OAuth-прокси «Войти через GitHub» для Sveltia CMS (протокол Decap/Netlify CMS).
// Ноль npm-зависимостей: только node:http, node:crypto и встроенный fetch. Подробности — README.md.
import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const STATE_TTL_MS = 10 * 60 * 1000;
const COOKIE_NAME = 'kb_oauth_state';
const PROVIDER = 'github';
const RATE_LIMIT = { windowMs: 60_000, max: 30, maxKeys: 5000 };
const GITHUB_TIMEOUT_MS = 8000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Читает и проверяет конфигурацию из env. Кидает Error с понятным текстом (без значений секретов). */
export function loadConfig(env = process.env) {
  const need = (name) => {
    const v = (env[name] ?? '').trim();
    if (!v) throw new Error(`не задана переменная ${name}`);
    return v;
  };
  const cookieSecret = need('COOKIE_SECRET');
  if (Buffer.byteLength(cookieSecret) < 32) throw new Error('COOKIE_SECRET короче 32 байт (openssl rand -hex 32)');

  const publicOrigin = new URL(env.PUBLIC_ORIGIN?.trim() || 'https://kendo-baikal.ru').origin;
  const checkUrl = (name, def) => {
    const u = new URL(env[name]?.trim() || def);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
      throw new Error(`${name}: допускается только https (http — только для localhost, в тестах)`);
    }
    return u.origin;
  };
  const scope = env.OAUTH_SCOPE?.trim() || 'public_repo';
  if (!/^[a-z:_,]+$/.test(scope)) throw new Error('OAUTH_SCOPE содержит недопустимые символы');

  return {
    clientId: need('GITHUB_CLIENT_ID'),
    clientSecret: need('GITHUB_CLIENT_SECRET'),
    cookieSecret,
    allowedUsers: new Set(
      (env.ALLOWED_USERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    ),
    publicOrigin,
    scope,
    // Подмена GitHub нужна только тестам (мок-сервер на localhost).
    githubOrigin: checkUrl('GITHUB_OAUTH_URL', 'https://github.com'),
    githubApi: checkUrl('GITHUB_API_URL', 'https://api.github.com'),
    port: Number(env.PORT || 8080),
  };
}

/** IP клиента. X-Forwarded-For верим только если соединение пришло из частной сети (Traefik в Docker). */
function isPrivateAddr(addr = '') {
  const a = addr.replace(/^::ffff:/, '');
  if (isIP(a) === 4) {
    const [p, q] = a.split('.').map(Number);
    return p === 10 || p === 127 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168);
  }
  return a === '::1' || /^f[cd]/i.test(a);
}
function clientIp(req) {
  const remote = req.socket.remoteAddress ?? '';
  const xff = req.headers['x-forwarded-for'];
  if (xff && isPrivateAddr(remote)) {
    // Traefik дописывает адрес клиента последним — берём самый правый, подделать его снаружи нельзя.
    const last = String(xff).split(',').pop().trim();
    if (isIP(last)) return last;
  }
  return remote;
}

export function createApp(config, { log = defaultLog, now = () => Date.now() } = {}) {
  const usedNonces = new Map(); // nonce -> срок годности (одноразовость state)
  const hits = new Map(); // ip -> {count, reset}

  const sign = (data) => createHmac('sha256', config.cookieSecret).update(data).digest();
  const safeEq = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
  };

  function sweep() {
    const t = now();
    for (const [k, exp] of usedNonces) if (exp < t) usedNonces.delete(k);
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }

  function rateLimited(ip) {
    const t = now();
    let rec = hits.get(ip);
    if (!rec || rec.reset < t) {
      if (hits.size >= RATE_LIMIT.maxKeys) sweep();
      if (hits.size >= RATE_LIMIT.maxKeys) return true; // под атакой — отказываем новым, память не растёт
      rec = { count: 0, reset: t + RATE_LIMIT.windowMs };
      hits.set(ip, rec);
    }
    return ++rec.count > RATE_LIMIT.max;
  }

  const baseHeaders = () => ({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });

  function send(res, status, body, extra = {}) {
    res.writeHead(status, { ...baseHeaders(), 'Content-Type': 'text/plain; charset=utf-8', ...extra });
    res.end(body);
  }

  function page(res, status, title, bodyHtml, script, extraHeaders = {}) {
    const nonce = randomBytes(16).toString('base64');
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
    const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style nonce="${nonce}">body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#222}h1{font-size:1.25rem}</style></head>
<body>${bodyHtml}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
    res.writeHead(status, {
      ...baseHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      ...extraHeaders,
    });
    res.end(html);
  }

  const clearCookie = `${COOKIE_NAME}=; Max-Age=0; Path=/oauth; HttpOnly; Secure; SameSite=Lax`;
  const errorPage = (res, status, heading, text, extra = {}) =>
    page(res, status, heading, `<h1>${heading}</h1><p>${text}</p><p>Это окно можно закрыть.</p>`, '', {
      'Set-Cookie': clearCookie,
      ...extra,
    });

  async function ghFetch(url, init) {
    return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
  }

  function handleAuth(req, res) {
    const nonce = b64url(randomBytes(16));
    const ts = now();
    const payload = `${nonce}.${ts}`;
    const state = `${payload}.${b64url(sign(`state|${payload}`))}`;
    const url = new URL('/login/oauth/authorize', config.githubOrigin);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${config.publicOrigin}/oauth/callback`,
      scope: config.scope, // область задаёт сервер, а не параметр запроса
      state,
      allow_signup: 'false',
    }).toString();
    res.writeHead(302, {
      ...baseHeaders(),
      Location: url.toString(),
      'Set-Cookie': `${COOKIE_NAME}=${nonce}; Max-Age=${STATE_TTL_MS / 1000}; Path=/oauth; HttpOnly; Secure; SameSite=Lax`,
    });
    res.end();
  }

  /** Возвращает nonce, если state валиден, свеж, привязан к cookie и ещё не использовался. */
  function consumeState(state, cookieNonce) {
    const parts = String(state ?? '').split('.');
    if (parts.length !== 3) return null;
    const [nonce, tsStr, mac] = parts;
    const ts = Number(tsStr);
    if (!nonce || !Number.isFinite(ts)) return null;
    if (!safeEq(mac, b64url(sign(`state|${nonce}.${tsStr}`)))) return null;
    const age = now() - ts;
    if (age < 0 || age > STATE_TTL_MS) return null;
    if (!cookieNonce || !safeEq(cookieNonce, nonce)) return null;
    if (usedNonces.has(nonce)) return null;
    usedNonces.set(nonce, ts + STATE_TTL_MS);
    return nonce;
  }

  function readCookie(req) {
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim();
    }
    return '';
  }

  async function exchangeCode(code) {
    const r = await ghFetch(`${config.githubOrigin}/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'kendo-baikal-oauth' },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: `${config.publicOrigin}/oauth/callback` }),
    });
    if (!r.ok) throw new Error(`token HTTP ${r.status}`);
    const j = await r.json();
    if (typeof j.access_token !== 'string' || !j.access_token) throw new Error('token: нет access_token');
    return j.access_token;
  }

  async function fetchLogin(token) {
    const r = await ghFetch(`${config.githubApi}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'kendo-baikal-oauth' },
    });
    if (!r.ok) throw new Error(`user HTTP ${r.status}`);
    const j = await r.json();
    if (typeof j.login !== 'string' || !j.login) throw new Error('user: нет login');
    return j.login;
  }

  /** Чужой токен нам не нужен — отзываем, ошибки не важны. */
  async function revoke(token) {
    try {
      await ghFetch(`${config.githubApi}/applications/${encodeURIComponent(config.clientId)}/token`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'kendo-baikal-oauth',
        },
        body: JSON.stringify({ access_token: token }),
      });
    } catch {
      /* не критично */
    }
  }

  async function handleCallback(req, res, params) {
    const ghError = params.get('error');
    const code = params.get('code');
    const state = params.get('state');
    // Одноразовость и привязка к cookie проверяются ДО любых обращений к GitHub.
    const nonce = consumeState(state, readCookie(req));
    if (!nonce) {
      log({ event: 'bad_state' });
      return errorPage(res, 400, 'Ссылка для входа устарела', 'Закройте окно и нажмите «Войти через GitHub» в админке ещё раз.');
    }
    if (ghError || !code) {
      log({ event: 'github_denied' });
      return errorPage(res, 400, 'Вход отменён', 'GitHub не подтвердил вход. Закройте окно и попробуйте ещё раз.');
    }
    let token;
    let login;
    try {
      token = await exchangeCode(code);
      login = await fetchLogin(token);
    } catch (e) {
      log({ event: 'github_error', error: String(e?.name ?? 'Error'), detail: /^(token|user)/.test(e?.message ?? '') ? e.message : undefined });
      if (token) await revoke(token);
      return errorPage(res, 502, 'GitHub сейчас недоступен', 'Не удалось завершить вход. Подождите минуту и попробуйте ещё раз.');
    }
    if (!config.allowedUsers.has(login.toLowerCase())) {
      log({ event: 'denied', login });
      await revoke(token);
      return errorPage(
        res,
        403,
        'Доступ запрещён',
        `Пользователя GitHub «${escapeHtml(login)}» нет в списке редакторов сайта. Сообщите владельцу сайта свой логин GitHub, чтобы вас добавили.`,
      );
    }
    log({ event: 'login', login });
    const message = `authorization:${PROVIDER}:success:${JSON.stringify({ token, provider: PROVIDER })}`;
    const script = `(function(){var o=${jsString(config.publicOrigin)},m=${jsString(message)};
window.addEventListener("message",function(e){if(e.origin!==o||e.source!==window.opener||e.data!=="authorizing:${PROVIDER}")return;window.opener.postMessage(m,o)});
if(window.opener)window.opener.postMessage("authorizing:${PROVIDER}",o)})();`;
    page(res, 200, 'Вход выполнен', '<h1>Вход выполнен</h1><p>Окно закроется само. Если этого не произошло, вернитесь в админку.</p>', script, {
      'Set-Cookie': clearCookie,
    });
  }

  async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const started = now();
    res.on('finish', () => log({ event: 'req', method: req.method, path, status: res.statusCode, ms: now() - started }));

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    if (path === '/oauth/healthz') return send(res, 200, 'ok\n');
    if (path !== '/oauth/auth' && path !== '/oauth/callback') return send(res, 404, 'Not Found');
    if (rateLimited(clientIp(req))) return send(res, 429, 'Слишком много запросов. Подождите минуту.\n', { 'Retry-After': '60' });
    try {
      if (path === '/oauth/auth') return handleAuth(req, res);
      return await handleCallback(req, res, url.searchParams);
    } catch (e) {
      log({ event: 'error', error: String(e?.name ?? 'Error') });
      if (!res.headersSent) errorPage(res, 500, 'Что-то пошло не так', 'Закройте окно и попробуйте ещё раз позже.');
    }
  }

  const server = createServer(handler);
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  const timer = setInterval(sweep, 60_000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Строка для вставки в <script>: JSON + экранирование «<», чтобы нельзя было закрыть тег.
const jsString = (s) => JSON.stringify(s).replace(/</g, '\\u003c');

function defaultLog(entry) {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    process.stderr.write(`[oauth] ОШИБКА конфигурации: ${e.message}\n`);
    process.exit(1);
  }
  if (config.allowedUsers.size === 0) process.stderr.write('[oauth] ALLOWED_USERS пуст — вход запрещён всем\n');
  const server = createApp(config);
  server.listen(config.port, () => defaultLog({ event: 'listening', port: config.port, users: config.allowedUsers.size }));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
