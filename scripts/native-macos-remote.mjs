import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchRelay } from './native-remote-smoke.mjs';

assert.equal(process.platform, 'darwin');
const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), 'ycore-mac-remote-'));
let relay;
let app;

async function waitFor(callback, timeout = 45000) {
  const deadline = Date.now() + timeout;
  do {
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
  app = spawn(process.env.YCORE_NATIVE_APP ?? resolve('apps/desktop/src-tauri/target/debug/YCoreMusic'), {
    env: {
      ...process.env,
      YCORE_TEST_DATA_DIR: directory,
      YCORE_REMOTE_TEST_ORIGIN: relay.origin,
      YCORE_MACOS_NATIVE_PROBE: '1',
      YCORE_MACOS_MEDIA_SPIKE: '0',
    },
    stdio: 'ignore',
  });
  let launchError;
  app.once('error', error => { launchError = error; });
  const report = await waitFor(async () => {
    if (launchError) throw new Error('Could not launch Mac application', {cause: launchError});
    try {
      return JSON.parse(await readFile(join(directory, 'pair.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  });
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
    const clip = async () => {
      try {
        return JSON.parse(await readFile(join(directory, 'clip.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return {};
      }
    };
    let outcome;
    try {
      const ready = await waitFor(async () => {
        const value = await clip();
        return value.error || (value.ready && value.players === 1) ? value : null;
      });
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
          await control({type:'pause'});
          await waitFor(async () => !(await state()).playing);
          console.log('PASS: phone plays and pauses the single real YouTube iframe in WKWebView.');
        }
      }
    } catch (error) {
      outcome = error.message;
    }
    if (outcome !== 'PASS') console.log('Live YouTube playback was not confirmed: ' + outcome);
  }
} finally {
  if (app?.pid && app.exitCode === null) {
    app.kill();
    await Promise.race([new Promise(done => app.once('exit', done)), sleep(1500)]);
  }
  relay?.stop();
  await rm(directory, {recursive: true, force: true});
}
