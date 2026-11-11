import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAlias } from '../../src/store/project-alias.js';

/**
 * 归一化合同（add-stable-project-identity tasks 1.4 / design D2）：
 * 只做明确等价变换——三种 git 写法等价、盘符与分隔符等价、
 * 目录名大小写不同**不**等价、相邻不同目录**不**等价。
 */

test('归一化：三种 git 写法归一到同一形态', () => {
  const https = normalizeAlias('https://github.com/o/r.git');
  const scp = normalizeAlias('git@github.com:o/r.git');
  const ssh = normalizeAlias('ssh://git@github.com/o/r.git');
  assert.equal(https.kind, 'git');
  assert.equal(https.value, 'https://github.com/o/r');
  assert.deepEqual(scp, https);
  assert.deepEqual(ssh, https);
});

test('归一化：git URL 去凭据、host 小写、去尾斜杠', () => {
  assert.equal(normalizeAlias('https://user:tok@GitHub.COM/o/r/').value, 'https://github.com/o/r');
  // 非默认端口保留：不把不同端口的远端合并成一个（这里用不带 .git 的形态，
  // 让「.git 剥离」只由上面的等价用例钉住）
  assert.equal(normalizeAlias('https://github.com:8443/o/r').value, 'https://github.com:8443/o/r');
});

test('归一化：路径统一盘符与分隔符，保留目录名大小写', () => {
  assert.equal(normalizeAlias('d:\\proj\\x\\').value, 'D:/proj/x');
  assert.equal(normalizeAlias('D:/proj/x').value, 'D:/proj/x');
  assert.equal(normalizeAlias('D:\\Proj\\X\\').value, 'D:/Proj/X');
  assert.equal(normalizeAlias('D:/').value, 'D:/');
});

test('归一化：不相关的路径不得被误判为同一项目', () => {
  assert.notEqual(normalizeAlias('D:/proj/x').value, normalizeAlias('D:/proj/xy').value);
  assert.notEqual(normalizeAlias('D:/Proj').value, normalizeAlias('D:/proj').value);
});

test('归一化：空别名被拒绝', () => {
  assert.throws(() => normalizeAlias('   '), /不能为空/);
});
