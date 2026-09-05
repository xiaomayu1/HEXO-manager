'use strict';

/**
 * Plugin configuration recipes (交接文档 §2.1A 的扩展).
 *
 * A recipe describes what a Hexo plugin needs that `npm install` alone does
 * NOT set up, so a GUI user can wire the plugin without hand-editing YAML or
 * touching theme source. Everything lands in the blog root — never inside the
 * theme package — so a theme upgrade never wipes the wiring (交接 §四 红线).
 *
 * Each recipe is keyed by the npm package name (as it appears in
 * `package.json` dependencies) and may carry any of these fields:
 *
 *   label   {string}      short UI label
 *   desc    {string}      one-line explanation shown in the config modal
 *   config  {string}      YAML text to merge into blog `_config.yml`
 *                         (only top-level keys missing from the file are
 *                          appended; existing sections are skipped, never
 *                          overwritten — 安全红线).
 *   permalink {string}    if set, the recipe actively manages the blog
 *                         `permalink:` line (shown in the preview so the user
 *                         explicitly confirms; the write is backed up). Used
 *                         by plugins like hexo-abbrlink that only take effect
 *                         with a matching permalink.
 *   scripts {Array<{file:string, body:string}>}
 *                         Node files written to blog `scripts/`. Hexo loads
 *                         every `scripts/*.js` at startup with access to the
 *                         `hexo` instance, so a recipe can register tags /
 *                         filters / helpers WITHOUT editing theme templates.
 *                         ⚠ these run as real Node code at `hexo generate`.
 *   assets  {Array<{file:string, body:string}>}
 *                         static files written under blog `source/` (e.g.
 *                         `js/foo.js`). Not auto-included anywhere — pair with
 *                         `inject` so a theme that exposes an inject hook can
 *                         load the asset on every page.
 *   inject  {Object<string,string[]>}   e.g. { head: ['<script src="/js/foo.js"></script>'] }
 *                         merged into `_config.<theme>.yml`'s `inject:` block
 *                         (Butterfly-style `inject.head` / `inject.bottom`).
 *                         Already-present items are skipped; absent keys are
 *                         created. If there is no theme config the file is
 *                         created with a minimal inject block.
 *   supportedThemes {string[]}            theme names that support this inject style.
 *                         If omitted, any theme is assumed compatible.
 *                         When the active theme is NOT in this list, a warning is
 *                         shown in the preview instead of silently applying.
 *   themeConfig {Object<string, string>}  YAML text to merge into _config.<theme>.yml
 *                         (not _config.yml). Keys match top-level config keys.
 *                         Used when a plugin needs theme-specific settings (e.g.
 *                         Butterfly's search.use field). Only applies to listed themes.
 *
 * Only verified recipes are shipped here. Do NOT add a recipe whose `scripts`/
 * `assets`/`inject` body you cannot verify against the plugin's real README —
 * the whole point of this table is to keep the user away from guessing.
 */
const RECIPES = {
  'hexo-generator-search': {
    label: '本地搜索（generator-search）',
    desc: '生成 search.xml，配合主题的本地搜索功能使用。',
    config: '\nsearch:\n  path: search.xml\n  field: post\n  content: true\n  format: html\n',
    themeConfig: {
      butterfly: '\nsearch:\n  use: local_search\n',
    },
    supportedThemes: ['butterfly', 'volantis', 'next', 'redefine', 'fluid', 'melody', 'matery'],
    note: '写入博客根 _config.yml 的 search: 段，并在 Butterfly 主题配置中启用本地搜索。'
  },
  'hexo-generator-searchdb': {
    label: '本地搜索（searchdb）',
    desc: '生成 search.xml（searchdb 版本），性能更好，支持全文检索。',
    config: '\nsearch:\n  path: search.xml\n  field: post\n  content: true\n  format: html\n',
    supportedThemes: ['butterfly', 'volantis', 'next', 'redefine', 'fluid', 'melody', 'matery'],
    note: '写入 _config.yml 的 search: 段。若使用 Butterfly 主题，还需在主题配置 _config.butterfly.yml 中设置 search.use: local_search，否则搜索框不会显示。'
  },
  'hexo-abbrlink': {
    label: '永久链接',
    desc: '文章生成固定 abbrlink，避免改链接后失效。',
    config: '\nabbrlink:\n  alg: crc32\n  rep: hex\n',
    permalink: 'posts/:abbrlink/',
    note: '会把 _config.yml 的 permalink 改为 posts/:abbrlink/，否则插件不生效。'
  },
  'hexo-filter-nofollow': {
    label: 'SEO 外链',
    desc: '给外链加 rel="nofollow"，提升站内权重。',
    config: '\nnofollow:\n  enable: true\n  field: site\n  exclude:\n    - example.com\n    - github.com\n',
    note: '会在博客根 _config.yml 追加 nofollow: 段。'
  },
  'hexo-wordcount': {
    label: '字数统计',
    desc: '在页面底部显示文章字数和阅读时长，需主题支持 inject。',
    inject: {
      bottom: [
        '<span class="post-wordcount">本文约 {{ wordcount }} 字 | 预计阅读 {{ min_reading }} 分钟</span>'
      ]
    },
    supportedThemes: ['butterfly', 'volantis', 'next', 'redefine', 'fluid', 'melody', 'matery'],
    note: '会在主题配置 _config.<theme>.yml 的 inject.bottom 追加字数统计元素。当前主题需支持 inject 注入点才能生效（Butterfly/Volantis/Next/Redefine/Fluid/Melody/Matery）。'
  },
  'hexo-generator-feed': {
    label: 'RSS 订阅',
    desc: '为博客生成 RSS/Atom 订阅源，需在头部注入链接。',
    config: '\nfeed:\n  type: atom\n  path: atom.xml\n  limit: 20\n  hub:\n  content:\n',
    inject: {
      head: [
        '<link rel="alternate" href="/atom.xml" title="RSS 订阅" type="application/atom+xml">'
      ]
    },
    supportedThemes: ['butterfly', 'volantis', 'next', 'redefine', 'fluid', 'melody', 'matery'],
    note: '会在 _config.yml 追加 feed: 段，并在主题配置 inject.head 添加 RSS 链接。'
  },
  'hexo-generator-sitemap': {
    label: '站点地图',
    desc: '生成 sitemap.xml，提交给搜索引擎收录。',
    config: '\nsitemap:\n  path: sitemap.xml\n',
    supportedThemes: [],  // 纯配置，不依赖主题
    note: '会在博客根 _config.yml 追加 sitemap: 段。'
  }
};

function recipeFor(pkg) {
  if (!pkg) return null;
  return RECIPES[pkg] || null;
}

function listRecipePackages() {
  return Object.keys(RECIPES);
}

module.exports = { RECIPES, recipeFor, listRecipePackages };
