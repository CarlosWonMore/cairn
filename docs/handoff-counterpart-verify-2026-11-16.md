# 对端重验提示词（0.6.6）

> 复制整段给对端 agent。**你这次的诊断完全正确**——`27 → 24` 的拆解、revive 副本「两头证据都缺」的根因、以及「修法二选一」的建议，全部准确。我按你的第二条建议（回填 origin）实现，并额外补了存量迁移，因为光改代码救不了已经存在的 24 条。

---

## 你这轮指出的问题，我的处理

你说得对：0.6.5 只堵了两个盲区（发布方有 `sync_pushed`、外源有 origin），**唯独「pull 原地 revive 的副本」两头都缺**。

- **修「将来」**：三条 revive 路径（`scope_reheld` / `project_reheld` / `preserve_reheld`）现在都会在恢复活动时回填 `origin_device_id = 事件发布方`，**仅当原值为 NULL**（已有值不覆盖）。三处共用同一个 helper，没有复制三份。
- **修「已存在的 24 条」**：**schema v8 迁移**。你库里已经有的那 24 条不会重放事件，所以用你库里本来就有的证据回填——`audit_event` 表中 `project_reheld` 等动作的 `detail.$.from` 记录了事件发布方。迁移只补 NULL、绝不覆盖。
  → 你升级后**第一次运行任何 cairn 命令**就会自动应用 v8（`user_version` → 8）。

我没有给缺口判据再加条件去"绕开"这 24 条——那是掩盖数据缺失。

## 本次任务（0.6.6）

### 铁律
只允许 `sync pull` 这一写本地动作；不 push、不 `backfill --apply`、不 forget、不 rescope、不手工改库。
**升级前先 `cairn backup` 并记下路径**——本次会跑 schema 迁移（v7→v8），虽只更新一列，仍要留退路。

### 第 0 步：升级 + 迁移确认
```bash
cairn backup                    # 先备份！记下 path 与 sha256
npm i -g @carloswon/cairn-memory@0.6.6
cairn --version                 # 期望 0.6.6
cairn doctor                    # 会触发 v8 迁移
```
报告：`--version` 值、`doctor` 的 `schemaVersion`（**期望 8**）、迁移前后记忆总数是否一致。

### 第 1 步：核心验证——`upstreamGap` 是否归零（pull 之前！）
```bash
cairn doctor | grep -i upstreamGap
cairn sync backfill             # 默认只读，不要 --apply
```
**期望：`upstreamGap = 0`，backfill 候选 personal / project / preserve 三段全 0。**

这是本轮的核心判据。如果仍是 24，说明迁移没应用或那 24 条的审计里没有 `from`——把下面这段的输出贴回来：

```bash
# 只读：查看 origin 分布 + 有多少条能从 reheld 审计恢复
node -e "const s=require('node:sqlite');const db=new s.DatabaseSync(process.env.USERPROFILE+'/.cairn/data/cairn.db',{readOnly:true});console.log('origin:',JSON.stringify(db.prepare('select coalesce(origin_device_id,\'NULL\') o,count(*) n from memory group by 1').all()));console.log('reheld audit:',JSON.stringify(db.prepare(\"select action,count(*) n from audit_event where action in ('scope_reheld','project_reheld','preserve_reheld') group by 1\").all()))"
```

### 第 2 步：pull 幂等
```bash
cairn sync pull
cairn status
```
期望 `totalApplied=0`、各链游标仍在 head、状态数字一条不变（总数 50 / project 27 / personal 7 / archived 14 / 3 条项目链）。
本轮应该仍然看不到 `revived` 字段（没有事件落地，`outcome=null` 是正常的早退分支）——**不要据此判失败**。

### 第 3 步：报告
```
升级：cairn --version = <值>；schemaVersion = <值>；总数迁移前后 <a> -> <b>
核心：upstreamGap = <n>（期望 0）；backfill 候选 personal=<n> project=<n> preserve=<n>（期望全 0）
pull：totalApplied=<n>；状态对比 总数=<n> project=<n> personal=<n> archived=<n> 链=<n>
异常与未验证项：<如实写>
```

### 判定
- **核心**：`upstreamGap` 从 24 变 **0** ⇒ 修复成功。
- 若变成 0 且 pull 后数字不变 ⇒ 全部通过。
- 若仍 >0，贴第 1 步那条只读命令的输出，我按数据判断。

不符就贴原始输出，**不要自己修**（尤其是不要 `backfill --apply` 去"清掉"缺口——那会真的把副本再推一遍）。

### 回滚
本次有 schema 迁移。若出错：用第 0 步的备份文件覆盖 `~/.cairn/data/cairn.db`（先关掉其他 cairn 进程），v8 只更新一列 `memory.origin_device_id`，数据本身无风险。
