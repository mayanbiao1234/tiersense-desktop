import test from 'node:test';
import assert from 'node:assert/strict';
import { BalanceMonitor, balanceCapability, parseBalance } from '../core/balances.mjs';
const deepseek = { id: 'a', preset: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', enabled: true, balanceMonitor: true, balanceThreshold: 10 };
const reply = total => ({ is_available: total > 0, balance_infos: [{ currency: 'CNY', total_balance: String(total), topped_up_balance: String(total), granted_balance: '0' }] });
const store = () => ({ config: { providers: [{ ...deepseek }], secrets: { providers: { a: 'private-key' } } } });
test('balance requests only use matched official origins and known API paths', () => {
  assert.equal(balanceCapability(deepseek).url, 'https://api.deepseek.com/user/balance');
  assert.equal(balanceCapability({ ...deepseek, baseUrl: 'https://api.deepseek.com' }).supported, true);
  for (const baseUrl of ['https://proxy.test/v1', 'https://api.deepseek.com:8443/v1', 'https://api.deepseek.com/unknown', 'https://user:secret@api.deepseek.com/v1', 'http://api.deepseek.com/v1']) assert.equal(balanceCapability({ ...deepseek, baseUrl }).supported, false);
  assert.match(balanceCapability({ ...deepseek, preset: 'tierflow' }).reason, /待接入/);
});
test('provider responses support cash, credits, decimal strings and signed balances', () => {
  assert.equal(parseBalance('deepseek', reply(-1))[0].total, -1);
  assert.deepEqual(parseBalance('moonshot', { code: 0, status: true, data: { available_balance: 49.58, voucher_balance: 46.58, cash_balance: 3 } }), [{ currency: 'CNY', total: 49.58, cash: 3, granted: 46.58 }]);
  assert.deepEqual(parseBalance('siliconflow', { code: 20000, status: true, data: { totalBalance: '88.88', balance: '0.88', chargeBalance: '88' } }), [{ currency: 'CNY', total: 88.88, cash: 88, granted: 0.88 }]);
  for (const bad of [{}, { balance_infos: [] }, { balance_infos: [{ currency: 'CNY', total_balance: '' }] }]) assert.throws(() => parseBalance('deepseek', bad));
  assert.throws(() => parseBalance('moonshot', { code: 1, status: false, data: { available_balance: 0 } }));
});
test('balance refresh deduplicates, rate limits and retains old value on failure without leaking secrets', async () => {
  const s = store(); let now = 20000, calls = 0;
  const monitor = new BalanceMonitor(s, () => {}, async (url, options) => {
    calls++; assert.equal(url, 'https://api.deepseek.com/user/balance'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer private-key');
    await new Promise(resolve => setTimeout(resolve, 5));
    return calls === 1 ? Response.json(reply(5)) : new Response('private-key', { status: 401 });
  }, () => now);
  await Promise.all([monitor.refresh('a'), monitor.refresh('a')]); assert.equal(calls, 1);
  const first = monitor.snapshot().a; assert.equal(first.balances[0].total, 5); assert.equal(first.low, true); assert.equal(first.refreshing, false);
  await monitor.refresh('a'); assert.equal(calls, 1);
  now += 16000; await monitor.refresh('a'); const failed = monitor.snapshot().a;
  assert.equal(failed.balances[0].total, 5); assert.equal(failed.checkedAt, first.checkedAt); assert.equal(failed.status, 'error'); assert.match(failed.error, /401/);
  assert.equal(JSON.stringify(failed).includes('private-key'), false);
  s.config.secrets.providers.a = 'changed'; assert.equal(monitor.snapshot().a.balances.length, 0);
});
test('credential edits during an in-flight refresh cannot publish the old account balance', async () => {
  const s = store(); let finish;
  const monitor = new BalanceMonitor(s, () => {}, () => new Promise(resolve => { finish = resolve; }));
  const pending = monitor.refresh('a'); s.config.secrets.providers.a = 'new-key';
  finish(Response.json(reply(100))); await pending;
  assert.equal(monitor.snapshot().a.balances.length, 0);
  s.config.providers[0].baseUrl = 'https://custom.test/v1';
  await assert.rejects(monitor.refresh('a'), /官方地址/);
});
test('automatic refresh honors disabled channels and explicit monitoring preference', async () => {
  const s = store(); s.config.providers.push({ ...deepseek, id: 'b', balanceMonitor: false }, { ...deepseek, id: 'c', enabled: false });
  let calls = 0; const monitor = new BalanceMonitor(s, () => {}, async () => { calls++; return Response.json(reply(0)); });
  await monitor.refreshEnabled(); assert.equal(calls, 1); assert.equal(monitor.snapshot().a.balances[0].total, 0);
});
