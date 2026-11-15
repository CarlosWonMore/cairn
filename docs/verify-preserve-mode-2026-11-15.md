# add-cloud-preserve-mode 真实云端双设备验证记录（2026-11-15）

> 对应 OpenSpec 变更 `add-cloud-preserve-mode` 任务 8.5。授权：用户 2026-11-15 明确授权真实库与真实云端操作。
> 环境：主设备 `dev_01a18002`（Windows，`~/.cairn`，schema v6→v7）+ 对端 `dev_01a1bdfb`（Windows，0.6.1，schema v6 不动）；真实 syncd 中继（Tailscale 内网）。迁移前快照：`~/.cairn/backups/manual-pre-v7-20261115-162048/`。

## 1. 结论

**通过。** 保管模式（双模）、存量迁出通知补发、保管链密文上云、拉取侧物化过滤、旧版本兼容全部在真实库 + 真实云端验证成立；主设备 27 条事故残留的收敛闭环完成。

## 2. 逐步证据

| 步骤 | 操作 | 结果 |
|---|---|---|
| P0 | 迁移前文件级快照（库已关闭） | `manual-pre-v7-20261115-162048/`（cairn.db + wal + shm） |
| P1 | 真实库打开（doctor） | schema 6→**7** 自动迁移，integrity ok，FK 0 违规；54 active 无损伤；doctor 新提示如实报告「存量迁出通知缺口 27 条」 |
| P1 | `vault config --preserve-device-bound on` | vault.json 更新 + `preserve_mode_changed` 审计 |
| P1 | `sync backfill`（dry-run → apply） | dry-run：保管链候选 48（21 device-local + 27 project-global）+ 迁出补发 27，personal 0——与库实测逐条吻合；apply：48 + 27 全部入队；再 dry-run 归零 |
| P1 | `sync push` | 个人链 27 条迁出事件（headSeq 61→87）+ 保管链 48 条 upsert（headSeq 144）；`unroutable: 0`；期间一次瞬时 syncd 网络失败被「失败复位」正确重试（见 §4-2） |
| P1 | `sync push`（重复） | `{pushed: false}`——幂等 |
| P2 | 远端全量审计（`remote-audit.json`） | **137/137 事件解密+内容哈希校验通过**（个人链 89 upsert + 3 tombstone + 38 scope_exit；保管链 48 upsert）；保管链描述符精确：`project-global/01a1daf8…`×27 + `device-local(dev)`×21；**明文扫描 0 命中**（8 条真实内容样本 × 15 个远端对象原始字节）；解密失败 0 |
| P2.5 | 主设备自拉取（找回路径） | 首轮：重放 38 条迁出（27+11）只补标记**不误归档**（记忆已在对应作用域）、保管链 48 条全幂等跳过；修复陈旧修订等待后自游标 10→**87** 全量推进；再拉 totalApplied 0 |
| P3 | 对端（0.6.1）`sync pull` | 来自主设备的个人链 headSeq 87，**`scopeExited: 27`**，totalApplied 27 |
| P3 | 对端 `doctor` | **active 33 → 6，archived 11 → 38（+27）**，总数 46 不变——27 条残缺副本转「不再持有」，零数据丢失、无墓碑；对端 schema 保持 v6（0.6.x 不请求 preserve 前缀，旧版本兼容）；outbox 43 done / 0 pending（拉取不产生上行）；upstreamGap 0 |

## 3. 与规格场景的对照

- 「开启模式设备限定内容密文上云」：保管链 48 事件密文上云、描述符与归属设备标签齐备、明文 0 命中 ✓
- 「非归属设备不物化 / 保管链不回流他人」：对端 pull 无 preserve 前缀访问（0.6.x 只列举个人链）✓
- 「另一台设备收到迁出事件 / 迁入不可同步作用域同样通知」：对端 27 条 scopeExited、不删数据、无墓碑 ✓
- 「旧版本对端不受影响」：对端 0.6.1 全程正常，schema 未动、无报错、不卡链 ✓
- 「存量迁出通知补发」（追加场景）：27 条 0.6.x 时代静默迁移由 backfill 补发收敛 ✓
- 「模式与状态如实可见」：主设备 doctor 双链 per-chain 汇报（localSeq/游标/pending/gap）✓
- 「设备找回」：主设备自拉取验证了重放机制（38+48 事件幂等收敛）；**对端升级后的自有保管链找回留作发版后动作**（见 §5）

## 4. 验证期间发现并修复的问题（均已带回归测试）

1. **存量迁出通知无人生成**：27 条事故迁移发生在 0.6.x 语义下（迁往可上行目的地不发通知），design 的迁移故事缺事件来源。修复：`findScopeExitGap` 纳入 backfill（曾推个人链 + 已离开 + 无任何 sync_scope_exit 任务），doctor 同步提示；规格 delta 增「存量迁出通知补发」场景。
2. **markDone 先于 publishChain（重构引入）**：保管链发布失败时任务永久卡死 done——本地「已上传」远端 0 对象（实测 48 个任务卡死）。修复：恢复「先发布后 markDone」契约 + 失败注入回归测试（保管链失败→任务回 pending、个人链不受牵连）。
3. **自链重放陈旧修订永远 waited**：主设备自拉取自游标卡在 10（本地已 v2、重放 v1）。修复：内容哈希已在本记忆历史 → 跳过（链无关——每设备每链本就是单写者）；游标 10→87。

另：CLI `--preserve-device-bound` 取值型 flag 漏登记 VALUE_FLAGS（promote --scope-preset 同款老坑），补登记 + CLI 回归测试。

## 5. 边界与遗留（不因本记录消失）

- **对端升级后的自有保管链找回**（发版后可选 P5）：对端 0.6.2 → 首开自动迁移 v7 → `vault config on` → `backfill --apply` → `push` → （可选）删库重开 pull 验证找回。对端自己的 device-local 内容目前仍在本地、未上云。
- 诊断期间在远端个人链前缀遗留 3 个无害垃圾对象（`chunks/probe300k-*.bin`，不被任何 manifest 引用；syncd 协议不开放同步链 DELETE）——服务器侧顺手清理即可。
- 对端找回验证依赖其 deviceId 不变（`device.json` 保留）；re-enroll 换 id 后旧保管链成孤儿（design 已明示，restore 备份通道兜底）。
- 密钥泄露爆炸半径在保管模式开启的 vault 上扩大到全部记忆（用户已确认的取舍，见 `docs/cairn-security.md` §2.1）。

## 6. 门禁（验证后复跑）

`npm test` **865 / 864 / 0 / 1 skip**；typecheck 0 错；`npm run test:e2e` PASS；`npm run test:ui` **115/115**；`openspec validate add-cloud-preserve-mode --strict` 通过。

## 7. 对端 0.6.2 升级后验证（2026-11-15 晚，用户转交对端 AI 报告）

全部 PASS、0 数据偏差：0.6.2 安装确认；v7 自动迁移零数据变化（46 条总数不变，1/6/38/1）；pull 双源幂等（totalApplied 0 ×2）；归属设备三态正确（新写入 = dev_01a1bdfb，存量 = null，样本 id `01a1df7e-2273-7768-8b6c-51d7e6ab1987` 保留）；47 条全部 personal-global、无孤儿 scope 行；webUI 全库审计视图语义向用户解释确认（38 条已归档 = 迁出通知结果，不是同步失败）。

附注：① `cairn export` 既有语义即「活动内容 + 遗忘时间线」，不含 archived/candidate——验证提示词里的预期写错，非工具缺陷，对端 AI 以只读 SELECT（readOnly: true，仅 SELECT）完成断言；② 对端验证期间 sync push / forget / rescope / 删除类操作全程未触碰。
