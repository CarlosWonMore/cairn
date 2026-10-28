# 第五轮：宿主 MCP 接入自检与「假绿」冒烟脚本修复（2026-10-28）

> 性质说明：本轮由 WorkBuddy 独立执行。起因是 ZCode 会话积分耗尽中断，交接不完整；因此本轮不采信中断会话留下的脚本或自述，全部结论来自本机复跑。与第四轮不同，本轮不是修复方自验。

## 1. 结论

中断发生在「真实 HOME 冒烟」这一步：代码零改动、结论零记录，唯一留下的 `scripts/mcp-smoke.mjs` 是**假绿**的（任何时候都输出为空且退出码 0）。而它想证明的 MCP 接入能力本身是成立的——本轮用独立探针跑通 8 个工具的全链路 12 项断言。

本轮已完成：重写冒烟脚本（默认只读、退出码可信、写入需显式守卫）、新增 1 项全链路回归用例、文档数字对齐。源码业务逻辑未改动。

## 2. 中断会话的实际产出

| 动作 | 时间 | 状态 |
|---|---|---|
| 重建 `dist`（与 src 一致） | 08:57 | 有效 |
| 真实 `~/.cairn` 初始化 + 写入 1 条记忆 | 08:57 | 有效（1 条 active、1 条 pending outbox） |
| 运行 `scripts/mcp-smoke.mjs` | 09:00 | **假绿**（stdout 空、exit 0） |
| 验证文档 / handoff 记录 / 提交 | — | 缺失 |
| 宿主 MCP 注册 | — | 未做（`~/.workbuddy/mcp.json`、`~/.codebuddy/mcp.json` 均无 cairn） |

## 3. 假绿根因

原脚本两处组合导致「永远看不见结果」：

1. 取值字段错：`const body = JSON.parse(search.result.content[0].text); body.results[0]` —— `memory_search` 真实返回字段是 `items`，`body.results` 恒为 `undefined`，取下标即抛 `TypeError`。
2. 异常被吞：`finally { p.kill(); process.exit(0); }` —— 退出码被硬编码为 0，未 flush 的 stdout 也一并丢弃。

表现即「零输出 + 退出码 0」。危害不是功能缺陷，而是**证据缺陷**：任何人跑一次都会误判为通过，与 AGENTS.md「0 tests / 0 assertions 不算通过」的验收纪律直接冲突。

## 4. 本轮独立复核证据

| 项 | 命令 | 结果 |
|---|---|---|
| 全量测试连续 2 轮 | `npm test` | 389 / 389 pass，0 fail，0 skip（Node v22.22.2） |
| 类型检查 | `npm run typecheck` | 干净 |
| MCP 8 工具全链路（合成 HOME） | 独立探针 | 12 项断言全 PASS：add→search 命中→get→context→status→update→propose(仅 candidate)→forget(→tombstoned，检索归零)、stdout 0 条非 JSON |
| 真实 HOME 只读冒烟 | `node scripts/mcp-smoke.mjs` | 7 步全 PASS（initialize cairn 0.1.0 / 8 工具 / 命中 1 条 fts / get / context / status / stdout 纯净） |
| 真实宿主启动入口 | `cairn-mcp.cmd` | initialize 正常返回（cairn 0.1.0） |

## 5. 本轮改动

| 文件 | 改动 |
|---|---|
| `scripts/mcp-smoke.mjs` | 重写：默认**只读**（真实库安全）；按真实字段 `items` 取值；不再用 `process.exit()` 吞异常；退出码分级 0 通过 / 1 失败 / 2 用法或环境错误；`--write` 必须显式 `--home`，写真实库需 `--allow-real-write`；`--json` 输出单行摘要 |
| `package.json` | 新增 `npm run mcp:smoke` |
| `tests/interfaces/mcp-roundtrip.test.ts` | 新增 1 项回归：修订留痕（更正后 2 条修订、历史不覆盖）、墓碑保留遗忘原因、遗忘后检索归零、`memory_context`/`memory_status` 返回形态，并显式断言 `memory_search` **不再出现 `results` 别名**（防同类假绿回归） |

### 5.1 顺带修掉的测试自身缺陷（`tests/integration/e2e.test.ts`）

新增用例改变并发配对后，第一次全量跑命中一次 `E2E 双客户端` 失败（`MCP 服务器启动超时`，15.6s）；单独复跑 6 次与全量连跑 3 次均通过，属概率命中。排查出三处测试自身缺陷，均已修正：

| 缺陷 | 修正 |
|---|---|
| 注释写「串行启动：等 a 就绪再拉起 b」，代码却紧接着同时拉起两个进程 | 按注释原意真正串行化（第二个进程在第一个就绪后才启动） |
| `waitReady` 只看 stderr，不看子进程退出码——进程启动即死时会白等满 15s，且报错不含任何证据 | 增加退出码检测；超时与即退两种失败都带 `code` 与 stderr 前缀 |
| `finally` 里直接 `b.stop()`，若第二个进程尚未创建即抛错，会掩盖原始失败 | 改为可选清理（`stopB?.()`） |

修正后全量测试连续 3 轮 390/390 通过。

## 6. 顺带发现（未改，记录待决）

- **`npm test` 现在会真实访问 OBS**：本机用户环境变量含 OBS 凭据，门控用例从 `skip` 变实际执行，故总数 388→389。测试套件此后隐含网络与云端依赖；离线或 CI 环境会退回 388 pass / 1 skip。若要恢复纯本地可复现，建议加显式开关（如 `CAIRN_TEST_REAL_OBS=1`）而非仅凭环境变量存在与否。
- **`memory_propose` 与 `onboarding_propose` 参数形状不同**（单对象 `{content,kind}` vs `items[]`），误用时报错文案是 `content 不能为空`，容易误判为产品缺陷（本轮独立探针曾踩一次）。
- **真实库遗留**：`~/.cairn` 有 1 条 active 记忆与 1 条 pending outbox（远端 `not_configured`，不会上行）。经用户确认**保留**。

## 7. 剩余边界（未因本轮消失）

- **宿主注册未做**：`docs/cairn-usage.md` 把 WorkBuddy 标为 `blocked`（官方只有「自定义连接器」UI，无公开配置路径）。注册要么由用户手动 UI 安装，要么显式授权改第三方配置文件（等于绕过产品自身规则）。
- macOS 未验证（已验证 Windows x64 + Linux/Ubuntu 22.04）。
- 仅同步 `personal-global`；项目/自定义空间同步未实现。
- 公开发布未准备（仓库 private、包名 `@cairn/memory` 未做冲突核查）。
