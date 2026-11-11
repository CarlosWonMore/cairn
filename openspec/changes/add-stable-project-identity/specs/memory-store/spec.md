## ADDED Requirements

### Requirement: 项目身份稳定且与路径解耦

系统的项目主键 SHALL 是一个与具体路径、URL 无关的稳定标识；路径与仓库地址 SHALL 只作为该标识的**别名**存在。

同一逻辑项目在**不同设备、不同挂载路径、不同仓库地址**下解析时，SHALL 得到同一个项目标识（在别名已互相登记的前提下）。

系统 MUST NOT 以绝对路径或仓库 URL 直接作为项目主键。

#### Scenario: 同一项目在不同路径下解析
- **GIVEN** 项目 P 已登记别名 `D:\\Neusoft\\HDRS6Project\\江南大学附属医院`
- **WHEN** 在另一台设备上以别名 `E:\\Work\\JiangDaFuShu` 解析并追加为同一项目的别名
- **THEN** 两次解析返回同一个项目标识，且该项目有两条别名

#### Scenario: 仓库改名不影响既有记忆归属
- **GIVEN** 项目 P 的别名是 `https://github.com/owner/old-name.git`，其下有若干记忆
- **WHEN** 仓库改名为 `https://github.com/owner/new-name.git` 并追加为新别名
- **THEN** 该项目标识不变，原有记忆仍归属该项目

#### Scenario: 从未见过的路径新建项目
- **WHEN** 用一个从未登记过的路径解析项目
- **THEN** 系统创建新项目，生成稳定标识，并把该路径记为第一条别名

### Requirement: 别名归一化

系统 SHALL 在比较别名前执行归一化，使**明确等价**的写法匹配到同一项目。

归一化 MUST 至少覆盖：仓库 URL 的协议差异（`https://` 与 `ssh://git@`）、可选的 `.git` 后缀、URL 中的凭据、主机名大小写；路径的盘符大小写、尾部分隔符、`\\` 与 `/` 的差异。

归一化 MUST NOT 执行任何模糊或启发式匹配（如忽略目录名差异、猜测同级目录）。

#### Scenario: git URL 的两种写法等价
- **WHEN** 分别用 `https://github.com/o/r.git` 与 `git@github.com:o/r.git` 解析
- **THEN** 两次得到同一个项目，且别名表中只有一条等价记录（或明确记录两条等价别名指向同一项目）

#### Scenario: 路径分隔符与大小写差异等价
- **WHEN** 分别用 `d:\\proj\\x\\` 与 `D:/proj/x` 解析
- **THEN** 两次得到同一个项目

#### Scenario: 不相关的路径不得被误判
- **WHEN** 分别用 `D:\\proj\\x` 与 `D:\\proj\\xy` 解析
- **THEN** 得到两个不同项目（不得误合并）

### Requirement: 别名可追加且历史可追溯

系统 SHALL 允许为一个已有项目追加新别名；MUST NOT 因追加别名而修改已有记忆的项目归属。

系统 MUST 保留别名列表供审计；MUST NOT 静默丢弃旧别名。

当把一个已被**其他项目**占用的别名追加到当前项目时，系统 MUST 拒绝并给出冲突信息，MUST NOT 静默改绑。

#### Scenario: 追加别名后旧记忆不变
- **GIVEN** 项目 P 有 10 条记忆
- **WHEN** 为 P 追加一条新别名
- **THEN** 10 条记忆的归属完全不变，别名表多一条

#### Scenario: 别名已被别的项目占用
- **GIVEN** 别名 A 已属于项目 P1
- **WHEN** 尝试把 A 追加到项目 P2
- **THEN** 系统拒绝并报告 A 当前属于 P1，P2 未被修改

### Requirement: 解析入口与结果可解释

系统 SHALL 提供命令行与 MCP 两个入口用于「给定路径或 URL，返回项目标识」。

返回结果 MUST 说明本次解析是**命中已有项目**还是**新建项目**，以及命中的是哪一条别名。

解析 MUST NOT 要求该路径在当前设备上真实存在。

#### Scenario: 命中已有项目
- **WHEN** 用已登记的别名解析
- **THEN** 返回项目标识，并标明「命中」及所用别名

#### Scenario: 路径在本机不存在
- **WHEN** 用一个本机不存在的路径解析
- **THEN** 仍返回项目标识（命中或新建），不报「路径不存在」错误
