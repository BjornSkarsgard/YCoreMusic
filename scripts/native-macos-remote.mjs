import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchRelay } from './native-remote-smoke.mjs';

assert.equal(process.platform, 'darwin');
const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), 'ycore-mac-remote-'));
let relay;
let app;
let launchError;

function startApp(extra = {}) {
  launchError = undefined;
  app = spawn(process.env.YCORE_NATIVE_APP ?? resolve('apps/desktop/src-tauri/target/debug/YCoreMusic'), {
    env: {
      ...process.env,
      YCORE_TEST_DATA_DIR: directory,
      YCORE_REMOTE_TEST_ORIGIN: relay.origin,
      YCORE_MACOS_NATIVE_PROBE: '1',
      YCORE_MACOS_PROBE_INSTANCE: randomUUID().replaceAll('-', ''),
      YCORE_MACOS_MEDIA_SPIKE: '0',
      ...extra,
    },
    stdio: 'ignore',
  });
  app.once('error', error => { launchError = error; });
}

async function stopApp() {
  if (!app?.pid || app.exitCode !== null || app.signalCode !== null) return;
  const exited = new Promise(done => app.once('exit', done));
  app.kill();
  await Promise.race([exited, sleep(1500)]);
  if (app.exitCode === null && app.signalCode === null) {
    app.kill('SIGKILL');
    await Promise.race([exited, sleep(1500)]);
  }
}

async function reportFrom(name) {
  try {
    return JSON.parse(await readFile(join(directory, name), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function waitFor(callback, timeout = 45000) {
  const deadline = Date.now() + timeout;
  do {
    if (launchError) throw new Error('Could not launch Mac application', {cause: launchError});
    assert.ok(app.exitCode === null && app.signalCode === null, 'Mac application exited during probe');
    const result = await callback();
    if (result) return result;
    await sleep(250);
  } while (Date.now() < deadline);
  throw new Error('Mac remote did not reach the expected state');
}

function send(url, {body, cookie} = {}) {
  return new Promise((done, fail) => {
    const req = request(url, {
      ca: relay.ca,
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? {'Content-Type': 'application/json', Origin: relay.origin} : {}),
        ...(cookie ? {Cookie: cookie} : {}),
      },
      timeout: 5000,
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => done({status: response.statusCode, headers: response.headers, text}));
    });
    req.on('error', fail);
    req.on('timeout', () => req.destroy(new Error('HTTPS probe timed out')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

try {
  relay = await launchRelay(root, directory);
  startApp();
  const report = await waitFor(() => reportFrom('pair.json'));
  assert.ok(report.url, 'Mac settings did not produce a QR link');
  if (report.displays) {
    console.log('Mac displays discovered: ' + report.displays.total + ', stable UUID: ' + report.displays.stable);
  }
  const base = new URL(report.url);
  assert.equal(base.origin, relay.origin);
  const code = new URLSearchParams(base.hash.slice(1)).get('pair');
  assert.equal(typeof code, 'string');
  base.hash = '';
  const api = name => new URL('api/' + name, base);
  assert.equal((await send(api('state'))).status, 401);
  const pairing = await send(api('pair'), {body: {code}});
  assert.equal(pairing.status, 204, 'QR link did not pair a phone session');
  const setCookie = pairing.headers['set-cookie']?.[0] ?? '';
  assert.ok(/;\s*HttpOnly/i.test(setCookie) && /;\s*Secure/i.test(setCookie), 'Insecure pairing cookie');
  const cookie = setCookie.split(';')[0];
  const state = async () => {
    const response = await send(api('state'), {cookie});
    assert.equal(response.status, 200);
    return JSON.parse(response.text);
  };
  const initial = await waitFor(async () => {
    const value = await state();
    return value?.music ? value : null;
  });
  assert.equal(initial.playing, false, 'Playback must wait for user action');
  const level = initial.volume === 27 ? 34 : 27;
  const command = await send(api('command'), {cookie, body: {id: randomUUID(), action: {type:'volume', level}}});
  assert.equal(command.status, 204);
  await waitFor(async () => (await state()).volume === level);
  await sleep(400);
  assert.equal((await send(api('pair'), {body: {code}})).status, 403);
  console.log('PASS: macOS WKWebView QR pairing, HTTPS command, controller volume round trip, no autoplay, replay rejected.');
  if (process.env.YCORE_MACOS_TEST_CLIP === '1') {
    const clip = async () => (await reportFrom('clip.json')) ?? {};
    let outcome;
    let prepared;
    try {
      const ready = await waitFor(async () => {
        const value = await clip();
        return value.error || (value.ready && value.players === 1) ? value : null;
      });
      prepared = ready;
      if (ready.error) outcome = 'YouTube error ' + ready.error;
      else {
        const control = async action => {
          const response = await send(api('command'), {cookie, body:{id:randomUUID(), action}});
          assert.equal(response.status, 204);
        };
        await control({type:'volume', level:0});
        await waitFor(async () => (await state()).volume === 0);
        await control({type:'play'});
        const playback = await waitFor(async () => {
          const value = await clip();
          return value.error || (value.playing && value.position > 1 && value.players === 1) ? value : null;
        }, 30000);
        outcome = playback.error ? 'YouTube error ' + playback.error : 'PASS';
        if (outcome === 'PASS') {
          if (process.env.YCORE_MACOS_TEST_FIXTURE === '1') {
            await control({type:'seek',seconds:31});
            await waitFor(async () => (await clip()).position >= 31);
          }
          await control({type:'pause'});
          await waitFor(async () => !(await state()).playing);
          console.log(process.env.YCORE_MACOS_TEST_FIXTURE === '1'
            ? 'PASS: phone plays, seeks and pauses the single simulated YouTube iframe in native WKWebView.'
            : 'PASS: phone plays and pauses the single real YouTube iframe in WKWebView.');
        }
      }
    } catch (error) {
      outcome = error.message;
    }
    if (outcome !== 'PASS') {
      console.log('Live YouTube playback was not confirmed: ' + outcome);
      console.log('Mac clip state: ' + JSON.stringify(await clip()));
    }
    if (process.env.YCORE_MACOS_TEST_FIXTURE === '1') assert.equal(outcome, 'PASS');
    if (process.env.YCORE_MACOS_EXPECT_LOOPBACK === '1') {
      assert.equal(prepared?.loopback, true, 'Packaged macOS must use the isolated loopback page');
      assert.notEqual(outcome, 'YouTube error 153', 'WebKit lost the YouTube referrer');
      const finalState = await clip();
      assert.notEqual(finalState.error, '153', 'WebKit lost the YouTube referrer after Play');
      assert.ok(outcome === 'PASS' || prepared.ready || /^YouTube error (100|101|150)$/.test(outcome),
        'Mac controller did not reach the cued state or a YouTube availability error');
      console.log('PASS: packaged Mac player uses the local page and no longer returns error 153.');
    }
    if (outcome === 'YouTube error 153') {
      const fixture = createServer(async (req, res) => {
        if (req.url !== '/') { res.writeHead(404).end(); return; }
        try {
          const html = await readFile(join(directory, 'identity.html'));
          res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Referrer-Policy':'strict-origin-when-cross-origin'}).end(html);
        } catch {
          res.writeHead(404).end();
        }
      });
      await new Promise((resolve, reject) => {
        fixture.once('error', reject);
        fixture.listen(0,'127.0.0.1',resolve);
      });
      try {
        await stopApp();
        startApp({YCORE_MACOS_IDENTITY_PROBE:'loopback', YCORE_MACOS_IDENTITY_LOOPBACK:'http://127.0.0.1:' + fixture.address().port});
        const identity = await waitFor(() => reportFrom('identity.json'), 45000);
        console.log('Native WKWebView loopback probe: ' + JSON.stringify(identity));
      } finally {
        fixture.close();
      }
    }
  }
} finally {
  await stopApp();
  relay?.stop();
  await rm(directory, {recursive: true, force: true});
}
