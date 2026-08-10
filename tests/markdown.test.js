const { renderMarkdown, stripDangerous } = require('../src/core/markdown');

describe('markdown renderer (Phase 10)', () => {
  test('renders a heading', () => {
    expect(renderMarkdown('# 标题').trim()).toBe('<h1>标题</h1>');
  });

  test('renders an unordered list', () => {
    const html = renderMarkdown('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });

  test('renders inline code and fenced code blocks', () => {
    expect(renderMarkdown('use `x`')).toContain('<code>x</code>');
    const fenced = renderMarkdown('```\nconst a = 1;\n```');
    expect(fenced).toContain('<pre>');
    expect(fenced).toContain('const a = 1;');
  });

  test('renders a normal link', () => {
    const html = renderMarkdown('[site](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>site</a>');
  });

  test('strips <script> blocks authored in markdown', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  test('strips inline on* event handlers', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  test('neutralizes javascript: links', () => {
    const html = renderMarkdown('[x](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).toContain('#blocked');
  });

  test('stripDangerous removes style blocks too', () => {
    expect(stripDangerous('<style>body{}</style>x')).toBe('x');
  });

  test('sanitize:false keeps raw html (for trusted internal use)', () => {
    const html = renderMarkdown('<a href="https://ok.com">ok</a>', { sanitize: false });
    expect(html).toContain('https://ok.com');
  });
});
