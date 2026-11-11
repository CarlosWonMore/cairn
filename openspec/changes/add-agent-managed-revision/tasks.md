# Tasks: Agent 处置批注的修订提案

> 硬边界：Agent 只能提案，不能 apply；采纳必须复用 `memory_update`，不新造写入路径；秘密在生成时扫描。

## 1. 提案存储

- [ ] 1.1 新增 `src/governance/revision-proposal.ts`：读写 `console/revision-proposals.json`，原子替换、坏文件按空处理（照 `annotations.ts` 的模式）。
- [ ] 1.2 结构：`{ id, memoryId, revisionIdAtPropose, annotationId?, beforeExcerpt, afterContent, reason, proposedBy, proposedAt, status, resolvedAt?, resolvedBy?, rejectReason? }`。
- [ ] 1.3 陈旧判定：对比 `memory.currentRevisionId` 与 `revisionIdAtPropose`。
- [ ] 1.4 测试：写读往返、坏 JSON 不崩、陈旧判定正确。

## 2. 提案生成

- [ ] 2.1 `proposeRevision({ memoryId, afterContent, reason, annotationId? })`：**先 `scanText`**，命中拒绝整条。
- [ ] 2.2 **明确不改记忆**：不得调用任何 `memories.*` 写方法。
- [ ] 2.3 记录 `revisionIdAtPropose = memory.currentRevisionId`。
- [ ] 2.4 测试：生成后记忆逐字段不变（正文/状态/authority/修订数/scope）；含秘密时拒绝且不落盘。

## 3. 采纳与拒绝

- [ ] 3.1 `applyRevision(id)`：查提案 → **版本一致性检查**（`revisionIdAtPropose` vs 当前）→ 调 `memory_update`（带 `expectedCurrentRevisionId`）→ 标为已采纳。
- [ ] 3.2 版本不一致：拒绝、标 `stale`、**记忆不变**。
- [ ] 3.3 `rejectRevision(id, reason)`：记录理由与时间，不删除提案。
- [ ] 3.4 批量 apply：逐条报告；单条失败不影响其余。
- [ ] 3.5 测试：采纳后权威是 `user_confirmed`；陈旧拒绝且记忆不变；拒绝后不再出现在待办。

## 4. CLI

- [ ] 4.1 `cairn revision list [--status pending|applied|rejected|stale]`。
- [ ] 4.2 `cairn revision show <id>`：展示改前/改后对照、理由、关联批注。
- [ ] 4.3 `cairn revision apply <id>` / `apply --all`（逐条打印）。
- [ ] 4.4 `cairn revision reject <id> "理由"`。
- [ ] 4.5 帮助文本。
- [ ] 4.6 测试：apply 退出码、陈旧时退出码 4、拒绝对记忆零影响。

## 5. MCP（只读 + 只写卡）

- [ ] 5.1 `revision_propose`（参数 `memory_id`、`after_content`、`reason`、可选 `annotation_id`）。
- [ ] 5.2 `revision_list`（参数 `status?`、`limit?`）。
- [ ] 5.3 **不得**提供任何 apply 类工具。
- [ ] 5.4 测试：工具面不含 apply；propose 后记忆不变；list 返回正文对照。

## 6. 控制台

- [ ] 6.1 提案列表与卡片视图（改前/改后对照、理由、关联批注、状态）。
- [ ] 6.2 「待确认」标识强制可见；静态导出页无采纳/拒绝控件。
- [ ] 6.3 采纳/拒绝复用 CLI 的同一实现。
- [ ] 6.4 UI 测试（沿用 `e2e-console-ui.mjs` 姿势）。

## 7. 全量验收

- [ ] 7.1 `npm run typecheck` 0 错误。
- [ ] 7.2 `npm test` 全量通过，报告四个数字并与基线对比。
- [ ] 7.3 `openspec validate add-agent-managed-revision --strict` 通过。
- [ ] 7.4 变异对照：去掉版本一致性检查 → 确认「记忆已被改过」用例变红且只有它红。
- [ ] 7.5 负对照：改无关常量 → 零红。

## 8. 文档

- [ ] 8.1 `docs/cairn-auto-onboarding.md` 或新增小节：Agent 提案流程与人的角色。
- [ ] 8.2 `docs/cairn-security.md` 补「Agent 不持有写入权」这一条的落点。
- [ ] 8.3 `CHANGELOG.md` Unreleased。
