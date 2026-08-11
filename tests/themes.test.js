const { createThemesService, parseActiveTheme, applyThemeLine, pluginCategory } = require('../src/core/themes');

const norm = p => (p == null ? '' : String(p)).split('\\').join('/').replace(/\/+$/, '');

function makeFakeFs(seed) {
  const files = {};
  const dirs = { '': true };
  for (const k of Object.keys(seed || {})) {
    const n = norm(k);
    files[n] = seed[k];
    const segs = n.split('/');
    let acc = '';
    for (let i = 0; i < segs.length - 1; i++) {
      acc = acc ? acc + '/' + segs[i] : segs[i];
      dirs[acc] = true;
    }
  }
  const parentOf = p => {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  };
  const leafOf = p => {
    const i = p.lastIndexOf('/');
    return i < 0 ? p : p.slice(i + 1);
  };
  const allEntries = Object.keys(files).concat(Object.keys(dirs));
  return {
    readFileSync(full, enc) {
      const n = norm(full);
      if (Object.prototype.hasOwnProperty.call(files, n)) return files[n];
      const e = new Error('ENOENT ' + full); e.code = 'ENOENT'; throw e;
    },
    writeFileSync(full, content) {
      const n = norm(full);
      files[n] = String(content);
      dirs[parentOf(n)] = true;
    },
    readdirSync(dir) {
      const base = norm(dir);
      const out = [];
      const seen = {};
      for (const p of allEntries) {
        if (parentOf(p) === base) {
          const leaf = leafOf(p);
          if (!leaf || seen[leaf]) continue;
          seen[leaf] = true;
          out.push(leaf);
        }
      }
      if (!out.length && !dirs[base] && !Object.prototype.hasOwnProperty.call(files, base)) {
        const e = new Error('ENOENT ' + dir); e.code = 'ENOENT'; throw e;
      }
      return out;
    }
  };
}

describe('themes: config parsing', () => {
  test('parseActiveTheme reads the top-level theme line', () => {
    expect(parseActiveTheme('site: x\ntheme: landscape\nfoo: bar')).toBe('landscape');
  });
  test('parseActiveTheme ignores commented theme lines', () => {
    expect(parseActiveTheme('# theme: ignored\nsite: x')).toBe('');
  });
  test('parseActiveTheme strips quotes and inline comments', () => {
    expect(parseActiveTheme('theme: next')).toBe('next');
    expect(parseActiveTheme('theme: next # favorite')).toBe('next');
  });

  test('applyThemeLine replaces existing line and preserves the rest', () => {
    const out = applyThemeLine('site: z\ntheme: old\nfoo: bar', 'next');
    expect(out).toContain('theme: next');
    expect(out).not.toContain('theme: old');
    expect(out).toContain('foo: bar');
    expect(out).toContain('site: z');
  });
  test('applyThemeLine appends a theme line when absent', () => {
    const out = applyThemeLine('site: z\nfoo: bar', 'next');
    expect(out).toContain('theme: next');
    expect(out).toContain('foo: bar');
  });
});

describe('themes: categories', () => {
  test('pluginCategory classifies hexo packages', () => {
    expect(pluginCategory('hexo-theme-landscape')).toBe('theme');
    expect(pluginCategory('hexo-deployer-git')).toBe('deployer');
    expect(pluginCategory('hexo-generator-archive')).toBe('generator');
    expect(pluginCategory('hexo-renderer-marked')).toBe('renderer');
    expect(pluginCategory('hexo-server')).toBe('plugin');
    expect(pluginCategory('lodash')).toBe('other');
  });
});

describe('themes service', () => {
  test('listThemes merges local + npm themes and marks the active one', () => {
    const fs = makeFakeFs({
      'B/_config.yml': 'site: x\ntheme: landscape\n',
      'B/themes/landscape/.gitkeep': '',
      'B/themes/next/.gitkeep': '',
      'B/package.json': JSON.stringify({ dependencies: { 'hexo-theme-next': '^8.0.0', 'hexo-deployer-git': '^4.0.0' } })
    });
    const svc = createThemesService({ fs });
    const r = svc.listThemes('B');
    expect(r.ok).toBe(true);
    expect(r.active).toBe('landscape');
    expect(r.themes.find(t => t.name === 'landscape').active).toBe(true);
    expect(r.themes.find(t => t.name === 'next').active).toBe(false);
  });

  test('activateTheme rewrites _config.yml in place', () => {
    const fs = makeFakeFs({ 'B/_config.yml': 'site: z\ntheme: old\nfoo: bar' });
    const svc = createThemesService({ fs });
    const r = svc.activateTheme('B', 'next');
    expect(r.ok).toBe(true);
    expect(r.active).toBe('next');
    expect(fs.readFileSync('B/_config.yml')).toContain('theme: next');
    expect(fs.readFileSync('B/_config.yml')).not.toContain('theme: old');
    expect(fs.readFileSync('B/_config.yml')).toContain('foo: bar');
  });

  test('listThemes throws NO_BLOG_PATH without a blog path', () => {
    const svc = createThemesService({ fs: makeFakeFs({}) });
    expect(() => svc.listThemes('')).toThrow(/博客本地路径/);
  });

  test('listPlugins reads package.json and excludes theme packages', () => {
    const fs = makeFakeFs({
      'B/package.json': JSON.stringify({ dependencies: {
        'hexo': '^8.0.0', 'hexo-deployer-git': '^4.0.0', 'hexo-renderer-marked': '^7.0.0',
        'hexo-theme-landscape': '^1.0.0', 'hexo-generator-archive': '^2.0.0'
      } })
    });
    const svc = createThemesService({ fs });
    const r = svc.listPlugins('B');
    expect(r.ok).toBe(true);
    const names = r.plugins.map(p => p.name);
    expect(names).toContain('hexo-deployer-git');
    expect(names).toContain('hexo-renderer-marked');
    expect(names).toContain('hexo-generator-archive');
    expect(names).not.toContain('hexo-theme-landscape');
    expect(r.plugins.find(p => p.name === 'hexo-deployer-git').category).toBe('deployer');
  });

  test('installPlugin / uninstallPlugin use the injected spawner', () => {
    const calls = [];
    const spawn = (cmd, args) => { calls.push([cmd, ...args]); return { ok: true, stdout: '', stderr: '' }; };
    const svc = createThemesService({ fs: makeFakeFs({}), spawn });
    expect(svc.installPlugin('B', 'hexo-migrator-rss').ok).toBe(true);
    expect(svc.uninstallPlugin('B', 'hexo-migrator-rss').ok).toBe(true);
    expect(calls[0][0]).toBe('npm');
    expect(calls[0].join(' ')).toContain('install');
    expect(calls[1].join(' ')).toContain('uninstall');
  });

  test('installPlugin surfaces failure from the spawner', () => {
    const spawn = () => ({ ok: false, error: 'boom', stderr: 'x' });
    const svc = createThemesService({ fs: makeFakeFs({}), spawn });
    const r = svc.installPlugin('B', 'hexo-migrator-rss');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });

  test('installPlugin rejects empty package name', () => {
    const svc = createThemesService({ fs: makeFakeFs({}), spawn: () => ({ ok: true }) });
    expect(() => svc.installPlugin('B', '')).toThrow(/插件名称/);
  });
});

describe('themes: theme config + backup', () => {
  test('writeThemeConfig writes _config.<theme>.yml and returns the theme', () => {
    const fs = makeFakeFs({ 'B/_config.yml': 'theme: next\nsite: x\n' });
    const svc = createThemesService({ fs });
    const r = svc.writeThemeConfig('B', 'inject:\n  head: []\n');
    expect(r.ok).toBe(true);
    expect(r.theme).toBe('next');
    expect(r.backup).toBe(null);
    expect(fs.readFileSync('B/_config.next.yml')).toBe('inject:\n  head: []\n');
    expect(fs.readFileSync('B/_config.yml')).toBe('theme: next\nsite: x\n');
  });

  test('writeThemeConfig backs up an existing theme config before overwriting', () => {
    const fs = makeFakeFs({
      'B/_config.yml': 'theme: next\n',
      'B/_config.next.yml': 'old: v\n'
    });
    const svc = createThemesService({ fs });
    const r = svc.writeThemeConfig('B', 'new: v\n');
    expect(r.ok).toBe(true);
    expect(r.backup).not.toBe(null);
    expect(String(r.backup).indexOf('_config.next.yml.bak')).toBeGreaterThanOrEqual(0);
    expect(fs.readFileSync('B/_config.next.yml')).toBe('new: v\n');
    expect(fs.readFileSync('B/_config.next.yml.bak')).toBe('old: v\n');
  });

  test('writeThemeConfig refuses when there is no active theme', () => {
    const fs = makeFakeFs({ 'B/_config.yml': 'site: x\n' });
    const svc = createThemesService({ fs });
    const r = svc.writeThemeConfig('B', 'x: 1\n');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/主题/);
  });

  test('readConfigBackup returns ok:false when no backup exists', () => {
    const fs = makeFakeFs({ 'B/_config.yml': 'theme: next\nsite: x\n' });
    const svc = createThemesService({ fs });
    const r = svc.readConfigBackup('B', 'site');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/备份/);
  });

  test('readConfigBackup returns the newest (highest numbered) site backup', () => {
    const fs = makeFakeFs({
      'B/_config.yml': 'cur\n',
      'B/_config.yml.bak': 'orig\n',
      'B/_config.yml.bak.2': 'second\n'
    });
    const svc = createThemesService({ fs });
    const r = svc.readConfigBackup('B', 'site');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('second\n');
    expect(String(r.backup).indexOf('_config.yml.bak.2')).toBeGreaterThanOrEqual(0);
  });

  test('readConfigBackup reads the theme config backup when which=theme', () => {
    const fs = makeFakeFs({
      'B/_config.yml': 'theme: next\n',
      'B/_config.next.yml': 'cur\n',
      'B/_config.next.yml.bak': 'prev\n'
    });
    const svc = createThemesService({ fs });
    const r = svc.readConfigBackup('B', 'theme');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('prev\n');
    expect(String(r.backup).indexOf('_config.next.yml.bak')).toBeGreaterThanOrEqual(0);
  });

  test('readConfigBackup theme fails when no active theme is set', () => {
    const fs = makeFakeFs({ 'B/_config.yml': 'site: x\n' });
    const svc = createThemesService({ fs });
    const r = svc.readConfigBackup('B', 'theme');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/主题/);
  });
});

describe('themes: config file list + backup by name', () => {
  test('listBlogConfigFiles lists _config.yml plus theme configs, marks the active theme', () => {
    const fs = makeFakeFs({
      'B/_config.yml': 'theme: butterfly\nsite: x\n',
      'B/_config.butterfly.yml': 'inject:\n  head: []\n',
      'B/_config.next.yml': 'inject:\n  head: []\n'
    });
    const svc = createThemesService({ fs });
    const r = svc.listBlogConfigFiles('B');
    expect(r.ok).toBe(true);
    expect(r.activeTheme).toBe('butterfly');
    expect(r.files.map(f => f.name)).toEqual(['_config.yml', '_config.butterfly.yml', '_config.next.yml']);
    expect(r.files[0]).toMatchObject({ name: '_config.yml', kind: 'site', active: true });
    const bf = r.files.find(f => f.name === '_config.butterfly.yml');
    expect(bf.kind).toBe('theme');
    expect(bf.label).toMatch(/当前/);
    expect(bf.active).toBe(true);
    expect(r.files.find(f => f.name === '_config.next.yml').kind).toBe('theme-other');
  });

  test('listBlogConfigFiles still lists other cfg files when _config.yml is absent', () => {
    const fs = makeFakeFs({ 'B/_config.butterfly.yml': 'inject: x\n' });
    const svc = createThemesService({ fs });
    const r = svc.listBlogConfigFiles('B');
    expect(r.ok).toBe(true);
    expect(r.files).toHaveLength(1);
    expect(r.files[0].name).toBe('_config.butterfly.yml');
    expect(r.files[0].active).toBe(false);
  });

  test('listBlogConfigFiles ignores non-_config yaml and markdown files', () => {
    const fs = makeFakeFs({
      'B/_config.yml': 'theme: x\nsite: y\n',
      'B/themes.yml': 'a: 1\n',
      'B/random.md': 'a: 1\n'
    });
    const svc = createThemesService({ fs });
    const r = svc.listBlogConfigFiles('B');
    expect(r.files.map(f => f.name)).toEqual(['_config.yml']);
  });

  test('readConfigBackup accepts a direct config file name', () => {
    const fs = makeFakeFs({
      'B/_config.yml': 'cur\n',
      'B/_config.yml.bak': 'orig\n',
      'B/_config.butterfly.yml': 'cur-t\n',
      'B/_config.butterfly.yml.bak': 'orig-t\n'
    });
    const svc = createThemesService({ fs });
    const r = svc.readConfigBackup('B', '_config.butterfly.yml');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('orig-t\n');
    expect(String(r.backup).indexOf('_config.butterfly.yml.bak')).toBeGreaterThanOrEqual(0);
  });

  test('readConfigBackup site/theme back-compat still works', () => {
    const fs = makeFakeFs({
      'B/_config.yml': 'theme: next\ncur\n',
      'B/_config.yml.bak': 'orig\n',
      'B/_config.next.yml': 'cur-t\n',
      'B/_config.next.yml.bak': 'orig-t\n'
    });
    const svc = createThemesService({ fs });
    expect(svc.readConfigBackup('B', 'site').text).toBe('orig\n');
    expect(svc.readConfigBackup('B', 'theme').text).toBe('orig-t\n');
  });
});

describe('themes: service exposes per-file config helpers used by IPC', () => {
  test('createThemesService returns readBlogConfigFile / writeBlogConfigFile', () => {
    const fs = makeFakeFs({ 'B/_config.yml': 'theme: next\n', 'B/_config.butterfly.yml': 'inject:\n  head: []\n' });
    const svc = createThemesService({ fs });
    expect(typeof svc.readBlogConfigFile).toBe('function');
    expect(typeof svc.writeBlogConfigFile).toBe('function');
    expect(svc.readBlogConfigFile('B', '_config.butterfly.yml')).toBe('inject:\n  head: []\n');
    const r = svc.writeBlogConfigFile('B', '_config.butterfly.yml', 'inject:\n  head: ["a"]\n');
    expect(r.ok).toBe(true);
    expect(fs.readFileSync('B/_config.butterfly.yml')).toBe('inject:\n  head: ["a"]\n');
  });
});