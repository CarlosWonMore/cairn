# 云同步变更独立验证报告（2026-10-25 第三轮）

验证对象：`add-real-cloud-sync`（capability: cloud-sync）与 `fix(store)` 冷启动竞态修复
验证方式：不采信 ZCode 自述与 artifacts 证据文件，独立复跑 + 自建探针 + 真实 OBS/ECS 环境实测
运行环境：Windows 笔记本，Node v22.22.2；远端为华为云 OBS（桶 carloswon，`cairn/` 前缀）与阿里云 ECS（Ubuntu 22.04 / Node v22.22.2，Tailscale `100.65.135.122`）

## 1. 结论

修复的主线问题成立，云同步在真实环境可跑通；但存在 **2 个必须处理的问题**：syncd 的服务端命名空间没有 vault 隔离（第二个 vault 会让所有 pull 直接失败），以及两项安全证据机制实际失效（泄漏审计与代次 CAS 在真实密文下不起作用）。

| 项 | 结论 |
|---|---|
| 冷启动并发缺陷（上轮 P1） | **已修复**。340 进程 0 失败，对比上轮 20% 失败率 |
| 全量测试稳定性 | **已修复**。3 连跑 385/384/0，上轮 6 跑 2 挂 |
| 真实 OBS 双设备同步 | **通过**（我自建金丝雀复验，非采信其脚本） |
| local_only 未上行 | **属性成立**，但 ZCode 用来证明它的审计脚本失效（见 §5.2） |
| ECS syncd 部署与鉴权 | **通过**（代码与仓库 sha256 一致、401/400 边界正确） |
| Windows↔Linux 双向同步 | **通过**（干净数据目录下），但存在命名隔离缺陷（见 §5.1） |
| syncd manifest 代次 CAS | **失效**（真实密文下不生效，文档声称 409） |

## 2. 复跑数据

### 2.1 全量测试

```
run1 EXIT=0  # tests 385  # pass 384  # fail 0  # skipped 1
run2 EXIT=0  # tests 385  # pass 384  # fail 0  # skipped 1
run3 EXIT=0  # tests 385  # pass 384  # fail 0  # skipped 1
```

唯一 skip 是真实环境门控用例（缺 OBS 凭据才跳过）。带上凭据单跑该文件：`tests 47 / pass 47 / fail 0 / skipped 0`，门控用例真实执行并通过。断言总数 1,637，无 `test.skip`、无 todo。

### 2.2 冷启动并发（上轮 P1 的回归）

| 场景 | 样本 | 失败 |
|---|---|---|
| 4 进程并发冷启动写（60 轮） | 240 进程 | 0 |
| 4 进程并发冷启动写（30 轮 ×3 次） | 360 进程 | 0 |
| 3 个 CLI 同时冷启动 `add`（40 轮） | 120 进程 | 0 |
| 同上轮基线 | — | 4 进程 20%（8/40 轮）、3 CLI 10%（12/120） |

首轮采样曾出现 1 轮 1/4 失败，stderr 只剩 `node:fs:2430` 片段；此后 340 个进程未再复现，判为未确认的偶发（可能是探针自身清理时序），不足以定性。

新增的 `tests/store/cold-start.test.ts` 是**有效回归**，不是空测试：由子进程持未提交写事务 1.2s，父进程在锁持有期间必须经有界重试打开并写入成功。

### 2.3 OpenSpec

`openspec validate --all --strict` → 6 passed / 0 failed；`add-real-cloud-sync` 的 17 项 tasks 全部勾选（17/17），变更尚未 archive。

## 3. 真实 OBS 双设备（独立复验）

不复用 `scripts/verify-real-obs.mts`，自建探针（`artifacts/verify-2026-10-25b/probe-real-obs.mjs`），金丝雀由我生成：

| 检查 | 结果 |
|---|---|
| A `vault init-remote --provider obs` | PASS（新 vault，`cairn/vaults/<id>/`） |
| `import` 生成 local_only 记忆 | PASS |
| `sync push`（2 条 personal-global + 1 条 local_only） | PASS，仅 1 chunk / 2 事件 |
| 远端对象数 | 2（1 chunk + 1 manifest） |
| 原始字节含明文（S1/S2/L1） | 0 / 0 / 0（全为密文） |
| 解密+解压后含 S1/S2 | 1 / 1（内容确实上行） |
| 解密+解压后含 L1（local_only） | **0（未上行）** |
| B 用恢复材料接入 → pull | PASS，applied 2 |
| B 检索 S1 / S2 / L1 | 1 / 1 / **0** |

探针结束后已删除本轮写入的 2 个对象；另清理了首轮探针遗留的 2 个对象（发生在我的探针缺陷期间）。桶内匿名访问与匿名列举均返回 403。

## 4. 真实 ECS syncd

| 检查 | 结果 |
|---|---|
| 部署文件 `/opt/cairn-syncd/cairn-syncd.mjs` | sha256 **与仓库完全一致**（5c99d233…） |
| systemd | `active` + `enabled`，Restart=on-failure，ExecStart 指向 `/opt/node22/bin/node` |
| 监听 | 仅 `100.65.135.122:8471`（Tailscale 接口，公网未开） |
| 无 token / 错误 token | 401 / 401 |
| 路径穿越 `..%2f..%2fetc%2fpasswd` | 400 |
| ECS 端 `doctor` | integrity ok / foreignKey 0 / schema v2 / FTS ok / 4 条 active |
| 跨平台双向（干净数据目录） | A push → B pull → B 检索命中；B push → A pull → A 检索命中 |

服务端数据目录我在验证中临时隔离过（tar 备份 → 空目录 → 实测 → 原样恢复 + 重启），恢复后 `healthz` 正常、文件数与备份前一致。

## 5. 发现的问题

### 5.1 P1：syncd 没有 vault 隔离，第二个 vault 会让 pull 整体失败

**现象**：同一 syncd 上只要存在**另一个 vault** 的设备，`sync pull` 就直接报错退出：

```
{ "error": { "code": "E_VALIDATION", "message": "auth_tag_invalid" } }
```

**复现**（10 秒内稳定复现）：A 新建 vault 推送 → B 加入同 vault → pull → 必现上述错误。删除第三方设备目录后同一命令立刻恢复正常。

**根因**：地址布局不对称。OBS 把 vault 折进前缀（`cairn/vaults/<vaultId>/personal-global/devices/...`），syncd 只存 baseUrl，服务端实际路径是 `chunks/personal-global/devices/<deviceId>/...` —— **没有 vault 段**。`pull` 先 `list('personal-global/devices/')` 拿到**全部 vault 的设备**，再逐台解密 manifest；遇到别的 vault 的密文，AAD/tag 校验必然失败，且是硬失败、不跳过。

**影响面**：官方文档已声明「单用户单 vault、无多租户」，但未说明**失败形态**：不是忽略外来设备，而是让本 vault 的同步完全停摆，且错误码是 `auth_tag_invalid`（看起来像密钥损坏，排查会跑偏）。用户换机重建 vault、或做过两次验证留了旧 vault，就会踩到。

**验证过程中的实际形态**：我自己的探针在 ECS 上留了 3 个设备，随即 ECS 侧的 `sync pull` 就挂成 `auth_tag_invalid`；清除后恢复。同一机制也解释了为什么其「跨平台 PASSED」只在当时的单 vault 状态下成立。

**建议**：syncd 侧把 vault 段并入路径（与 OBS 对齐，客户端只需在 prefix 上拼 `vaults/<id>/`）；同时 `pull` 对解密失败的设备降级为「跳过 + 审计 + 汇总提示」，不要整链失败。

### 5.2 P1：local_only「密文审计」恒真，无法发现泄漏

`scripts/obs-no-local-leak.mts` 与 `tests/sync/protocol.test.ts`（`协议：local_only 内容被物理排除`）都做同一件事：解密 chunk 后，**直接在明文里搜金丝雀**。但 chunk 明文是 `gzip(JSON)`（`packChunk` 先 gzip 再加密），搜 UTF-8 字符串必然搜不到。

实测对照（同一份远端数据）：

| 做法 | 命中 S1 |
|---|---|
| 解密后直接搜（= ZCode 脚本的做法） | **0**（漏报） |
| 解密后 gunzip 再搜 | **1**（正确） |

也就是说：**即使 local_only 正文真的被打进了 chunk，这套审计也会报「clean」**。属性目前是成立的（我解压后确认 L1 为 0，且 `eventCount === 1` 的断言是有效的第二道防线），但「密文审计证明 local_only 未上行」这句结论，现有证据不能支撑。修法：解压后再搜（一行 `gunzipSync`），并加一个「故意注入 local_only 事件必须被检出」的反向用例。

### 5.3 P2：manifest 代次 CAS 在真实密文下失效

`syncd` 用 `JSON.parse(readFileSync(...)).generation` 读当前代次；而客户端上传的 manifest 是加密字节，`JSON.parse` 恒抛 → `current = 0` → 任何代次都放行。本地实例实测：

| body 形态 | 同代次重复 PUT（期望 409） | 实际 |
|---|---|---|
| 明文 JSON（合同测试的写法） | 409 | 409 ✅ |
| 二进制密文（真实客户端） | 409 | **200，且内容被覆盖** |

合同测试只测了明文 JSON 这条**真实客户端永远不会走**的路径，所以绿灯不代表线上行为。`docs/cairn-sync.md` 里「manifest 代次 CAS（回退 409）」的表述对真实流量不成立。修法：把 generation 落到旁路元数据（如 `manifest.json.gen` 或 header 侧写），不依赖 body 可解析。

### 5.4 P3：文档与命令面漂移

| 位置 | 现状 | 应为 |
|---|---|---|
| `README.md:15` | 「296 项测试」「无模型、无云端、单机」 | 385 项（1 项门控）；云同步已实现 |
| `AGENTS.md:6` | 「296 项测试；尚未 archive」 | mvp 已归档；当前变更是 `add-real-cloud-sync` |
| `cairn --help` | 不列 `vault` / `sync` 子命令 | 补进帮助（目前只能靠文档发现） |
| OBS `cairn/` 前缀 | 遗留 4 个验证 vault、12 个对象，无清理入口 | 验证脚本收尾删除，或提供 `vault destroy` |

## 6. 我未触碰的部分

- 源码、测试、openspec 制品**一行未改**（工作区干净，19 个提交）。
- 未读取任何真实个人记忆；所有记忆写入都在临时 `CAIRN_HOME` 合成目录内。
- ECS 变更仅限：临时备份/隔离/恢复数据目录（已复原）、清理我自己创建的 3 个测试设备、把 `sync pull` 跑过一次（游标未前进）。
- OBS 变更仅限：写入并删除我自己的测试 vault 对象。
- 凭据只经环境变量注入；本次验证用的临时环境变量文件已落在系统临时目录，未写入仓库。

## 7. 建议的修复顺序

1. syncd 加 vault 段 + `pull` 对外来设备降级跳过（5.1，影响真实使用）
2. 泄漏审计解压后比对 + 反向注入用例（5.2，影响结论可信度）
3. manifest generation 落旁路元数据（5.3）
4. README / AGENTS / `--help` 对齐（5.4）

前 3 项修完再考虑 `add-real-cloud-sync` 的 archive。
