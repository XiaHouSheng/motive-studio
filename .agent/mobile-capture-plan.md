# 手机拍照导入（局域网扫码）实施计划

## 一、目标与范围

服务启动后，桌面端展示二维码；手机在同一局域网内扫码打开一个简洁的拍照上传页，拍照/选图后由 AI 提取题目，预览确认后导入到「已有题组」或「按图片新建的题组」。

包含：
- 服务端监听局域网地址 + 启动日志打印手机访问地址
- 手机端独立页面 `/m`（拍照、压缩、识别、预览编辑、选择目标、提交）
- 扫码入口（桌面端二维码弹窗）
- 移动端专用识别/提交接口
- **访问凭证机制**：二维码 URL 携带桌面端生成的 key 对应的 token，无凭证无法访问手机页与移动端接口

不包含：账号体系、多用户并发处理、原始图片归档、移动端查看详解。

## 二、现状分析

| 现状 | 影响 |
| --- | --- |
| [config.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/config.ts#L7) 中 `HOST = "127.0.0.1"` | 手机无法访问，必须改为监听局域网（默认 `0.0.0.0`） |
| [app.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/app.ts#L54-L65) 仅在 production 提供静态资源，dev 由 Vite 5173 提供服务 | 手机端不能依赖 Vite 页面（dev/prod 路径不一致），手机页由服务端直接托管最稳 |
| 已有 `POST /api/question-groups/:id/image-import`（[image-import.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/routes/image-import.ts)），强制要求已存在题组、只识别不落库 | 无法支持「按图片新建题组」，需要新的「无题组识别 + 提交落库」接口 |
| `express.json({ limit: "20mb" })`（[app.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/app.ts#L35)），而图片规则是 4 张 × 6MB，base64 膨胀后约 32MB | 现有桌面图片导入在多图时会 413；app 级中间件先于路由解析，路由级 limit 无效，必须全局放宽为 40mb |
| Repository 已有 `createGroup(title)` / `createQuestion(groupId, content)`（[workspace-repository.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/repositories/workspace-repository.ts#L404-L475)），无事务封装方法 | 需新增批量导入方法，保证「新建组 + 批量建题」原子性 |
| 仓库无二维码依赖 | 需引入 `qrcode` 在服务端生成 SVG |
| 桌面端已有 Dialog/Button 组件与 TopBar 图标按钮模式 | 扫码弹窗可直接复用现有风格 |
| 监听 `0.0.0.0` 后整个站点对局域网可达 | 必须为手机页与移动接口加访问凭证门禁，防止局域网内任意设备访问 |

## 三、方案决策

1. **手机页由服务端托管独立 HTML**：`GET /m` 返回单文件页面（TS 模板字符串内联 HTML/CSS/JS），不依赖 React 构建产物。理由：dev 与 production 都可直接从 `http://<局域网IP>:3001/m` 打开，API 同源、无跨域、无 Vite 资源路径问题。
2. **监听地址改为 `process.env.HOST ?? "0.0.0.0"`**，启动日志同时打印本机地址与局域网手机地址。
3. **二维码在服务端生成**：新增 `qrcode` 依赖，`GET /api/mobile/qr.svg?url=` 返回 SVG，前端 `<img>` 直接引用；仅允许生成本机/局域网地址，避免变成任意二维码生成器。
4. **访问凭证机制（防局域网未授权访问）**：
   - **key 由桌面端生成**：打开弹窗时 `crypto.randomUUID()`（localhost 是 secure context）；
   - **注册换取 token**：`POST /api/mobile/link { key }`，服务端校验 UUID 格式后存入 `MobileSessionStore`（内存 `Map<token, createdAt>`，24h TTL，惰性清理过期项），key 本身不落盘、服务重启即失效；
   - **二维码 URL 用 query 而非 hash**：`http://<局域网IP>:3001/m?t=<token>`。hash 不会发送到服务端，无法做服务端门禁，故用 query；
   - **页面门禁**：`GET /m` 校验 query `t`，无凭证/过期 → 403 HTML 拒绝页；
   - **接口门禁**：`/api/mobile/groups|extract|commit` 校验 header `X-Mobile-Token`（兼容 query `t`），无凭证 → 403 `UNAUTHORIZED`；
   - **凭证铸造仅限本机**：`POST /api/mobile/link` 与 `GET /api/mobile/qr.svg` 校验 `req.socket.remoteAddress` 为回环地址，防止局域网设备自行注册；
   - 多 token 并存（24h 内可多次扫码），服务重启失效后桌面重开弹窗即重新注册。
5. **移动端两步接口**：
   - `POST /api/mobile/extract`：只识别，不落库（复用 `generateQuestionsFromImages`）
   - `POST /api/mobile/commit`：事务写入，`target` 支持 `existing(groupId)` 与 `new(title)`

   这样「识别 → 看到结果 → 再选择目标」的流程成立，取消时也不会留下空题组。
6. **手机端压缩**：canvas 缩放长边至 1600px、JPEG 画质 0.82，最多 4 张、单张 ≤4MB；拍摄按钮使用 `capture="environment"` 直接唤起后置摄像头。
7. **全局体积限制 40mb**：`express.json({ limit: "40mb" })`（app 级修改，路由级无效）。桌面 4×6MB base64 ≈32MB、移动 4×4MB ≈21.4MB 均覆盖。

## 四、改动清单

### 服务端

**1. [config.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/config.ts)**
- `HOST` 改为 `process.env.HOST ?? "0.0.0.0"`，新增 `MOBILE_PATH = "/m"`。

**2. `apps/server/src/services/lan.ts`（新建）**
- `getLanAddresses(port): string[]`：`os.networkInterfaces()` 取 IPv4 非 internal 地址，优先 `192.168.*` / `10.*` / `172.16-31.*`，返回裸 origin `http://<ip>:<port>`（token 由路由层拼接）。
- `isAllowedQrUrl(url, port): boolean`：protocol http、端口匹配、hostname 必须属于本机 IPv4 集合或 `127.0.0.1`/`localhost`。

**3. `apps/server/src/services/mobile-session.ts`（新建）**
- `MobileSessionStore` 类：`register(rawKey): string`（UUID 正则校验、小写归一、刷新时间戳、惰性清理过期）；`validate(token): boolean`（存在且未过 24h）。

**4. `apps/server/src/mobile/page.ts`（新建）**
- 导出 `renderMobilePage(): string`，单文件 HTML：
  - 结构：标题「拍照导入题目」→ 图片选择区（拍照 / 相册 / 缩略图 / 删除）→「识别题目」→ 结果区（逐题 textarea + 勾选）→ 目标选择（加入已有题组下拉 / 新建题组输入）→ 底部固定「导入 N 道题目」→ 成功态（再拍一页）
  - 样式：内联 CSS，扁平深色，复用 Focus Teal 色板（背景 `#0f1513`、面板 `#192321`、描边 `#2d3d38`、主色 `#2dd4bf`、正文 `#e8f1ee`、弱化 `#7b918a`），44px 触控高度，系统字体，数字用等宽
  - 脚本：无框架；canvas 压缩、`fetch` 调用 extract/commit（header `X-Mobile-Token`）、状态机（idle → 选图 → 识别中 → 预览 → 导入中 → 成功）、错误内联提示；403 时显示「访问凭证无效或已过期，请重新扫码」
  - 关键交互：`<input type="file" accept="image/*" capture="environment" multiple>`
  - JS 不用模板字符串/反引号，避免 TS 模板字面量转义冲突
- 导出 `renderDeniedPage(): string`（403 拒绝页）

**5. `apps/server/src/routes/mobile.ts`（新建）**
- `POST /api/mobile/link`：仅回环可调；body `{ key }`（UUID）→ `{ token, urls: string[]（带 ?t=）, preferred: string | null }`
- `GET /api/mobile/qr.svg?url=`：仅回环可调；`isAllowedQrUrl` 校验，`qrcode.toString(url, { type: "svg", margin: 1 })`
- `GET /m`：校验 query `t`，失败返回 403 `renderDeniedPage()`；成功返回 HTML，`Cache-Control: no-store`
- `GET /api/mobile/groups`：requireToken → `{ groups: [{ id, title, questionCount }] }`
- `POST /api/mobile/extract`：requireToken + `readImages` 校验 → `{ questions: string[] }`；无 API Key → 400 `INVALID_CONFIG`
- `POST /api/mobile/commit`：requireToken + target（existing/new）与 questions（1–30 条、单题 ≤40000 字、去首尾空白）校验 → `{ groupId, groupTitle, questions: Question[] }`；existing 不存在 → 404
- requireToken 从 `req.header("x-mobile-token") ?? req.query.t` 取凭证，失败 `next(HttpError(403, "UNAUTHORIZED", "访问凭证无效或已过期，请重新扫码"))`
- async 路由 try/catch + `next(toHttpError(error))`（Express 5 不自动捕获）

**6. `apps/server/src/routes/image-input.ts`（新建，抽取）**
- 从 image-import.ts 抽出 `readImages` 与常量（MAX_IMAGES=4、MAX_IMAGE_BYTES=6MB、SUPPORTED_MEDIA_TYPES）共用。

**7. [workspace-repository.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/repositories/workspace-repository.ts)**
- 新增 `importQuestions(target, contents)`：`withTransaction` → existing 则 `requireGroup`，否则 `createGroup(title || "拍照导入 M-D")` → 逐条 `createQuestion`，返回 `{ groupId, groupTitle, questions }`
- 新增 `listGroupSummaries()`（LEFT JOIN 计数，ORDER BY position/created_at），供移动端下拉使用

**8. [app.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/app.ts)**
- `express.json({ limit: "40mb" })`（全局）
- 创建 `MobileSessionStore`，挂载 `createMobileRouter(repository, settingsStore, sessions)`，在 `/api` 404 兜底与静态资源之前注册

**9. [index.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/index.ts)**
- 监听回调打印：本机地址 + 局域网手机地址（HOST 非回环时调 `getLanAddresses`，无地址提示「未检测到局域网地址」）

**10. `apps/server/package.json`**
- 新增依赖 `qrcode`，开发依赖 `@types/qrcode`

### 桌面端

**11. [api.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/web/src/lib/api.ts)**
- 新增 `getMobileLink(key)` → `POST /api/mobile/link`；二维码直接使用 `/api/mobile/qr.svg?url=...` 作为 img src

**12. `apps/web/src/features/mobile-capture/mobile-capture-dialog.tsx`（新建）**
- Dialog（约 460px）：白底二维码卡片（SVG 透明底需白底）+「手机扫码拍照导入」+ 地址行（truncate + 复制）+ 三步说明（扫码 → 拍照识别 → 选择题组）+ 安全提示（凭证 24h 有效、仅局域网）+ 无局域网地址排查提示 + loading/error 态

**13. [top-bar.tsx](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/web/src/features/workspace/top-bar.tsx)**
- 在模型设置左侧新增 `Smartphone` 图标按钮，`aria-label="手机拍照导入"`，点击打开弹窗

**14. [use-workspace.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/web/src/features/workspace/use-workspace.ts)**
- 新增状态 `mobileLinkOpen / mobileLinkLoading / mobileLinkError / mobileLinkUrls`
- `openMobileLink()`：`crypto.randomUUID()` → `api.getMobileLink`；`closeMobileLink()`
- 新增「窗口重新获得焦点/可见且距上次加载 > 3 秒时静默 `load()`」（focus + visibilitychange），使手机导入后桌面自动同步

**15. [workspace-shell.tsx](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/web/src/features/workspace/workspace-shell.tsx)**
- 挂载 `<MobileCaptureDialog workspace={workspace} />`

### 测试

**16. `apps/server/src/mobile.test.ts`（新建，node:http 假上游 + 临时库）**
- `/m`：无凭证 403 拒绝页；带凭证 200 且含「拍照导入题目」与 `capture="environment"`
- `/api/mobile/link`：非 UUID key → 400；合法 UUID → `{ token, urls, preferred }`；（CI 无局域网网卡时允许 `urls: []`）
- `groups`：无凭证 403；带凭证与种子数据一致
- `extract`：无凭证 403；成功（断言 temperature 0.1、含 image_url data URL）；未配置 Key → 400
- `commit`：无凭证 403；加入已有组题数与 position 递增；新建组标题正确；空标题回退默认名（`拍照导入 M-D`）；空数组 / 超 30 条 / 非法 target → 400；existing 不存在 → 404；写入后 `bootstrap` 可见；未注册的随机 token → 403

## 五、假设与决策

- 手机页面手写单文件，不引入 React：避免 dev/prod 资源路径差异，且移动端只需 4 个接口。
- 图片只用于识别，不落盘；落库的是识别后的文本。
- 「新建题组」在提交时创建，识别阶段不建组，避免空组残留。
- 凭证只保护 `/m` 与 `/api/mobile/*`；桌面端其余 API 仍仅本机使用（production 场景下局域网可达性是已知妥协，凭证机制把最高风险的手机入口收紧）。
- 二维码 URL 用 query `?t=` 而非 hash：hash 不随请求发送，服务端无法门禁。
- 默认 `0.0.0.0` 监听；首次监听可能触发 Windows 防火墙授权提示。
- 手机端图片上限 4 张、单张 ≤4MB（压缩后），与桌面端 6MB 规则解耦但共用 `generateQuestionsFromImages`。
- 提交批量建题使用 SQLite 事务，失败整体回滚。

## 六、验证步骤

1. 安装依赖后执行 `npm run typecheck`、`npm test`、`npm run build`。
2. `npm run dev`：确认启动日志出现 `http://<局域网IP>:3001/m`。
3. 桌面端点击手机图标：二维码正常渲染，地址可复制，关闭后无残留状态。
4. 用 CDP 移动仿真（390×844）打开带凭证 URL 走完：选图 → 识别 → 编辑/取消 → 新建题组提交 → 成功态；再验证「加入已有题组」路径；无凭证 URL 显示 403 拒绝页。
5. 验证桌面端窗口重新聚焦后出现新题组与新题目。
6. 清理：删除测试题组/题目、关闭假上游、删除临时脚本。
