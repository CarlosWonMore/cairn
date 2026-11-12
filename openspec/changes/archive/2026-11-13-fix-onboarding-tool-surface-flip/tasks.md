# Tasks: MCP 工具面在进程生命周期内冻结

## 1. 服务端（src/interfaces/mcp/server.ts）

- [x] 1.1 `onboardingActive()` 判定移到进程启动路径执行一次，结果冻结为常量；ListTools 读取常量。
- [x] 1.2 启动判定 try/catch：失败按「不暴露条件工具」降级，写 stderr 日志（不得写 stdout——JSON-RPC 纯净性）。
- [x] 1.3 注释更新：说明冻结语义与「重启生效」的取舍。

## 2. 测试

- [x] 2.1 单测：启动有条目 → ListTools 含条件工具且进程内多次请求结果一致。
- [x] 2.2 单测：启动无条目 → 运行中插入导入条目后 ListTools 不变；模拟重启（新进程）后出现。
- [x] 2.3 单测：判定抛错 → server 正常启动、常驻工具可用、条件工具不暴露。
- [x] 2.4 单测：会话内 `memory_decide`/`onboarding_apply` 使条目清零 → ListTools 保持不变。

## 3. 验收

- [x] 3.1 `npm test` 全绿（基线之上只增不减）；`npm run typecheck` 0 错。
- [x] 3.2 `npm run mcp:smoke` 通过（只读真实库）。
- [ ] 3.3 `openspec validate fix-onboarding-tool-surface-flip --strict` 通过。
- [ ] 3.4 `docs/cairn-auto-onboarding.md` 补一句「import 后新会话/重启才出现 onboarding 工具」的说明。
