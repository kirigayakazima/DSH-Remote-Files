import {fault} from './errors.mjs';

export function createHeartBridge(ctx, {now = Date.now} = {}) {
  let disposed = false, lastReported = -Infinity, count = 0, snapshot = null;
  const get = () => { try { return typeof ctx.get === 'function' ? ctx.get('heart') : ctx.heart; } catch { return null; } };
  const refresh = () => { try { snapshot = get()?.getSnapshot?.() || null; } catch { snapshot = null; } };
  refresh();
  const off = ctx.on?.('heart/state-changed', payload => { if (!disposed) snapshot = payload?.current || null; });
  return {
    status() { refresh(); return {available: Boolean(snapshot), mood: typeof snapshot?.mood?.state === 'string' ? snapshot.mood.state : null}; },
    access() {
      if (disposed) return;
      count++;
      if (now() - lastReported < 60000) return;
      const heart = get();
      if (!heart?.observe) return;
      lastReported = now(); const requests = count; count = 0;
      try { Promise.resolve(heart.observe({type: 'custom', source: 'remote-files', confidence: 1, evidence: {event: 'maintenance-access', requests}, summary: '已配对维护客户端进行了只读访问'})).catch(() => {}); } catch {}
    },
    evaluateBackground(intent) {
      if (disposed) throw fault('SERVICE_STOPPED');
      if (!intent || typeof intent.intent !== 'string') throw fault('INVALID_INTENT');
      try { return get()?.evaluateActivity?.(intent) || {suitable: false, reason: 'heart-unavailable'}; } catch { return {suitable: false, reason: 'heart-unavailable'}; }
    },
    dispose() { disposed = true; if (typeof off === 'function') off(); },
  };
}
