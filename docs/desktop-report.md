# Motive Studio 桌面化最终报告

> 分支：`feat/electron-desktop` · 完成日期：2026-11-01 · 状态：全部完成

## 1. 概述

将 Motive Studio（npm workspaces Monorepo：React 19 + Vite 8 前端 / Express 5 + `node:sqlite` 后端）包装为 Windows 桌面应用。桌面版与 Web 版共享全部业务代码，Electron 仅承担运行环境与生命周期管理；服务端运行于 Electron Utility Process，渲染进程经同源 HTTP 访问，不暴露任何 Node API。

技术选型：**Electron 45.2.1**（内置 Node 24.22.1，原生支持 `node:sqlite`，无需原生模块编译）+ **esbuild**（服务端自包含 bundle）+ **electron-builder 26.18.0**（NSIS + Portable）。

## 2. 提交清单（feat/electron-desktop 分支，共 7 个提交）

| 提交 | 内容 |
| --- | --- |
| `dbd41e5` | feat(desktop): add electron runtime verification —— P0 运行时验证 |
| `1571762` | feat(server): add desktop server entry with isolated mobile listener —— 桌面服务端入口 + 隔离移动监听器 |
| `e18f5ec` | feat(desktop): add electron application shell —— 主进程窗口壳 |
| `968a038` | feat(desktop): add utility process server management and dev orchestration —— bundle 构建 + 开发编排 |
| `c17cd6e` | fix(desktop): correct message envelope, userData path and process cleanup —— 验证中三个根因修复 |
| `74c3c6b` | build(desktop): add desktop packaging configuration —— 打包配置 + 图标 |
| `eac7648` | feat(desktop): support custom installation path in NSIS installer —— 向导式安装，可选安装路径 |
| （本次） | docs(desktop): document desktop development and deployment —— README + 本报告 |

## 3. 修改文件清单与目的

### 服务端（apps/server，向后兼容，不改 index.ts / API 协议 / 数据模型）

| 文件 | 改动与目的 |
| --- | --- |
| `src/desktop.ts`（新增） | 桌面服务端入口 `startDesktopServer`：主 API 硬编码绑定 127.0.0.1、端口 0 动态分配（`MOTIVE_PORT` 可指定、占用即报错）、dataDir 注入、`LanListenerManager`（懒启动 / 30 分钟空闲自停 / 在途保护 / 会话清理 / 幂等关闭）、按条款顺序的优雅关闭 |
| `src/services/mobile-runtime.ts`（新增） | `MobileRuntime` 接口：路由层不感知 Electron |
| `src/services/mobile-session.ts` | +`clearAll()`：LAN 监听关闭后使旧二维码失效 |
| `src/services/lan.ts` | `isAllowedQrUrl` 支持端口数组（放行移动监听端口） |
| `src/config.ts` | `MOTIVE_WEB_DIST` 环境变量覆盖（3 行） |
| `src/app.ts` | `CreateAppOptions.mobileRuntime` 透传；locals 暴露 assetStore/mobileSessions（共享实例，不重复初始化） |
| `src/routes/mobile.ts` | 可选 runtime 钩子：link 懒启动 LAN 监听并以其端口生成二维码 URL；配对/凭证校验通过后刷新空闲计时；Web 版不传参行为不变 |
| `src/desktop.test.ts`（新增） | 16 个验收用例（回环绑定/懒启动/端口分离/权限隔离/Token 拒绝/完整导入/空闲计时语义/在途保护/自动关闭/旧码失效/同步关闭/幂等关闭/端口占用报错/持久化） |

### 桌面壳（apps/desktop，新 workspace @motive/desktop）

| 文件 | 目的 |
| --- | --- |
| `main/main.mjs` | 主进程：单实例锁、userData 显式定位（%APPDATA%/Motive Studio）、文件日志、Utility Process 管理（ready/error/shutdown 协议 + 健康检查）、安全窗口（sandbox + contextIsolation、外链转系统浏览器、拦截跨源导航）、优雅退出链、资源缺失明确报错 |
| `main/server-entry.mjs` | Utility Process 侧运行器：动态加载 bundle、协议封装、优雅关闭（消息信封 `message.data` 解包） |
| `scripts/verify-runtime.mjs` + `main/verify-utility*.cjs` | P0 运行时验证：Node 版本、双进程 node:sqlite 全周期、Utility Process 通信/异常/超时场景 |
| `scripts/build-server.mjs` | esbuild 自包含 bundle（createRequire shim 解决 CJS 互操作）、构建前清理旧产物 |
| `scripts/check-dist-inputs.mjs` | 打包前 5 项输入完整性校验，缺失即非零退出 |
| `scripts/make-icon.mjs` | 品牌图标转换：六尺寸透明 PNG → ICO（256 嵌 PNG、≤48 为 32bpp BMP），双自检 + 原子替换，输出稳定 |
| `scripts/dev.mjs` | 桌面开发编排：HTTP 健康探测、复用/半启动检测、taskkill 整树终止（await 完成） |
| `electron-builder.yml` | NSIS（向导式安装、`allowToChangeInstallationDirectory` 可选安装路径、per-user、卸载保留数据）+ Portable；asar 布局：壳进 asar、服务端/web 走 extraResources |
| `package.json` | 依赖精确锁定（electron 45.2.1 / electron-builder 26.18.0 / @resvg/resvg-js 2.6.2 / esbuild 0.28.2）+ 六个脚本 |

### 根目录

| 文件 | 目的 |
| --- | --- |
| `package.json` | `dev:desktop` / `build:desktop`（先 web 后 server）/ `dist:desktop` 脚本；allowScripts 白名单 |
| `.gitignore` | +`apps/desktop/release/` |
| `README.md` | 「桌面应用」章节（开发打包/运行形态/数据目录/专属行为/镜像变量）；目录结构补 apps/desktop |
| `docs/desktop-report.md` | 本报告 |

## 4. 验证结果汇总

### P0 运行时验证（全部 PASS，退出码 0）

Electron 45.2.1 内置 Node 24.22.1（≥22.13）；主进程与 Utility Process 的 `node:sqlite` 建表/写入/读取/关闭（WAL）均通过；`utilityProcess.fork` 通信、异常退出检测、启动失败检测、超时强制清理全部通过。

### 自动化测试

- `npm run typecheck`：0 错误
- `npm run test`：web **6/6** · server **118/118**（含新增桌面 16 用例；证明 Web 版行为无回归）

### 服务端冒烟（系统 Node 24 + tsx / esbuild bundle）

- `startDesktopServer`：health/bootstrap 200、持久化重启保留、优雅关闭、`MOTIVE_PORT` 占用明确报错
- netstat 实证：主 API 仅 `127.0.0.1` 监听；LAN 监听未触发时无 0.0.0.0 端口

### Electron 运行验证

- **开发模式**：dev 编排（就绪检测/复用检测）→ 窗口加载 5173 → 优雅退出零残留
- **生产模式**（暂存目录 + 打包产物两种形态）：动态端口 127.0.0.1 绑定、健康检查、单实例锁（二次启动自退 exit 0）、窗口加载、`%APPDATA%/Motive Studio/motive.db` 落位、完整优雅关闭链（shutdown → 停收连接 → 5s 强制清理半关闭 keep-alive → Server 关闭 → exit 0）

### 打包产物验证

- app.asar 13.9KB 仅含壳（main.mjs + package.json，无服务端/Web 资源重复）；resources/ 布局与约束一致（server.mjs / server.mjs.map / server-entry.mjs / web/）
- **Portable（112MB）**：非项目工作目录启动正常；创建数据 → 优雅退出 → 删除并替换 EXE → 数据完整可读；资源缺失明确报错不回退；退出零残留
- **NSIS（123MB）**：`/S` 静默安装成功；与 Portable 共用同一 userData（数据指纹一致）
- **升级**：0.1.0 → 覆盖安装 0.1.1（临时构建）→ 数据完整保留；版本号已还原 0.1.0，release/ 仅含交付版本
- **卸载**：`/S` 卸载 → 程序目录与开始菜单快捷方式移除、**userData 完整保留**；已重装 0.1.0 为最终交付态
- **图标**：ICO 六条目（256/128/64/48/32/16）自检通过，256 为 PNG 编码，两次生成 md5 一致

### 手机导入桌面安全模型（API 级实测）

| 检查 | 结果 |
| --- | --- |
| 点击「手机拍照」（POST /api/mobile/link，回环）后 LAN 监听懒启动 | ✓ 独立端口 0.0.0.0 绑定 |
| 移动页经 LAN IP 访问（带配对 Token） | ✓ 200 |
| 完整 API / 设置接口经 LAN 访问移动监听端口 | ✓ 404（结构性隔离） |
| 主 API 端口经 LAN IP 访问 | ✓ 连接拒绝（仅 127.0.0.1） |
| 无 Token 移动接口 | ✓ 403 |
| 应用退出后 LAN 监听与端口 | ✓ 全部释放 |

### 全量验收清单核对（规范 §15）

六大类逐项核对：基础运行 / 服务端 / 前端 / 安全 / 数据 / 打包 / 兼容性 —— 除下述「遗留问题」中注明项外全部通过（各单项证据见上文对应小节）。

## 5. 构建环境

Windows x64（win32）· Node v24.20.0 · Electron 45.2.1 · electron-builder 26.18.0 · esbuild 0.28.2。
镜像经外部环境变量注入（`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` / `NODE_OPTIONS=--use-system-ca`），不写入仓库。

## 6. 交付物路径

- NSIS 安装版：`apps/desktop/release/Motive Studio Setup 0.1.0.exe`（123 MB）
- Portable 便携版：`apps/desktop/release/Motive Studio 0.1.0.exe`（112 MB）
- 本机已安装 0.1.0 交付版（`%LOCALAPPDATA%\Programs\@motivedesktop`），userData 已重置为种子状态

## 7. 遗留问题与后续建议

1. **代码签名未配置**：首次运行可能触发 SmartScreen/未知发布者提示；建议后续接入代码签名证书（electron-builder `win.certificateFile` 或 Azure Trusted Signing）。
2. **自动更新未实现**：后续可引入 electron-updater（blockmap 已随 NSIS 产出，具备接入条件）。
3. **手机导入手动关闭**：当前为 30 分钟空闲自动关闭 + 退出必关；「立即关闭」按钮需在 Web UI 增加入口（本次未改 UI）。
4. **配对 Token 有效期 24 小时**：沿用现有 Web 行为（内存态、重启失效）；如需收紧可调整 `SESSION_TTL_MS`。
5. **AI 真实生成**：链路由既有测试覆盖（SSE 流式/中断/错误映射），真实生成需在设置页配置模型服务后使用，未做端到端 AI 内容验收。
6. **Windows 防火墙**：首次启动局域网监听时系统会弹出放行提示，属预期行为。
7. **安装目录名** `@motivedesktop` 取自包名（productName 为 Motive Studio）；如需目录名与产品名一致，可在 electron-builder 配置中调整 `nsis.shortcutName`/`artifactName`。
8. **验证期间发现并修复的三个关键问题**（均已修复并回归）：Utility Process 消息信封 `{data}` 包装、`app.setName()` 不移动 userData 路径、Chromium 半关闭 keep-alive 连接导致 `server.close()` 永不回调（强制定时器不可 unref）。
