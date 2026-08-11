'use strict';

/**
 * 极简 YAML 着色 —— 仅供通用 _config.yml 编辑器的「左只读高亮」展示
 * （交接文档 §2.2）。纯函数、无 DOM 依赖，可直接单测。
 *
 * 安全策略：先把每一行做 HTML 转义，再按 token 包 <span>，杜绝把用户写进
 * _config.yml 的尖括号当成标签注入到 DOM。着色规则刻意保守：
 *   - 整行注释（前导空白后以 # 开头）→ .yml-comment
 *   - 形如 ^\s*name: 的键名 → .yml-key（仅着色键名，值保持默认色）
 *   - 列表项「- 」「- key:」不误判为键；其余原样展示
 * 这不是 YAML 解析器，只用于可视化提示，绝不参与读/写判定。
 */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&#38;').replace(/</g, '&#60;').replace(/>/g, '&#62;')
    .replace(/"/g, '&#34;').replace(/'/g, '&#39;');
}

function highlightYaml(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const keyRe = /^(\s*)([A-Za-z0-9_.\-]+)(\s*:)(.*)$/;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') { out.push(''); continue; }
    if (/^\s*#/.test(line)) { out.push('<span class="yml-comment">' + escapeHtml(line) + '</span>'); continue; }
    const m = keyRe.exec(line);
    if (m) {
      out.push(escapeHtml(m[1]) + '<span class="yml-key">' + escapeHtml(m[2]) + '</span>' + escapeHtml(m[3]) + escapeHtml(m[4]));
      continue;
    }
    out.push(escapeHtml(line));
  }
  return out.join('\n');
}

module.exports = { highlightYaml, escapeHtml };