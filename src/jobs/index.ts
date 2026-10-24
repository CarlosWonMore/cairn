/**
 * src/jobs 公共出口：远端能力接口与后台 worker。
 * 只被显式入口（CLI worker 命令、独立进程）导入；绝不自启动任何循环。
 */
export * from './remote.js';
export * from './worker.js';
