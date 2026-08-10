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
