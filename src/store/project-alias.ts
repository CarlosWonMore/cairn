import { err } from '../core/errors.js';

/**
 * 项目别名归一化（add-stable-project-identity design D2）。
 *
 * 只做**明确等价**的变换：不模糊匹配、不猜父目录、不统一整个路径的大小写
 * （Linux 上 `Proj` 与 `proj` 是不同目录，全小写会把两个项目合并）。
 */

export type AliasKind = 'git' | 'path';

export interface NormalizedAlias {
  kind: AliasKind;
  /** 规范化后的值，也是写进 `project.aliases` 的唯一形态。 */
  value: string;
}

const GIT_SCHEMES = new Set(['https:', 'http:', 'ssh:', 'git:']);

export function normalizeAlias(raw: string): NormalizedAlias {
  const s = raw.trim();
  if (s === '') throw err('E_VALIDATION', '项目别名不能为空');

  // 盘符路径必须先判：否则 `D:\Proj` 会被下面的 scp 形态当成 host=D。
  if (/^[a-zA-Z]:([\\/]|$)/.test(s)) return { kind: 'path', value: normalizePath(s) };

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(s);
  if (scheme) {
    if (GIT_SCHEMES.has(`${scheme[1]!.toLowerCase()}:`)) return { kind: 'git', value: normalizeGitUrl(s) };
    return { kind: 'path', value: normalizePath(s) };
  }

  // scp 形态 `git@host:org/repo.git`（单字母 host 是盘符，已在上方排除）
  const scp = /^(?:[^@/:\s]+@)?([^/:\s]+):(.+)$/.exec(s);
  if (scp && scp[1]!.length > 1) {
    return { kind: 'git', value: withRepo(hostPart(scp[1]!), cleanRepoPath(scp[2]!)) };
  }

  return { kind: 'path', value: normalizePath(s) };
}

/** `https://Host:8443/o/r.git` / `ssh://git@host/o/r.git` → `https://host:8443/o/r`。 */
function normalizeGitUrl(s: string): string {
  const u = new URL(s);
  // ponytail: 只丢 scheme 默认端口（22/443）。非默认端口保留，避免把两个远端合并成一个。
  const port = u.port !== '' && u.port !== '22' && u.port !== '443' ? `:${u.port}` : '';
  return withRepo(`${u.hostname.toLowerCase()}${port}`, cleanRepoPath(u.pathname));
}

function withRepo(host: string, repoPath: string): string {
  return repoPath === '' ? `https://${host}` : `https://${host}/${repoPath}`;
}

function hostPart(host: string): string {
  return host.toLowerCase();
}

function cleanRepoPath(p: string): string {
  return p
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
}

/** 分隔符统一 `/`、盘符大写、去尾斜杠；目录名大小写原样保留。 */
function normalizePath(s: string): string {
  let v = s.replace(/\\/g, '/');
  // UNC 前导 // 有意义，不能被折叠
  v = v.startsWith('//') ? `//${v.slice(2).replace(/\/{2,}/g, '/')}` : v.replace(/\/{2,}/g, '/');
  v = v.replace(/\/+$/, '');
  if (/^[a-zA-Z]:$/.test(v)) v += '/'; // `D:\` → `D:/`
  if (/^[a-zA-Z]:\//.test(v)) v = v[0]!.toUpperCase() + v.slice(1);
  return v;
}
