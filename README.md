<div align="center">
  <img width="120" alt="XiaoLou Logo" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
  <h1>XiaoLou — AI 创作平台</h1>
  <p>AI 图片 · 视频 · 画布创作一体化，支持 Seedance / PixVerse / Kling / Grok 多模型</p>

  ![Node](https://img.shields.io/badge/Node.js-22.5%2B-brightgreen)
  ![License](https://img.shields.io/badge/license-MIT-blue)
</div>

---

## ✨ 功能

| 功能 | 路径 | 说明 |
|------|------|------|
| 图片创作 | `/create/image` | 文生图 / 图生图，多模型路由 |
| 视频创作 | `/create/video` | 文生视频 / 图生视频 / 首尾帧生成 |
| 画布创作 | `/create/canvas` | 节点式 AI 画布，直接内嵌主项目 |
| 资产管理 | `/assets` | 生成记录、项目存档 |
| Playground | `/playground` | 对话式 AI（可选，需 Docker） |

---

## 🏗 项目结构

```
XIAOLOU-main/    前端  React + Vite        → 端口 3000
core-api/        后端  Node.js + SQLite     → 端口 4100
scripts/         启动脚本 (Windows .cmd)
docs/            本地部署文档（不进 git）
```

---

## 🚀 快速开始

**环境要求：** Node.js ≥ 22.5，npm ≥ 9

```bash
# 1. 安装依赖
cd core-api && npm install
cd ../XIAOLOU-main && npm install

# 2. 配置 API Key
cp core-api/.env.example core-api/.env.local
# 编辑 core-api/.env.local，填入 YUNWU_API_KEY

# 3. 启动（两个终端）
cd core-api    && npm run dev   # → http://127.0.0.1:4100
cd XIAOLOU-main && npm run dev  # → http://127.0.0.1:3000
```

Windows 一键启动：双击 `scripts\start_xiaolou_stack.cmd`

---

## ⚙️ 环境变量

| 文件 | 关键变量 | 说明 |
|------|---------|------|
| `core-api/.env.local` | `YUNWU_API_KEY` | 图片 / 视频生成（必填） |
| `core-api/.env.local` | `VOLCENGINE_ARK_API_KEY` | Seedance 2.0 视频（可选） |
| `XIAOLOU-main/.env.local` | `VITE_CORE_API_BASE_URL` | 公网部署时改为域名（可选） |

复制对应 `.env.example` 后填写，真实 key 不进 git。

---

## 🗂 技术栈

**前端**
- React 18 + TypeScript + Vite
- Tailwind CSS + Framer Motion
- 画布：自研节点系统，内嵌于 `src/canvas/`

**后端**
- Node.js（无外部框架依赖）
- SQLite（Node 内置 `node:sqlite`）
- 多模型路由：Yunwu · Volcengine Ark · PixVerse

---

## 📦 可选：Playground / Open WebUI

需要 Docker。复制 `scripts/openwebui.env.example` → `scripts/openwebui.env.local`，填入 API Key 后运行 `scripts\start_openwebui.cmd`。

> Playground 目前处于开发初期，不是核心功能的主要承诺。

---

## 📄 License

MIT
