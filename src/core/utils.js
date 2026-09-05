/**
 * Shared utilities used across core services.
 * Centralizes duplicated helpers so each service stays thin and testable.
 */
'use strict';

const { spawnSync } = require('child_process');

// ── String escaping ──────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&#38;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;')
    .replace(/"/g, '&#34;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlLegacy(s) {
  const E = c => String.fromCharCode(38) + '#' + c + ';';
  return String(s == null ? '' : s)
    .replace(/&/g, E(38))
    .replace(/</g, E(60))
    .replace(/>/g, E(62))
    .replace(/"/g, E(34))
    .replace(/'/g, E(39));
}

// ── Child process spawner ────────────────────────────────────────────────────
function defaultSpawnSync(cmd, args, opts) {
  opts = opts || {};
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    shell: true,
    cwd: opts.cwd || undefined
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error ? r.error.message : ''
  };
}

// ── YAML quote helpers ───────────────────────────────────────────────────────
function yamlQuote(s) {
  s = String(s == null ? '' : s);
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function yamlUnquote(s) {
  s = String(s == null ? '' : s).trim();
  if (s.length >= 2) {
    const a = s[0], b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}

// ── stripQuotes (also used by scanner for YAML front-matter values) ─────────
function stripQuotes(s) {
  s = String(s == null ? '' : s).trim();
  if (s.length >= 2) {
    const a = s[0], b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1).trim();
  }
  return s;
}

module.exports = {
  escapeHtml,
  escapeHtmlLegacy,
  defaultSpawnSync,
  yamlQuote,
  yamlUnquote,
  stripQuotes
};
