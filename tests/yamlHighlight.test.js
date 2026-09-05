const { highlightYaml } = require('../src/core/yamlHighlight');
const { escapeHtml } = require('../src/core/utils');

describe('yamlHighlight', () => {
  test('colors top-level keys and keeps values plain', () => {
    const h = highlightYaml('theme: next\nurl: https://x\n');
    expect(h).toContain('<span class="yml-key">theme</span>');
    expect(h).toContain('<span class="yml-key">url</span>');
    expect(h).toContain('https://x');
  });

  test('colors nested indented keys', () => {
    const h = highlightYaml('search:\n  path: search.xml\n');
    expect(h).toContain('<span class="yml-key">search</span>');
    expect(h).toContain('<span class="yml-key">path</span>');
  });

  test('colors full-line and indented comments with yml-comment', () => {
    const h = highlightYaml('# hello\n  # indented\n');
    expect(h).toMatch(/<span class="yml-comment"># hello<\/span>/);
    expect(h).toMatch(/<span class="yml-comment">  # indented<\/span>/);
  });

  test('escapes html so config content cannot inject markup', () => {
    const h = highlightYaml('a: <script>alert(1)</script>\n');
    expect(h.indexOf('<script>')).toBe(-1);
    expect(h.indexOf('&#60;script&#62;')).toBeGreaterThanOrEqual(0);
  });

  test('escapes ampersand and quotes in values', () => {
    const h = highlightYaml('a: "a & b"\n');
    expect(h.indexOf('"a & b"')).toBe(-1);
    expect(h).toContain('&#38;');
  });

  test('does not treat list-item dashes as keys', () => {
    const h = highlightYaml('- item\n  - nested\n');
    expect(h.indexOf('yml-key')).toBe(-1);
  });

  test('preserves blank lines and exact output for a small file', () => {
    expect(highlightYaml('a: 1\n\nb: 2\n')).toBe(
      '<span class="yml-key">a</span>: 1\n\n<span class="yml-key">b</span>: 2\n'
    );
  });

  test('escapeHtml neutralizes &, <, > and both quote kinds', () => {
    expect(escapeHtml('<a href="x" y=\'z\'>&')).toBe('&#60;a href=&#34;x&#34; y=&#39;z&#39;&#62;&#38;');
  });

  test('null/undefined input does not throw', () => {
    expect(highlightYaml(null)).toBe('');
    expect(highlightYaml(undefined)).toBe('');
  });
});