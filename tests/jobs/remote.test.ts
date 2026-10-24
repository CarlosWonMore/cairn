import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotConfiguredRemote, getRemoteStore } from '../../src/jobs/remote.js';

test('remote：MVP getRemoteStore 恒返 NotConfiguredRemote（configured=false）', () => {
  const remote = getRemoteStore();
  assert.ok(remote instanceof NotConfiguredRemote);
  assert.equal(remote.configured, false);
  // 即便传了配置也不假装接入云端
  const withConfig = getRemoteStore({ endpoint: 'https://example.invalid' });
  assert.equal(withConfig.configured, false);
});

test('remote：NotConfiguredRemote 每个方法以 E_FORBIDDEN/remote_not_configured 拒绝', async () => {
  const remote = new NotConfiguredRemote();
  const expectRefusal = (e: unknown): boolean => {
    const err = e as { code?: string; message?: string };
    return err.code === 'E_FORBIDDEN' && err.message === 'remote_not_configured';
  };
  await assert.rejects(() => remote.getObject('vaults/v/chunks/h.bin'), expectRefusal);
  await assert.rejects(() => remote.putImmutable('jobs/x.bin', new Uint8Array([1]), 'h'), expectRefusal);
  await assert.rejects(() => remote.list('vaults/v/'), expectRefusal);
  await assert.rejects(() => remote.getManifest('space', 'device'), expectRefusal);
  await assert.rejects(() => remote.putManifest('space', 'device', {}, 1), expectRefusal);
});
