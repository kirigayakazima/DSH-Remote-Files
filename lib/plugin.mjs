import {phoneConfig} from './config.mjs';
import {startFileServer} from './server.mjs';
import {createHeartBridge} from './heart.mjs';
import {publicCode, fault} from './errors.mjs';

export const name = 'dsh-remote-files';
// Cordis 4 object inject is an intercept map, not {optional: [...]}. Heart is
// deliberately discovered through the public ctx.get() so it can come and go.
export const inject = [];
// Cordis publicly accepts Standard Schema v1. Keep this always available,
// including a fully offline standalone installation with no host packages.
export const Config = Object.freeze({'~standard': Object.freeze({version: 1, vendor: 'dsh-remote-files', validate(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {issues: [{message: 'Config must be an object'}]};
  if (Object.keys(input).some(key => !['enabled', 'configFile'].includes(key))) return {issues: [{message: 'Unknown config field'}]};
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return {issues: [{message: 'enabled must be boolean', path: ['enabled']}]};
  if (input.configFile !== undefined && typeof input.configFile !== 'string') return {issues: [{message: 'configFile must be a string', path: ['configFile']}]};
  return {value: {enabled: input.enabled ?? false, configFile: input.configFile ?? ''}};
}})});

export function apply(ctx, config = {}) {
  if (!config.enabled) return;
  if (!config.configFile) throw fault('CONFIG_REQUIRED');
  const settings = phoneConfig(config.configFile); // Fail visibly before starting any listener.
  ctx.effect(async () => {
    const heart = createHeartBridge(ctx);
    const state = {state: 'starting', errorCode: null};
    const service = Object.freeze({getStatus: () => Object.freeze({...state, heart: heart.status()}), evaluateBackground: intent => heart.evaluateBackground(intent)});
    const remove = ctx.provide('remoteFiles', service);
    try {
      const running = await startFileServer(settings, {onAccess: () => heart.access(), getHeartStatus: () => heart.status()});
      state.state = 'online';
      return async () => {
        state.state = 'stopped'; heart.dispose();
        if (typeof remove === 'function') await remove();
        await running.close();
      };
    } catch (error) {
      heart.dispose();
      if (typeof remove === 'function') await remove();
      throw fault(publicCode(error));
    }
  });
}
