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
 *
 * Only verified recipes are shipped here. Do NOT add a recipe whose `scripts`/
 * `assets`/`inject` body you cannot verify against the plugin's real README —
 * the whole point of this table is to keep the user away from guessing.
 */
const RECIPES = {
  'hexo-generator-search': {
    label: '本地搜索',
    desc: '为博客生成 search.xml，配合主题搜索框使用。',
    config: '\nsearch:\n  path: search.xml\n  field: post\n  content: true\n  format: html\n',
    note: '会在博客根 _config.yml 追加 search: 段。'
  },
  'hexo-generator-searchdb': {
    label: '本地搜索（searchdb）',
    desc: '为博客生成 search.xml（searchdb 版本），配合主题搜索框使用。',
    config: '\nsearch:\n  path: search.xml\n  field: post\n  content: true\n  format: html\n',
    note: '会在博客根 _config.yml 追加 search: 段。'
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
