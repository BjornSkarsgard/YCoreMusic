import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';

const origin = new URL(process.env.YCORE_REMOTE_ORIGIN || 'https://www.ycore-music.ru').origin;
const assetDir = new URL('../desktop/src-tauri/remote/', import.meta.url);
const assets = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['remote.css', ['remote.css', 'text/css']],
  ['remote.js', ['remote.js', 'text/javascript']],
  ['worker.js', ['worker.js', 'text/javascript']],
  ['scanner.js', ['scanner.js', 'text/javascript']],
  ['jsqr-1.4.0.js', ['jsqr-1.4.0.js', 'text/javascript']],
  ['jsqr-LICENSE.txt', ['jsqr-LICENSE.txt', 'text/plain']],
  ['manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['icon-192.png', ['192x192.png', 'image/png']],
  ['icon-512.png', ['../../src/assets/ycore-mark-512.png', 'image/png']],
].map(([path,[file,type]]) => [path, {type,body:readFileSync(new URL(file, assetDir))}]));
const methods = new Map([['pair','POST'], ['session','POST'], ['state','GET'], ['search','POST'], ['music','POST'], ['history','GET'], ['command','POST'], ['lyrics','POST']]);
const sessions = new Map();
const cookieName = '__Secure-ycore-remote';
const secret = /^[a-f0-9]{64}$/;
const expectedHost = new URL(origin).host;
const sessionLimit = 256;
const jobsLimit = 8;

function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  if (body === undefined) return res.end();
  const json = JSON.stringify(body);
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Length', Buffer.byteLength(json));
  res.end(json);
}

async function readJson(req, limit) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw 415;
  if (Number(req.headers['content-length']) > limit) throw 413;
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size > limit) { req.resume(); throw 413; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); } catch { throw 400; }
}

function wake(session) {
  if (!session.poll) return;
  const job = [...session.jobs.values()].find(job => !job.sent);
  if (!job) return;
  job.sent = true;
  send(session.poll, 200, job.request);
}

function retire(id, session) {
  if (session.poll) send(session.poll, 204);
  for (const {response} of session.jobs.values()) send(response, 503);
  sessions.delete(id);
}

function sweep() {
  const now = Date.now();
  for (const [id,session] of sessions) {
    if (now - session.seen > 55_000) retire(id, session);
  }
}

async function desktop(req, res, action) {
  const credential = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
  if (req.method !== 'POST' || !credential || req.headers.origin) return send(res, 403);
  const id = createHash('sha256').update(credential).digest('hex');
  let session = sessions.get(id);
  if (!session && action !== 'reply') {
    sweep();
    const peer = req.headers['x-ycore-peer'] || req.socket.remoteAddress;
    if (sessions.size >= sessionLimit || [...sessions.values()].filter(s => s.peer === peer).length >= 8) {
      return send(res, 429);
    }
    session = {peer, seen:Date.now(), jobs:new Map(), poll:null};
    sessions.set(id,session);
  }
  if (!session) return send(res, 404);
  session.seen = Date.now();
  if (action === 'online') return send(res, 204);
  if (action === 'poll') {
    if (session.poll) send(session.poll, 204);
    session.poll = res;
    const timer = setTimeout(() => send(res, 204), 23_000);
    res.once('close', () => {
      clearTimeout(timer);
      if (session.poll === res) {
        session.poll = null;
        if (!res.writableEnded && sessions.get(id) === session) retire(id,session);
      }
    });
    wake(session);
    return;
  }
  const reply = await readJson(req, 384 * 1024);
  const job = session.jobs.get(reply?.id);
  if (!job?.sent) return send(res, 404);
  const code = reply.status;
  if (![200,204,400,401,403,404,409,413,415,422,429,500,503].includes(code)) {
    send(job.response, 502);
    return send(res, 400);
  }
  if (code >= 200 && code < 300 && (job.request.action === 'pair' || reply.token)) {
    const validToken = secret.test(reply.token || '') &&
      (job.request.action === 'pair' || reply.token === job.request.token);
    if (!validToken) {
      send(job.response, 502);
      return send(res, 400);
    }
    job.response.setHeader('Set-Cookie', `${cookieName}=${reply.token}; Path=/remote/p/${id}/; Secure; HttpOnly; SameSite=Strict; Max-Age=864000`);
  }
  send(job.response, code, code === 204 ? undefined : reply.data ?? null);
  return send(res, 204);
}

async function browser(req, res, id, action) {
  if (methods.get(action) !== req.method) return send(res, 404);
  if ((req.headers.origin && req.headers.origin !== origin) ||
      (req.method === 'POST' && req.headers.origin !== origin)) return send(res, 403);
  const token = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (action !== 'pair' && !secret.test(token || '')) return send(res, 401);
  const body = req.method === 'POST' ? await readJson(req, 4096) : undefined;
  if (action === 'pair' && !secret.test(body?.code || '')) return send(res, 400);
  const session = sessions.get(id);
  if (!session || Date.now() - session.seen > 55_000) return send(res, 503);
  if (session.jobs.size >= jobsLimit) return send(res, 429);
  const request = {id:randomUUID(),action,token,body};
  session.jobs.set(request.id, {request,response:res,sent:false});
  const timer = setTimeout(() => send(res, 504), action === 'lyrics' ? 29_000 : 22_000);
  res.once('close', () => {
    clearTimeout(timer);
    session.jobs.delete(request.id);
  });
  wake(session);
}

async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: https://i.ytimg.com; media-src 'self' blob:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; object-src 'none'");
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  if (req.headers.host !== expectedHost) return send(res, 403);
  const path = req.url;
  if (req.method === 'GET' && path === '/remote/healthz') return send(res, 200, {ok:true});
  const agent = /^\/remote\/v1\/desktop\/(online|poll|reply)$/.exec(path);
  if (agent) return desktop(req,res,agent[1]);
  const target = /^\/remote\/p\/([a-f0-9]{64})\/([a-z0-9./-]*)$/.exec(path);
  const app = /^\/remote\/app\/([a-z0-9.-]*)$/.exec(path);
  if (!target && !app) return send(res, 404);
  const [,id] = target || [];
  const route = target ? target[2] : app[1];
  if (route.startsWith('api/')) return browser(req,res,id,route.slice(4));
  const asset = assets.get(route);
  if (req.method !== 'GET' || !asset) return send(res, 404);
  res.setHeader('Content-Type',asset.type);
  res.end(asset.body);
}

const handler = (req,res) => {
  handle(req,res).catch(error => send(res, Number.isInteger(error) ? error : 500));
};
const tls = process.env.YCORE_REMOTE_TEST_CERT;
const server = tls
  ? createHttpsServer({cert:readFileSync(tls),key:readFileSync(process.env.YCORE_REMOTE_TEST_KEY)},handler)
  : createHttpServer(handler);
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.maxConnections = 1024;
setInterval(sweep, 15_000).unref();
server.listen(Number(process.env.YCORE_REMOTE_PORT || 5183),'127.0.0.1', () => console.log('YCore remote relay ready'));
