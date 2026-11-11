## ADDED Requirements

### Requirement: 备份通道与同步通道互不干扰

备份对象 SHALL 使用独立的对象前缀存放，MUST NOT 出现在同步事件链的列举范围内。

同步操作 MUST NOT 列举、读取或删除备份对象；备份操作 MUST NOT 触碰 chunk / manifest。

两套通道 SHALL 共用同一远端配置与凭据，但 MUST 各自独立地报告可用性——一方不可用 MUST NOT 使另一方失败。

#### Scenario: 同步不扫备份
- **GIVEN** 远端同时存在同步对象与备份对象
- **WHEN** 执行同步拉取
- **THEN** 拉取只列举事件链前缀，备份对象不在其视野内

#### Scenario: 备份不碰事件链
- **WHEN** 执行备份上传或保留清理
- **THEN** 任何 chunk 与 manifest 对象均未被读取、修改或删除

#### Scenario: 一方失败不影响另一方
- **GIVEN** 备份前缀因权限问题写入失败
- **WHEN** 执行同步推送
- **THEN** 同步按自身状态正常报告，不被备份失败牵连

### Requirement: 备份密钥与同步密钥的关系可解释

备份的加密 MUST 复用 vault 的密钥体系，MUST NOT 引入需要用户额外抄写的新恢复材料。

备份的密钥派生 MUST 与同步对象使用不同的派生路径，使同一条记忆在两类对象中的密文不可互相替换。

密钥材料的缺失 MUST 以明确错误报告，MUST NOT 静默产生「看起来成功」的备份。

#### Scenario: 无 vault 时备份
- **GIVEN** 本地尚未配置 vault 密钥
- **WHEN** 尝试加密上传备份
- **THEN** 系统明确拒绝并提示先初始化 vault，不上传任何明文或弱加密内容

#### Scenario: 同一条记忆在两类对象中的密文不同
- **WHEN** 同一条记忆既进入过同步对象，也存在于备份快照中
- **THEN** 两处密文不相等，且任一密文无法被当作另一类对象解开
