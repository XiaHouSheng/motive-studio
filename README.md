<div align="center">

<img src="https://api.iconify.design/lucide/brain-circuit.svg?color=%23f97316" width="72" alt="Motive Studio Logo" />

# Motive Studio

**本地优先的 AI 结构化思考工作台**

拍照收集题目，AI 分步解题、陪你讨论、沉淀归档 —— 数据全部保存在你自己的电脑上。

![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-20232A?style=flat-square&logo=typescript&logoColor=3178C6)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-5-20232A?style=flat-square&logo=zustand&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node:sqlite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-5-729B1B?style=flat-square&logo=vitest&logoColor=white)

</div>

## ✨ 功能特性

| 图标 | 功能 | 说明 |
| :---: | --- | --- |
| <img src="https://api.iconify.design/lucide/camera.svg?color=%23f97316" width="20" /> | **拍照添加题目** | 手机扫码进入拍照页随手拍，桌面端支持粘贴 / 选择图片，AI 自动结构化导入为题目 |
| <img src="https://api.iconify.design/lucide/crop.svg?color=%2314b8a6" width="20" /> | **裁剪编辑器** | 选图后可框选区域再识别：拖动移动、八向手柄缩放、三分构图线，鼠标与触控统一支持 |
| <img src="https://api.iconify.design/lucide/brain.svg?color=%23a855f7" width="20" /> | **AI 分步解题** | 逐步生成解题步骤，SSE 流式输出实时呈现思考过程，支持修订并保留历史版本 |
| <img src="https://api.iconify.design/lucide/sigma.svg?color=%233b82f6" width="20" /> | **数学公式渲染** | 基于 KaTeX 完整渲染 LaTeX 公式，理科题目排版不失真 |
| <img src="https://api.iconify.design/lucide/messages-square.svg?color=%230ea5e9" width="20" /> | **讨论面板** | 围绕当前题目与 AI 追问对话，携带上下文，随时回到题目本身 |
| <img src="https://api.iconify.design/lucide/archive.svg?color=%23f59e0b" width="20" /> | **AI 归档整理** | 解完的题目自动提炼要点、生成归档建议，确认后入库沉淀 |
| <img src="https://api.iconify.design/lucide/file-down.svg?color=%2322c55e" width="20" /> | **Markdown 导出** | 题目与解题过程一键导出为 Markdown，方便二次编辑与分享 |
| <img src="https://api.iconify.design/lucide/scan-line.svg?color=%2306b6d4" width="20" /> | **扫码配对** | 桌面端展示二维码，手机扫码直连局域网服务，回环校验防止服务暴露到公网 |
| <img src="https://api.iconify.design/lucide/shield-check.svg?color=%2310b981" width="20" /> | **密钥安全存储** | API Key 走操作系统级凭据保护（DPAPI / Keychain / Secret Service），明文永不回传 |
| <img src="https://api.iconify.design/lucide/key-round.svg?color=%23f43f5e" width="20" /> | **密钥脱敏查看** | 设置面板可查看已保存密钥的掩码预览（前 3 位 + 末 4 位）与保存时间，认得出、看不见 |
| <img src="https://api.iconify.design/lucide/palette.svg?color=%238b5cf6" width="20" /> | **明暗主题** | 亮 / 暗主题一键切换，偏好本地记忆 |

## 🧰 技术栈

Monorepo（npm workspaces），三端共享一套 TypeScript 类型定义。

| 分层 | 技术 | 说明 |
| --- | --- | --- |
| 前端 `apps/web` | React 19 · Vite 8 · Tailwind CSS v4 · Zustand · lucide-react | 单页工作台，SSE 流式渲染，KaTeX 公式支持 |
| 后端 `apps/server` | Express 5 · node:sqlite · tsx | 零外部数据库：单文件 SQLite + 本地上传目录 |
| 共享 `packages/shared` | TypeScript | 领域类型、SSE 协议契约，前后端同源引用 |

## 📱 手机拍照流程

<div align="left">

1. <img src="https://api.iconify.design/lucide/qr-code.svg?color=%2306b6d4" width="16" /> 桌面端点击「手机拍照」，展示局域网配对二维码
2. <img src="https://api.iconify.design/lucide/smartphone.svg?color=%2306b6d4" width="16" /> 手机扫码进入拍照页，一次配对、会话内有效
3. <img src="https://api.iconify.design/lucide/camera.svg?color=%23f97316" width="16" /> 拍照 / 选图，自动压缩，最多 6 张
4. <img src="https://api.iconify.design/lucide/crop.svg?color=%2314b8a6" width="16" /> 点击缩略图进入裁剪编辑器，框选题目区域后替换原图
5. <img src="https://api.iconify.design/lucide/sparkles.svg?color=%23a855f7" width="16" /> 提交到桌面端，AI 识别题目内容并结构化入题库

</div>

## 🔐 密钥与安全

- API Key 保存在操作系统级凭据库：**Windows DPAPI** / **macOS Keychain** / **Linux Secret Service**；不可用时回退为本地 **AES-256-GCM 加密文件**（随机 Master Key，不出现在任何响应中）
- 所有 API 响应、备份文件、日志均**不含明文密钥**；设置面板只提供脱敏预览与保存时间
- 手机拍照页仅限局域网访问，服务器启动时做回环校验，避免被公网代理转发
- 应用完全本地运行：题目、图片、归档与密钥都不离开你的电脑

## 🚀 快速开始

**环境要求**：Node.js **≥ 24**（使用内置 `node:sqlite`，无需安装数据库）

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（同时启动 web + server）
npm run dev
# 前端  http://localhost:5173
# API   http://localhost:3001 （Vite 已代理 /api）

# 3. 生产模式
npm run build
npm start
# 访问 http://localhost:3001
```

首次使用：打开 **设置 → 模型服务**，填入 OpenAI 兼容服务的 Base URL、模型名与 API Key（保存后即走系统凭据加密）。

### 常用脚本

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动前端（5173）与后端（3001），热更新 |
| `npm run build` | 构建前端产物（含 tsc 类型检查） |
| `npm start` | 生产模式，后端直接托管前端静态资源 |
| `npm run typecheck` | 全仓 TypeScript 类型检查 |
| `npm run test` | 运行全部单元测试（vitest） |

## 📁 目录结构

```
motive-studio/
├─ apps/
│  ├─ web/                  # React 前端工作台
│  │  └─ src/features/      # 题组 · 解题 · 讨论 · 归档 · 设置 · 主题
│  └─ server/               # Express API 服务
│     └─ src/
│        ├─ routes/         # 题目 · 解题 · 图片 · 手机 · 设置 · 导出
│        ├─ services/       # AI 生成器 · 凭据存储 · 归档 · 移动会话
│        └─ mobile/page.ts  # 手机拍照页（单文件，扫码即用）
├─ packages/shared/         # 前后端共享类型与 SSE 协议
├─ scripts/                 # dev / start 启动脚本
└─ data/                    # 运行时生成：SQLite 数据库、上传图片、加密凭据
```

## 🧪 测试

```bash
npm run typecheck
npm run test
```

覆盖凭据存储（DPAPI / Keychain / Secret Service / 加密文件、脱敏视图）、SSE 解析、解题 / 归档 / 图片导入生成、备份等核心链路。

## 🙏 图标与致谢

- 界面与本文档图标来自 [Lucide](https://lucide.dev)（通过 [Iconify](https://iconify.design) 提供 SVG 服务）
- 技术栈徽章由 [Shields.io](https://shields.io) 渲染
