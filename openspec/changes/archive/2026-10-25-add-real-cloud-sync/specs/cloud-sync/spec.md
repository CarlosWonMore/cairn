# Spec Delta

## Purpose

为个人多设备提供以云端为加密中继的可靠同步：本地库永远是权威副本，云端只见密文；同步退出会话关键路径；多设备合并沿用修订链保守合并并保留冲突。

## ADDED Requirements

### Requirement: 加密中继与密钥主权

系统 SHALL 在上行前对 chunk 与 manifest 执行端到端加密（认证加密，AAD 绑定协议版本、vault、space、对象标识），云端 MUST NOT 能读到明文；vault 密钥 SHALL 由用户本地持有并 SHALL 提供恢复材料导出，MUST NOT 上传密钥明文。

#### Scenario: 云端对象不可读

- **GIVEN** 已配置真实 OBS 远端并执行 `sync push`
- **WHEN** 直接读取桶内 `cairn/` 前缀下的任意对象字节
- **THEN** 内容为密文，不含任何记忆明文、路径或设备标识明文

#### Scenario: 密钥丢失

- **WHEN** 用户在新设备缺少 vault 密钥时执行 `sync pull`
- **THEN** 系统明确报错并提示导出过的恢复材料，不创建半还原状态

### Requirement: 追加事件链与 manifest 单写者

同步单位 SHALL 为每设备每空间的追加事件链（device_seq 单调递增）；chunk SHALL 内容寻址且上传不可变；manifest SHALL 由该设备单独写者发布，且代次（generation/head_seq）MUST NOT 回退；重复、乱序、旧代次上传 MUST NOT 破坏本地或远端已接受状态。

#### Scenario: 重复推送幂等

- **WHEN** 同一批事件被 push 两次（含进程中断后重推）
- **THEN** 远端对象集合一致（内容寻址复用），manifest 代次不回退，本地不产生重复记忆

#### Scenario: 先 chunk 后 manifest

- **WHEN** 上传中断于 chunk 已传、manifest 未发布
- **THEN** 下次 push 复用已传 chunk 并完成 manifest 发布，无数据丢失也无孤儿危害

### Requirement: 拉取合并与冲突保留

`sync pull` SHALL 按事件链将其他设备的修订幂等应用到本地：已知修订跳过；父修订未知进入等待依赖状态；基于同一祖先的并发修改 SHALL 保留双方并进入冲突队列（复用 memory-governance 的冲突语义）；tombstone SHALL 传播；MUST NOT 以最后写入时间决定正文归属。

#### Scenario: 双设备离线修改后合并

- **GIVEN** 设备 A、B 同步过同一记忆后各自离线修改
- **WHEN** 两设备先后 `sync pull`
- **THEN** 双方修订都存在于两台设备，记忆进入 conflicted 并保留双方来源，后续由既有冲突解决流程处理

#### Scenario: 跨设备 tombstone

- **WHEN** 设备 A 遗忘一条已同步记忆并 push，设备 B pull
- **THEN** 设备 B 上该记忆变为 tombstoned 且不再出现在活动检索

### Requirement: local_only 物理排除不变

经云端同步路径生成上行包时，`local_only` 与设备限定内容 MUST 在打包前被物理排除（延续 outbox 触发器语义）；该行为 MUST 可通过列举真实远端对象独立验证。

#### Scenario: 远端对象无本地内容

- **WHEN** 含 local_only 记忆的设备 push 后列举远端前缀全部对象并解密检查
- **THEN** 不存在包含 local_only 记忆内容的任何 chunk

### Requirement: 双后端同协议与配置健康

OBS/S3 兼容远端与 ECS syncd SHALL 实现同一 RemoteStore 接口与同一 chunk/manifest 协议；凭据 SHALL 仅从环境变量或本机密钥文件读取，MUST NOT 出现在仓库、日志或导出物；doctor SHALL 如实报告 remote=not_configured / configured(untested) / verified 及后端类型。

#### Scenario: doctor 诚实分级

- **WHEN** 已配置远端但从未成功往返
- **THEN** doctor 报 configured(untested)，不得宣称 verified

#### Scenario: 凭据不入日志

- **WHEN** 同步发生任何错误（含签名失败、403）
- **THEN** 错误与日志不包含 SK、签名串或完整 Authorization 头
