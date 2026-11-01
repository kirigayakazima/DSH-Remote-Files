import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import * as plugin from '../lib/plugin.mjs';
import {createHeartBridge} from '../lib/heart.mjs';
import {phoneConfig} from '../lib/config.mjs';
import {fixture, token} from './helpers.mjs';

test('Heart bridge rate limits metadata, uses activity suitability and tolerates absence', t => {
  const observed = [], snapshot = {mood: {state: 'calm'}}; let time = 0, disposed = false, intent;
  const service = {getSnapshot: () => snapshot, observe: value => observed.push(value), evaluateActivity: value => { intent = value; return {suitable: false, reason: 'quiet-hours'}; }};
  const ctx = {get: () => service, on: () => () => { disposed = true; }};
  const bridge = createHeartBridge(ctx, {now: () => time});
  assert.deepEqual(bridge.status(), {available: true, mood: 'calm'});
  bridge.access(); bridge.access(); assert.equal(observed.length, 1);
  assert.equal(observed[0].type, 'custom'); assert.equal(observed[0].source, 'remote-files');
  assert.equal(observed[0].confidence, 1);
  assert.deepEqual(observed[0].evidence, {event: 'maintenance-access', requests: 1});
  assert.equal(bridge.evaluateBackground({intent: 'maintenance-heavy'}).suitable, false);
  assert.equal(intent.intent, 'maintenance-heavy');
  time += 60001; bridge.access(); assert.equal(observed.length, 2); assert.equal(observed[1].evidence.requests, 2);
  bridge.dispose(); bridge.access(); assert.equal(observed.length, 2); assert.equal(disposed, true);
  const absent = createHeartBridge({get: () => { throw Error('no injection'); }});
  assert.equal(absent.status().available, false); assert.equal(absent.evaluateBackground({intent: 'index'}).suitable, false); absent.dispose();
});

test('real Heart v1 observations and suitability do not change mood', {skip: !process.env.DSH_HEART_ROOT}, async t => {
  const heartRoot = path.resolve(process.env.DSH_HEART_ROOT);
  const {HeartService} = await import(pathToFileURL(path.join(heartRoot, 'lib/service.js')).href);
  const {validateObservation} = await import(pathToFileURL(path.join(heartRoot, 'contracts/index.js')).href);
  const f = fixture(t), heart = new HeartService(null, path.join(f.root, 'heart'), {quietFrom: '00:00', quietTo: '23:59'});
  const observed = []; let time = 0;
  const ctx = {get: () => ({getSnapshot: () => heart.getSnapshot(), evaluateActivity: value => heart.evaluateActivity(value), observe: value => { observed.push(value); return heart.observe(value); }}), on: () => () => {}};
  const bridge = createHeartBridge(ctx, {now: () => time});
  bridge.access(); bridge.access(); assert.equal(observed.length, 1);
  assert.equal(validateObservation(observed[0]).valid, true); assert.equal(observed[0].type, 'custom');
  assert.deepEqual(Object.keys(observed[0].evidence).sort(), ['event', 'requests']);
  assert.equal(bridge.evaluateBackground({intent: 'maintenance-heavy'}).suitable, false);
  time += 60001; bridge.access(); assert.equal(observed.length, 2);
  assert.equal(heart.getSnapshot().mood.state, 'calm');
  bridge.dispose(); bridge.access(); assert.equal(observed.length, 2);
  const absent = createHeartBridge({get: () => { throw Error('no injection'); }});
  assert.equal(absent.status().available, false); assert.equal(absent.evaluateBackground({intent: 'index'}).suitable, false); absent.dispose();
});

test('real Cordis lifecycle: no Heart requirement, disabled default, unload and reload', async t => {
  const f = fixture(t), key = token();
  const tokenFile = path.join(f.root, 'access.token'); fs.writeFileSync(tokenFile, key);
  const configFile = path.join(f.root, 'phone.local.json'); fs.writeFileSync(configFile, JSON.stringify({tokenFile, roots: f.roots, port: 0}));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  const disabled = await ctx.plugin(plugin, {}); assert.equal(ctx.get('remoteFiles'), undefined); await disabled.dispose();
  const active = await ctx.plugin(plugin, {enabled: true, configFile});
  for (let n = 0; ctx.get('remoteFiles')?.getStatus().state === 'starting' && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(ctx.get('remoteFiles').getStatus().state, 'online');
  assert.throws(() => active.update({enabled: 'yes'}), /enabled must be boolean/);
  // update() stores the attempted raw config even when validation rejects it.
  await active.update({enabled: true, configFile});
  assert.equal(ctx.get('remoteFiles').getStatus().heart.available, false);
  const provider = await ctx.plugin(c => { c.provide('heart', {getSnapshot: () => ({mood: {state: 'calm'}})}); });
  assert.equal(ctx.get('remoteFiles').getStatus().heart.available, true);
  await provider.dispose(); assert.equal(ctx.get('remoteFiles').getStatus().heart.available, false);
  await active.restart();
  for (let n = 0; ctx.get('remoteFiles')?.getStatus().state === 'starting' && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(ctx.get('remoteFiles').getStatus().state, 'online');
  await active.dispose(); assert.equal(ctx.get('remoteFiles'), undefined);
});

test('phone config rejects credentials or config living beneath a published source root', t => {
  const f = fixture(t); const configFile = path.join(f.root, 'phone.local.json');
  const tokenFile = path.join(f.source, 'access.token'); fs.writeFileSync(tokenFile, token());
  fs.writeFileSync(configFile, JSON.stringify({tokenFile, roots: f.roots}));
  assert.throws(() => phoneConfig(configFile), /CONFIG_SOURCE_OVERLAP/);
});
