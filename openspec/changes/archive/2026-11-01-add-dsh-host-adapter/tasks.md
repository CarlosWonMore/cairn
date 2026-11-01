# Tasks

## 1. 适配器形态扩展

- [x] 1.1 `src/agents/adapters.ts`：`AgentKind` 增加 `'dsh'`，`AGENT_KINDS` 同步；`HostAdapter` 增加 `mcpConfigKind: 'json' | 'cordis-patch' | 'none'`，为五个既有宿主逐一补 `'json'`（workbuddy/openclaw 为 `'none'`）；`keeps typecheck 通过`（`npm run typecheck`）
- [x] 1.2 为 `dsh` 增加适配器条目：`mcpConfigKind='cordis-patch'`、`mcpConfigPath` 解析 `<dshHome>/profiles/<profile>/cordis.patch.yml`（profile 默认 `desktop`，可经 `--dsh-profile` 覆盖）、`blockTargetPath` 返回 `<dshHome>/AGENTS.md`、`nativeDisable='none'`、`notes` 写明证据边界（design D6）；验证：`tests/agents/adapters.test.ts` 断言六个 kind 全覆盖、`dsh` 三个路径符合预期
- [x] 1.3 `dshHome` 解析：显式 `--home-root` → `DSH_HOME` 环境变量 → `E_VALIDATION`；**不得**回退 `~/.dsh`（design D4）；验证：`tests/agents/adapters.test.ts` 断言无 `DSH_HOME` 且无显式值时抛错并给出可用提示

## 2. cordis-patch 块编辑器

- [x] 2.1 新增 `src/agents/cordisPatch.ts`：实现 `scanPatchBlocks(text)`，按行切出顶层 `- insert:` 块的范围与内容；不引入 YAML 依赖（design D2）；验证：`tests/agents/cordis-patch.test.ts` 用真实文件形态的 fixture 断言块边界正确、注释行不被计入块内
- [x] 2.2 实现 `upsertCairnInsert(text, blockYaml)`：不存在则追加块、存在且内容不同则替换、内容相同则 `changed=false`；验证：同文件的幂等测试（连续两次调用第二次 `changed=false` 且输出逐字节等于输入）
- [x] 2.3 实现 `removeCairnInsert(text)`：只移除本产品那一个 insert 块（含其 `- insert:` 行），其余逐字保留；验证：移除后其余行与移除前逐字节相同
- [x] 2.4 结构不符一律硬失败（design D3）：非顶层数组、块边界不确定、同一文件出现多个本产品 insert 块，均 `E_CONFIG_CONFLICT` 且零写入；验证：四类畸形 fixture 各一条断言，且断言调用方未写文件

## 3. plan / apply / doctor / uninstall 接入

- [x] 3.1 `planAgentConfig` 增 `cordis-patch` 分支：生成 `write_mcp_config` 动作但 `after` 由块编辑器产出；同名外来条目（已存在非本产品安装的 `serverName: cairn`）进 `conflicts`；验证：`tests/agents/config.test.ts` 断言 plan 零写入（前后文件哈希不变）
- [x] 3.2 `applyAgentConfig` 增该形态写入：沿用既有 `beforeHash` 校验（计划后文件被改 → `E_TARGET_CHANGED`）、备份、`installations.record` 与审计；验证：`tests/agents/config.test.ts` 覆盖成功写入、目标变化被拒、签名篡改被拒
- [x] 3.3 `doctorAgentConfig` 增该形态检查：报告 patch 文件是否存在、本产品条目是否已插入、条目指向的 `server.js` 是否存在；结构失配时报告原因；验证：`tests/agents/config.test.ts` 断言三种状态各一条
- [x] 3.4 `uninstallAgentConfig` 增该形态移除：整块删除而非只删内部行（避免 dangling patch row）；验证：apply 后 uninstall → 文件与原始字节逐字一致（用户未改时）

## 4. CLI 与文档

- [x] 4.1 `src/interfaces/cli/main.ts`：`--host dsh` 可达，帮助文本与 `VALUE_FLAGS` 同步加入 `--dsh-profile`；验证：`tests/interfaces` 下新增断言，`cairn agent plan --host dsh --home-root <tmp>` 输出含 plan 与 signature 且不写文件
- [x] 4.2 `docs/cairn-usage.md` 增补 DSH 一节：形态差异（非 JSON / `- insert:` / 不读 `mcp.json`）、`DSH_HOME` 解析、用户级与项目级叠加；验证：文档内命令可复制执行且与实测输出形态一致
- [x] 4.3 `docs/M0-session-handoff.md` 记录本次形态扩展与"未做"项；验证：`openspec validate add-dsh-host-adapter --strict` 仍 valid

## 5. 集成验收

- [x] 5.1 全量测试：`npm test` 全绿且测试数较基线（609）净增，0 失败；核对退出码与实测计数，不采信自述
- [x] 5.2 真实环境只读核对：对开发机既有手工接入的 patch 文件执行 `cairn agent doctor --host dsh`，确认识别为"已安装"而非报告缺失；**不**在此步执行 apply（避免二次写入真实宿主配置）
- [x] 5.3 真实环境写回环验证：在临时 HOME + 临时副本 patch 文件上跑 plan → apply → doctor → uninstall，断言最终字节与原始一致（不碰真实 `cordis.patch.yml`）

## Workflow follow-up

- 变更归档前需用户审阅 proposal/specs/design/tasks 并确认进入 apply。
- 归档时把两条 delta 合并进主规格 `agent-interfaces` 与 `agent-onboarding`。
