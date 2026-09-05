/**
 * Environment detection (PRD 4.5 / 8 #9) — checks Node.js, Hexo CLI and Git,
 * reporting installed flag + version, with install guidance for missing tools.
 *
 * The actual command execution is isolated in a `runner` so the detection
 * logic can be unit-tested with canned command outputs (no real process needed).
 */
'use strict';

const { spawnSync } = require('child_process');
const { defaultSpawnSync } = require('./utils');

function parseNodeVersion(stdout) {
  const m = /v(\d+)\.(\d+)\.(\d+)/.exec((stdout || '').trim());
  if (!m) return '';
  return m[0]; // e.g. "v22.18.0"
}

function parseHexoVersion(stdout) {
  const m = /hexo-cli:\s*([\d.]+)/.exec(stdout || '');
  if (!m) return '';
  return m[1]; // e.g. "4.3.2"
}

function parseGitVersion(stdout) {
  const m = /git version\s+(\d+(?:\.\d+)*)/.exec(stdout || '');
  if (!m) return '';
  return m[1]; // e.g. "2.51.0" (stops before the ".windows" suffix)
}

function defaultRunner(cmd, opts) {
  return defaultSpawnSync(cmd[0], cmd.slice(1), opts);
}

function detectEnvironment(runner, opts) {
  const run = runner || defaultRunner;
  const o = opts || {};

  const node = run(['node', '-v'], o);
  const hexo = run(['hexo', '-v'], o);
  const git = run(['git', '--version'], o);

  const nodeVersion = parseNodeVersion(node.stdout);
  const hexoVersion = parseHexoVersion(hexo.stdout);
  const gitVersion = parseGitVersion(git.stdout);

  return {
    node: { installed: node.ok && !!nodeVersion, version: nodeVersion },
    hexo: { installed: hexo.ok && !!hexoVersion, version: hexoVersion },
    git: { installed: git.ok && !!gitVersion, version: gitVersion }
  };
}

function installInstructions() {
  return {
    node: '请安装 Node.js：访问 https://nodejs.org 下载 LTS 安装包并安装。',
    hexo: '请安装 Hexo CLI：在终端运行 npm install -g hexo-cli。',
    git: '请安装 Git：访问 https://git-scm.com/downloads 下载并安装。'
  };
}

function buildSummary(env) {
  const parts = [];
  const names = { node: 'Node.js', hexo: 'Hexo CLI', git: 'Git' };
  for (const key of ['node', 'hexo', 'git']) {
    const e = env[key];
    if (e.installed) {
      parts.push(names[key] + ' ✓ ' + e.version);
    } else {
      parts.push(names[key] + ' ✗ 未安装');
    }
  }
  return parts.join('\n');
}


/**
 * Onboarding guide — turn a detected environment into an ordered, actionable
 * checklist the renderer can render on first run (PRD-minded enhancement for
 * the "缺少环境检测和引导" issue). Pure data, no side effects.
 */
function buildGuide(env) {
  const order = ['node', 'hexo', 'git'];
  const labels = { node: 'Node.js', hexo: 'Hexo CLI', git: 'Git' };
  const instructions = installInstructions();
  const steps = [];
  for (const key of order) {
    const e = env && env[key] ? env[key] : { installed: false, version: '' };
    steps.push({
      key: key,
      label: labels[key],
      installed: !!e.installed,
      version: e.version || '',
      instruction: instructions[key]
    });
  }
  const missing = steps.filter(function (s) { return !s.installed; }).map(function (s) { return s.key; });
  // Blog manager only strictly needs Node + Hexo to manage a blog; git is only
  // required for deployment, so split the readiness into two signals.
  const readyForBlog = env && env.node && env.node.installed && env.hexo && env.hexo.installed;
  const readyForDeploy = readyForBlog && env && env.git && env.git.installed;
  return {
    steps: steps,
    missing: missing,
    allInstalled: missing.length === 0,
    readyForBlog: !!readyForBlog,
    readyForDeploy: !!readyForDeploy,
    summary: buildSummary(env)
  };
}

module.exports = {
  detectEnvironment,
  defaultRunner,
  parseNodeVersion,
  parseHexoVersion,
  parseGitVersion,
  installInstructions,
  buildSummary,
  buildGuide
};

