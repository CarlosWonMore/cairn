# Tasks

## 1. 插件骨架

- [x] 1.1 `plugin/dsh/package.json`：独立子包，`dsh.bundle.patch` 指向 `cordis.patch.yml`，**不加入根 workspaces**；验证：`npm pkg get` 可读、根 `files` 未包含它
- [x] 1.2 `plugin/dsh/cordis.patch.yml`：以 `insert:` 块声明插件行（注意：裸 `id` 行会被静默丢弃，这个坑已在 add-dsh-host-adapter 里踩过）；验证：YAML 解析通过、块形态正确
- [x] 1.3 `plugin/dsh/tsconfig.json`：独立编译到 `plugin/dsh/dist`；验证：`tsc --noEmit` 零错误

## 2. 召回逻辑（纯函数，可测）

- [x] 2.1 `src/recall.ts`：`shouldInject({enabled, alreadyInjected, message})` —— 开关与去重判定，纯函数；验证：`plugin/dsh/tests/recall.test.ts` 覆盖关闭态、已注入、首次注入
- [x] 2.2 `renderInjection(hits, budgetBytes)`：把命中记忆渲染成一条注入消息，超预算裁剪并明示条数；验证：同文件断言字节不超预算、裁剪条数正确
- [x] 2.3 `filterInjectable(hits)`：对 MCP 返回结果做**二次断言**，剔除 `local_only` / `sensitive`（双保险，不是复制检索逻辑）；验证：同文件构造敏感命中，断言被剔除
- [x] 2.4 去重状态：内存 Map，会话压缩事件到达时清空；验证：同文件断言清空后同 id 可再次注入

## 3. 插件主体

- [x] 3.1 `src/index.ts`：导出 Cordis 插件（`name` / `inject` / `apply`），在 `agent/pre-step` 调召回；验证：`tsc --noEmit` 通过、导出形状符合模板
- [x] 3.2 通过 `@deepseek-ai/dsh-mcp-client` 的 SDK 挂载 Cairn MCP；任何异常都捕获并跳过本次注入；验证：模拟 MCP 不可用时插件不抛错（单测用 stub）
- [x] 3.3 配置项：`enabled`（跟随全局）、`budgetBytes`（默认 1536）、`topK`（默认 5）；验证：`cordis.patch.yml` 默认值与代码默认一致

## 4. 文档与安装

- [x] 4.1 `plugin/dsh/README.md`：安装（`dsh plugin --profile web add <path>`）、开关、降级说明、**明确写出「集成部分手工验证过什么」**
- [x] 4.2 `docs/cairn-usage.md` 增补插件一节，并重申「插件只是体验层，内核仍是 MCP」

## 5. 验收

- [x] 5.1 `plugin/dsh` 单测全绿（`npm test` 在插件目录内）；根项目 `npm test` 不受影响
- [x] 5.2 插件构建产物存在且可被 Node 加载（`node -e "import('./plugin/dsh/dist/index.js')"` 不报错）
- [x] 5.3 **手工冒烟**（需 DSH 重启）：装到 profile、重启、观察是否注入；结果如实写进 README，**不通过就写「未验证」**

## Workflow follow-up

- 归档前需用户审阅四个制品。
- 归档时把 delta 合并进 `agent-interfaces` 主规格。
- 手工冒烟需要 DSH 重启，由用户决定何时执行。
