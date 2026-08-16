[README.md](https://github.com/user-attachments/files/31117221/README.md)
# 博客管家 · Hexo Blog Manager

> 一个用 Electron 打造的 **Hexo 博客桌面管理工具** —— 把建站、写作、预览、部署收进一个图形界面，告别反复敲命令行。

<div align="center">

![Electron](https://img.shields.io/badge/Electron-43.3.0-47848F?logo=electron&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-blue?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)
![Version](https://img.shields.io/badge/version-1.0.0-green)

</div>

---

## ✨ 特性一览

| 模块 | 能力 |
|------|------|
| 📝 **文章管理** | 新建 / 编辑 / 删除 / 发布 / 定时；标签与分类以 JSON 数组存储，支持 published / draft / scheduled 三种状态 |
| 👁️ **本地预览** | 一键启动 hexo server，应用内 iframe 实时呈现渲染效果；启动前自动 hexo clean 重建产物，**已删除文章不再残留** |
| 🎨 **主题与配置** | 图形化切换主题；内置通用配置编辑器，编辑 _config.yml 与 _config.<theme>.yml，保存前自动备份 .bak，可一键回看；**空的主题覆盖配置会自动回填主题自带配置** |
| 🧩 **插件管理** | 列出已装 npm 插件，一键安装 / 卸载；内置配方（recipe）可预演将写入的内容，确认后再落盘 |
| 🚀 **一键部署** | 配置仓库地址与分支，依次执行 hexo clean → hexo generate → hexo deploy，部署历史完整留痕 |
| 🔐 **本地账户** | bcrypt 加盐的本地用户系统，登录 / 注册 / 改密 / 资料 |
| 💾 **备份恢复** | 整个应用数据（设置、文章、部署记录）导出为 JSON / .bak，可一键恢复到新实例 |
| 🌗 **深浅主题** | 应用本身支持 light / dark 两种外观 |

---

## 🖼️ 截图

> 安装运行后可自行补充以下画面：
> - 文章管理列表
> - 配置编辑器（左侧文件清单 + 右侧行号编辑 + YAML 高亮只读预览）
> - 内嵌预览 iframe
> - 部署面板与历史

---

## 🚀 快速开始

### 方式一：下载安装包（推荐普通用户）

前往 [Releases](https://github.com/xiaomayu1/Hexo-Manager/releases) 下载最新的 Windows 安装包，解压后运行 HexoBlogManager.exe 即可。

首次启动请在 **设置 → 博客本地路径** 里指向你的 Hexo 博客根目录。

### 方式二：从源码构建

**前置要求**
- Node.js ≥ 18（推荐 v22）
- npm ≥ 10
- Git
- 本机已安装 Hexo CLI（npm i -g hexo-cli）与一个可用的 Hexo 博客目录

```bash
# 克隆仓库
git clone https://github.com/xiaomayu1/Hexo-Manager.git
cd Hexo-Manager

# 安装依赖
npm install

# 开发模式运行
npm start

# 打包（Windows，默认 NSIS 安装包）
npm run dist
# → 产物输出到 release/ 目录
```

> 构建可复用本机已安装的 Electron 二进制，沙箱 / 无网环境也能生成可运行的目录版本。

---

## 🧭 使用流程

```
启动应用 → 设置博客路径 → [导入已有文章] → 新建/编辑文章 → 本地预览 → 一键部署
```

1. **设置博客路径**：指向你本地 Hexo 博客根目录（含 _config.yml、source/）。
2. **导入文章**：进入「文章管理 → 从博客导入」，扫描 source/_posts/*.md 入库（同名跳过）。
3. **写作**：「文章管理 → ＋ 新建文章」，填标题、标签、分类、状态、正文，保存即按 Hexo 格式同步写盘：
   - draft → source/_drafts/<slug>.md（默认不渲染）
   - published / scheduled → source/_posts/<slug>.md
4. **预览**：进入「本地预览 → 启动预览」，先 hexo clean 再 hexo server，iframe 自动加载。
5. **部署**：进入「部署发布」，填仓库地址与分支，点「一键部署」即走 clean → generate → deploy。

---

## 🏗️ 技术架构

```
src/
├─ main/           Electron 主进程（IPC 路由、窗口、预览子进程）
│  ├─ index.js
│  └─ preload.js
├─ renderer/       渲染进程（纯 HTML/CSS/JS，无前端框架）
│  ├─ index.html
│  ├─ renderer.js
│  └─ styles.css
└─ core/           纯 Node 业务层（可独立单测，不依赖 Electron）
   ├─ app.js        服务编排
   ├─ db.js         node:sqlite 数据层
   ├─ posts.js      文章 CRUD + 状态过滤 + 搜索
   ├─ syncHexo.js   Hexo 文件同步（写盘/删盘 + front-matter）
   ├─ scanner.js    导入已有 .md 文章
   ├─ preview.js    hexo server 子进程管理
   ├─ themes.js     主题切换 / 配置读写 / 插件配方
   ├─ deploy.js     hexo deploy 链路
   ├─ backup.js     导出/恢复
   ├─ auth.js       本地账户
   ├─ env.js        环境探测（node/hexo/git）
   └─ ...
```

**数据存储**：node:sqlite（Node 内置，无需原生编译），数据库置于 Electron userData 目录。

**IPC 设计**：主进程用 ipcMain.handle 把请求委托给纯 Node 的 core/ 服务；spawn / fs 等副作用均可注入，便于 Jest 单测。

**测试**：npm test 跑 Jest，核心服务（posts / scanner / syncHexo / themes / deploy / auth / backup 等）均有覆盖。

---

## 🐛 已知问题与修复记录

- ✅ **删除文章后预览仍可见**：根因是 hexo generate 不会清理 public/ 里的孤儿生成页。修复为预览启动前先 hexo clean 重建产物。
- ✅ **_config.landscape.yml 打开全白**：根因是该文件在磁盘上为 0 字节且主题已切到 butterfly。修复为空的主题覆盖配置优先回填 themes/<theme>/_config.yml，无则给出清晰说明。
- ⚠️ auth.test 与 posts.test 中各有一处既有失败（与用户表迁移字段、同毫秒时间戳相关），非本次改动引入。

---

## 🤝 贡献

欢迎 Issue 与 PR。提 PR 前请确保：

- npm test 全绿（或明确说明无法通过的既有用例）
- node --check 对改动文件语法通过
- 遵循现有代码风格（无前端框架、纯函数 + 注入副作用）

---

## 📜 许可证

UNLICENSED（暂不开源授权，可按需自行调整）。

---

<div align="center">

**如果这个工具对你有帮助，欢迎 ⭐ Star 支持！**

</div>
