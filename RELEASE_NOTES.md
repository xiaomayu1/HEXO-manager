# Release v1.0.0 · 博客管家 Hexo Blog Manager 首个正式版

**发布日期**:2026-08-16
**平台**:Windows x64
**Electron**:43.3.0
**Node**:≥ 18（推荐 v22）

---

## 🎉 版本亮点

这是博客管家的首个正式发行版。我们把 Hexo 博客的「建站、写作、预览、部署」整条链路收进一个桌面图形界面，让不想敲命令行的同学也能轻松维护 Hexo 博客。

### 三大核心体验

- **所见即所得的本地预览** —— 应用内嵌 iframe 直接呈现渲染后的博客，启动前自动 `hexo clean` 重建产物，预览始终与当前 source 一致。
- **安全可控的配置编辑** —— 编辑 `_config.yml` / `_config.<theme>.yml` 前自动备份 `.bak`，可一键回看原版；空的主题覆盖配置会自动回填主题自带配置作起点。
- **一键到位的部署链路** —— 配置仓库地址与分支后，一条命令走完 `hexo clean → hexo generate → hexo deploy`，部署历史完整留痕。

---

## 📦 下载

| 产物 | 说明 |
|------|------|
| `HexoBlogManager.exe`（win-unpacked 目录版） | 方式一： Releases 页下载 → 解压 → 双击运行，免安装 |
| 源码构建 | 方式二： `git clone` → `npm install` → `npm run dist` |

> 本版 Windows 构建为 **可运行的目录版本**（`dir` target），运行无需管理员权限、无需联网。

---

## ✨ 全部功能

### 文章管理
- 新建 / 编辑 / 删除 / 发布 / 定时文章
- 标签、分类以 JSON 数组存储，支持 `published` / `draft` / `scheduled` 三种状态
- 按标题搜索、按状态过滤
- 软删除保留软件库记录，同时删除博客源文件
- 标题改动时自动按新标题重算文件名，删旧写新

### 写箱同步磁盘
- `draft` → `source/_drafts/<slug>.md`（hexo server 默认不渲染）
- `published` / `scheduled` → `source/_posts/<slug>.md`
- 状态切换时跨目录清理同名旧文件，不留残桩
- front-matter 与解析器对称，`draft: true` 双重保险

### 本地预览
- 一键启动 `hexo server`（默认端口 4000，可配）
- 应用内 iframe 实时呈现，支持 F11 全屏
- **启动前先 `hexo clean`** 清掉旧 `public/db.json`，再由 `hexo server` 重新生成 —— 已删除文章的孤儿生成页不再残留
- 链式防护：单次 server、重复启动拦截、停止 / 重启正确复位

### 主题与配置
- 图形化列出 / 切换主题（只改 `_config.yml` 顶层 `theme:` 行，其余字符原样保留）
- 通用配置编辑器：左侧博客根下所有 `_config*.yml` 文件清单，右侧行号编辑框 + YAML 高亮只读预览
- 保存前自动增量备份 `.bak` / `.bak.2` / `.bak.3` …，可一键载入最近备份核对（不自动覆盖原文件）
- **空的主题覆盖配置自动回填**：打开 0 字节的 `_config.<theme>.yml` 时，优先载入 `themes/<theme>/_config.yml` 作未保存草稿；主题未安装则给出清晰说明而非沉默空白

### 插件管理
- 列出已装 npm 插件（`hexo-theme-*` / `hexo-deployer-*` / `hexo-generator-*` / `hexo-renderer-*` / 其它）
- 一键安装 / 卸载
- 内置配方（recipe）可预演将写入 `_config.yml` / 主题 inject / scripts / 静态资源的内容，确认后落盘；已存在的段绝不覆盖

### 一键部署
- 配置仓库地址（repo_url）与分支
- 依次执行 `hexo clean → hexo generate → hexo deploy`
- 部署历史完整入库（成功 / 失败、输出、耗时）
- 仪表盘展示最近部署时间与状态

### 本地账户
- bcrypt 加盐的用户系统
- 注册 / 登录 / 登出 / 改密 / 资料（昵称、简介、头像）
- 记住登录（本地存储加密凭据）

### 备份与恢复
- 整个应用数据（设置、文章、部署记录）导出为 JSON 或 `.bak`
- 可一键恢复到新实例

### 界面与体验
- light / dark 两种外观，设置持久化
- 仪表盘：已发布 / 草稿 / 定时统计 + 最近活动 + 最近部署
- 全文纯前端，无外部网络依赖

---

## 🐛 本版修复的问题

### 1. 删除文章后预览仍可见
**现象**：在「文章管理」删除某篇已发布文章后，本地预览里仍能看到它。

**根因**：删除时 `source/_posts/*.md` 源文件已正确删除，但 `hexo generate` 不会清理 `public/` 里的孤儿生成页 —— `hexo server` 直接服务 `public/`，于是旧 HTML 残留、预览照旧显示。

**修复**：预览启动改为先 `hexo clean` 清掉旧 `public/db.json`，再 `hexo server` 重新生成，确保预览与当前 source 一致。clean 失败（无产物 / 未装 hexo）无害，照常启动。

**文件**：`src/core/preview.js` 的 `start()`

### 2. `_config.landscape.yml` 打开一片空白
**现象**：在「配置编辑系统」里打开 `_config.landscape.yml`，编辑框和只读预览都是空的。

**根因**：该文件在磁盘上就是 0 字节空文件（主题早已从 landscape 切到 butterfly，landscape 的空壳遗留），编辑器如实读出空白；且 `themes/landscape/` 不存在，没有主题自带配置可回填。

**修复**：
- 若 `themes/<主题>/_config.yml` 存在 → 自动回填该内容作未保存草稿（保存即写入根目录覆盖文件，符合 Hexo `_config.<theme>.yml` 约定）
- 若不存在 → 返回清晰说明而非沉默空白
- 站点 `_config.yml` 不参与回填，避免误植

**文件**：`src/main/index.js` 的 `config:read`、`src/renderer/renderer.js` 的 `loadFile`

---

## ⚠️ 已知问题

- `tests/auth.test.js` 与 `tests/posts.test.js` 中各有一处既有失败（分别与用户表 `display_name/bio` 迁移字段、同毫秒 `updated_at` 时间戳判定相关），与本版新增改动无关，按既有问题保留，详见提交历史。
- 本版未嵌入应用自定义图标（沿用 Electron 默认图标），如需自定义图标请提供 `.ico` 后联网走一次 NSIS 构建。
- 本版为 Windows 可运行目录版本，未生成单文件 NSIS 安装包；如需安装包形态，请配置 `win.target = ["nsis"]` 后联网运行 `npm run dist`（NSIS 工具链需联网下载一次）。

---

## 🔧 升级与构建说明

### 从源码构建

```bash
git clone https://github.com/xiaomayu1/Hexo-Manager.git
cd Hexo-Manager
npm install
npm run dist
# → release/win-unpacked/HexoBlogManager.exe
```

### 离线 / 沙箱环境构建

本版的构建可复用本机已安装的 `node_modules/electron/dist`，无需联网下载 Electron 二进制；NSIS 产物需联网下载 NSIS 工具链，目录版本（`dir` target）则完全离线。

### 运行

```bash
# 开发模式
npm start
```

或直接双击 `release/win-unpacked/HexoBlogManager.exe`。

---

## 📜 许可证

UNLICENSED

---

## 🙏 致谢

感谢 Hexo、Electron 以及所有开源生态的贡献者。

---

<div align="center">

**如果这个工具对你有帮助，欢迎 ⭐ Star 支持！**

[报告问题](https://github.com/xiaomayu1/Hexo-Manager/issues) · [查看源码](https://github.com/xiaomayu1/Hexo-Manager)

</div>