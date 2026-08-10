const {
  detectEnvironment,
  parseNodeVersion,
  parseHexoVersion,
  parseGitVersion,
  installInstructions,
  buildSummary
} = require('../src/core/env');

function fakeRunner(map) {
  return (cmd) => {
    const r = map[cmd[0]];
    if (r == null) return { ok: false, stdout: '', stderr: 'not found' };
    if (r === 'FAIL') return { ok: false, stdout: '', stderr: 'fail' };
    if (r === 'BADOUT') return { ok: true, stdout: 'some unparseable noise', stderr: '' };
    return { ok: true, stdout: r, stderr: '' };
  };
}

describe('environment detection (Phase 6)', () => {
  test('parseNodeVersion reads vX.Y.Z', () => {
    expect(parseNodeVersion('v22.18.0\n')).toBe('v22.18.0');
    expect(parseNodeVersion('garbage')).toBe('');
    expect(parseNodeVersion('')).toBe('');
  });

  test('parseHexoVersion reads hexo-cli version from multi-line output', () => {
    const out = 'hexo-cli: 4.3.2\nos: win32 10.0.26100 undefined\n' +
      'node: 22.18.0\nacorn: 8.15.0\nsqlite: 3.50.2\n';
    expect(parseHexoVersion(out)).toBe('4.3.2');
    expect(parseHexoVersion('no hexo here')).toBe('');
  });

  test('parseGitVersion reads git version even with windows suffix', () => {
    expect(parseGitVersion('git version 2.51.0.windows.1\n')).toBe('2.51.0');
    expect(parseGitVersion('')).toBe('');
  });

  test('detectEnvironment reports all three installed with versions', () => {
    const runner = fakeRunner({
      node: 'v22.18.0\n',
      hexo: 'hexo-cli: 4.3.2\nnode: 22.18.0\n',
      git: 'git version 2.51.0.windows.1\n'
    });
    const env = detectEnvironment(runner);
    expect(env.node).toEqual({ installed: true, version: 'v22.18.0' });
    expect(env.hexo).toEqual({ installed: true, version: '4.3.2' });
    expect(env.git).toEqual({ installed: true, version: '2.51.0' });
  });

  test('detectEnvironment marks a missing tool as not installed', () => {
    const env = detectEnvironment(fakeRunner({
      node: 'v22.18.0\n',
      hexo: 'FAIL',
      git: 'git version 2.51.0\n'
    }));
    expect(env.hexo).toEqual({ installed: false, version: '' });
    expect(env.node.installed).toBe(true);
    expect(env.git.installed).toBe(true);
  });

  test('detectEnvironment marks tool not installed when output is unparseable', () => {
    const env = detectEnvironment(fakeRunner({ node: 'BADOUT', hexo: 'BADOUT', git: 'BADOUT' }));
    expect(env.node.installed).toBe(false);
    expect(env.hexo.installed).toBe(false);
    expect(env.git.installed).toBe(false);
  });

  test('buildSummary shows check marks and missing marks', () => {
    const env = {
      node: { installed: true, version: 'v22.18.0' },
      hexo: { installed: false, version: '' },
      git: { installed: true, version: '2.51.0' }
    };
    const summary = buildSummary(env);
    expect(summary).toContain('Node.js ✓ v22.18.0');
    expect(summary).toContain('Hexo CLI ✗ 未安装');
    expect(summary).toContain('Git ✓ 2.51.0');
  });

  test('installInstructions provides guidance for each tool', () => {
    const guide = installInstructions();
    expect(guide.node).toMatch(/Node\.js/);
    expect(guide.hexo).toMatch(/hexo-cli/);
    expect(guide.git).toMatch(/git-scm\.com/);
  });

  test('real environment has Node.js installed (smoke against the live runner)', () => {
    const env = detectEnvironment();
    expect(env.node.installed).toBe(true);
  });
});

describe('environment onboarding guide (built-in buildGuide)', () => {
  const { buildGuide } = require('../src/core/env');
  const mk = (n, h, g) => ({
    node: { installed: n, version: n ? 'v22.18.0' : '' },
    hexo: { installed: h, version: h ? '4.3.2' : '' },
    git: { installed: g, version: g ? '2.51.0' : '' }
  });

  test('all installed -> ready and no missing', () => {
    const g = buildGuide(mk(true, true, true));
    expect(g.allInstalled).toBe(true);
    expect(g.missing).toEqual([]);
    expect(g.readyForBlog).toBe(true);
    expect(g.readyForDeploy).toBe(true);
    expect(g.steps.length).toBe(3);
    expect(g.steps[0].label).toBe('Node.js');
  });

  test('missing hexo -> not ready for blog', () => {
    const g = buildGuide(mk(true, false, true));
    expect(g.allInstalled).toBe(false);
    expect(g.missing).toEqual(['hexo']);
    expect(g.readyForBlog).toBe(false);
    expect(g.readyForDeploy).toBe(false);
  });

  test('node+hexo present, git missing -> ready for blog but not deploy', () => {
    const g = buildGuide(mk(true, true, false));
    expect(g.readyForBlog).toBe(true);
    expect(g.readyForDeploy).toBe(false);
    expect(g.missing).toEqual(['git']);
    const gitStep = g.steps.find(s => s.key === 'git');
    expect(gitStep.installed).toBe(false);
    expect(gitStep.instruction).toMatch(/git-scm\.com/);
  });

  test('steps carry install instructions for each tool', () => {
    const g = buildGuide(mk(false, false, false));
    expect(g.steps.every(s => typeof s.instruction === 'string' && s.instruction.length > 0)).toBe(true);
  });
});
