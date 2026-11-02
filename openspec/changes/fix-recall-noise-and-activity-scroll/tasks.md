# Tasks

## 1. 召回精度

- [x] 1.1 `recall.ts` 加 `STOP_TERMS`（60 个虚词二字组）与 `isStopTerm`；验证：`recall.test.ts`「虚词进黑名单、实义词不进」
- [x] 1.2 `deriveQueries` 跳过虚词，从有实义的二字词取 top2；验证：`injector.test.ts`「虚词二元组不当查询」
- [x] 1.3 `scoreHit` 只认「正文里真的出现且不是虚词」的词，强词 2 分 / 二字词 1 分；验证：计分用例
- [x] 1.4 `rankHits` 按分降序、同分保持首次命中顺序；验证：排序与截断用例
- [x] 1.5 召回合并改为按 id 累积命中词（同一正文被多个词带回来是加分信号，不是重复）；验证：既有「多路查询去重合并」用例

## 2. 面板滚动

- [x] 2.1 活动记录列表加 `maxHeight: 56vh`，与既有 `flex:1 1 auto; minHeight:0` 共存；验证：`node --check`
- [x] 2.2 结构测试不受影响（根节点仍是 左栏 + 手柄 + 右栏）；验证：`panel-render.test.ts`

## 3. 验证

- [x] 3.1 `npx tsx --test plugin/dsh/tests/*.test.ts` 全绿（79）
- [x] 3.2 `npx tsc -p tsconfig.json` 重建 `dist`（插件从 dist 加载，不重建等于没改）
- [x] 3.3 `npm test` 全绿（668 / 667 / 0 / 1）
- [x] 3.4 `openspec validate fix-recall-noise-and-activity-scroll --strict` 通过
- [ ] 3.5 **手工冒烟（未验证项）**：重启 DSH 后在视频会话里确认——活动记录有自己的滚动条、左侧累计列表不再混入无关项目的记忆
