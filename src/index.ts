/**
 * @cairn/memory 库入口：聚合核心公共 API，供以库方式消费的用户 import。
 * CLI / MCP 入口请使用 bin（cairn / cairn-mcp）或 dist 下的对应文件。
 */

// 核心：类型、作用域、错误、哈希、ID、时间、秘密扫描
export * from './core/index.js';
export { scanText, maskText, assertClean } from './core/secrets.js';

// 存储：打开、迁移、备份、各仓储
export * from './store/index.js';

// 检索与导出
export * from './retrieval/index.js';

// 治理：候选计划与幂等应用
export * from './governance/index.js';

// 首次初始化：发现、快照导入、分批
export * from './onboarding/index.js';
export { discoverSources } from './onboarding/discover.js';

// 后台任务
export * from './jobs/index.js';

// 投影与宿主配置
export * from './projection/index.js';
export * from './agents/index.js';

// 应用服务（CLI 与 MCP 共用的规则实现）；AddMemoryInput 与 store 仓储重名，只导出无冲突成员
export { AppService, CallerContext, MemoryDetail, DoctorReport, ScopeSelection } from './interfaces/app-service.js';
