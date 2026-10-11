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
    expect(cleanRichText('<p><a href="javascript:alert(1)">bad</a></p>')).toBe(
      '<p><a rel="noopener noreferrer nofollow" target="_blank">bad</a></p>',
    );
  });
});
