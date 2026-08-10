/**
 * Markdown rendering for the in-app editor preview (PRD 4.2 / Markdown editor).
 * Uses `marked`. A lightweight sanitizer strips <script>, inline on* handlers
 * and javascript:/vbscript: URLs so author-entered Markdown is safe to show
 * inside the desktop app's preview pane.
 */
'use strict';

const { marked } = require('marked');

function stripDangerous(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/(<[^>]+?)(\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))/gi, '$1')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript):/gi, '$1=$2#blocked:');
}

function renderMarkdown(md, opts) {
  opts = opts || {};
  const html = marked.parse(md || '', opts.markedOptions || {});
  return opts.sanitize === false ? String(html) : stripDangerous(html);
}

module.exports = { renderMarkdown, stripDangerous };
