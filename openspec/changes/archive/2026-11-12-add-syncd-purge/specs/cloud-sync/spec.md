## ADDED Requirements

### Requirement: 受限的备份对象删除

syncd SHALL 支持删除**备份对象**，且 MUST 只允许删除解码后 key 中含备份段（`/backups/`）的对象。

删除 MUST 复用既有的路径安全校验（正则白名单 + 解析后必须位于数据目录内），MUST NOT 引入绕过该校验的新路径。

对不含备份段的对象，服务端 MUST 以拒绝状态码响应，MUST NOT 执行任何文件删除。

删除不存在的对象 MUST 幂等成功（新版服务端对不存在的备份对象返回成功，不返回错误）。

因此「响应 404」SHALL 唯一表示**服务端没有该删除能力**（旧版），MUST NOT 与「对象不存在」混淆——客户端 MUST 把 404 解释为不支持并降级，MUST NOT 记为已删除。

#### Scenario: 删除备份对象成功
- **GIVEN** 数据目录中存在 `chunks/vaults/<v>/backups/<dev>/<name>`
- **WHEN** 发送删除请求
- **THEN** 该文件被删除，响应成功，再次列举不再包含它

#### Scenario: 删除同步链对象被拒绝
- **GIVEN** 数据目录中存在 `chunks/vaults/<v>/personal-global/devices/<dev>/chunks/1-abc.bin`
- **WHEN** 对该 key 发送删除请求
- **THEN** 服务端以拒绝状态码响应，文件**仍然存在**，无任何副作用

#### Scenario: 删除 manifest 被拒绝
- **WHEN** 对 `manifests/...` 路径发送删除请求
- **THEN** 被拒绝，文件仍存在

#### Scenario: 路径穿越被拒绝
- **WHEN** 删除请求的 key 含 `..` 或非法字符
- **THEN** 被拒绝，数据目录外无任何影响

#### Scenario: 删除不存在的备份对象
- **WHEN** 删除一个不存在的备份对象
- **THEN** 响应成功（幂等），不报错

### Requirement: 保留策略在 syncd 后端真正生效

远端支持删除时，备份保留策略 SHALL 实际淘汰超出保留份数的对象；不支持时 MUST 如实报告降级（只上传不删），MUST NOT 静默假装已淘汰。

淘汰 MUST 只作用于本设备自己的备份对象，MUST NOT 触碰其他设备或其他前缀的对象。

#### Scenario: syncd 支持删除后策略生效
- **GIVEN** 保留份数为 N，远端已有 N 份本设备备份
- **WHEN** 上传第 N+1 份
- **THEN** 最旧的一份被真正删除，列举可见份数为 N

#### Scenario: 不支持删除时诚实降级
- **GIVEN** 远端不支持删除（旧版 syncd）
- **WHEN** 上传并尝试淘汰
- **THEN** 上传成功，输出明确提示「保留策略未生效：远端不支持删除」，MUST NOT 声称已清理
### Requirement: 删除目标必须是普通文件

删除请求指向的目标若**不是普通文件**（目录、符号链接等），服务端 MUST 拒绝该请求且 MUST NOT 崩溃或终止进程。

拒绝后服务端 MUST 继续正常响应后续请求（进程存活、健康检查仍通过）。

#### Scenario: 目录形 key 被拒绝且服务不崩
- **GIVEN** 数据目录中存在一个目录 `chunks/vaults/<v>/backups/<dev>`（无文件名部分）
- **WHEN** 对该路径发送删除请求
- **THEN** 请求被拒绝，目录仍在，且紧接着的 `/healthz` 仍返回成功

#### Scenario: 崩溃不算通过
- **WHEN** 任何形式的删除请求触发文件系统错误（EISDIR / EACCES / EBUSY 等）
- **THEN** 服务端 MUST 返回错误状态码而非让进程退出

