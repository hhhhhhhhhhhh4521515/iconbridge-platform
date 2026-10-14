import { cleanRichText, isRichText } from './rich-text.js';

describe('cleanRichText', () => {
  it('leaves plain text untouched, including characters that look like HTML', () => {
    const text = 'Salary > 1200 & meals included.\nTwo lines.';
    expect(isRichText(text)).toBe(false);
    expect(cleanRichText(text)).toBe(text);
  });

  it('keeps the formatting of the editor', () => {
    const html = '<p>Hello <strong>team</strong></p><ul><li>One</li><li>Two</li></ul>';
    expect(cleanRichText(html)).toBe(html);
  });

  it('removes scripts, event handlers, styles and unknown tags', () => {
    const cleaned = cleanRichText(
      '<p onclick="steal()" style="color:red">Hi<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil.example"></iframe></p>',
    );
    expect(cleaned).toBe('<p>Hi</p>');
  });

  it('keeps safe links only, and makes them open safely', () => {
    expect(cleanRichText('<a href="https://example.test/x">site</a>')).toBe(
      '<a href="https://example.test/x" rel="noopener noreferrer nofollow" target="_blank">site</a>',
    );
    for (const address of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:x',
    ]) {
      const cleaned = cleanRichText(`<p><a href="${address}">bad</a></p>`);
      expect(cleaned).toBe('<p><a>bad</a></p>');
    }
  });

  it.each([
    '<img src=x onerror=alert(1)>',
    '<svg><script>alert(1)</script></svg>',
    '<svg onload=alert(1)>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<p><a href="jav&#x09;ascript:alert(1)">x</a></p>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<form action="https://evil.example"><input name=password></form>',
    '<p style="background:url(javascript:alert(1))">x</p>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<a href="https://ok.example" onclick="steal()">x</a>',
    '<object data="x"></object><embed src="x">',
    '<p>ok</p><!-- comment --><base href="https://evil.example/">',
  ])('leaves nothing that could run or load from %s', (payload) => {
    const cleaned = cleanRichText(payload);
    expect(cleaned).not.toMatch(
      /<(script|img|svg|iframe|form|input|object|embed|style|base|math)\b/i,
    );
    expect(cleaned).not.toMatch(/\son[a-z]+\s*=/i);
    expect(cleaned).not.toMatch(/javascript:/i);
    expect(cleaned).not.toMatch(/\sstyle=/i);
  });
});
