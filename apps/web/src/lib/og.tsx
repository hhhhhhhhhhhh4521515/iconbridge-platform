import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * Open Graph picture in the brand colours: navy background, gold rule, white text.
 * The built-in font has Latin glyphs only, so callers pass Latin text.
 */
export function brandImage(options: {
  eyebrow: string;
  title: string;
  footer: string;
}): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: 'linear-gradient(135deg, #0e073e 0%, #102d85 100%)',
        color: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>
        IconBridge Jobs
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 28, color: '#e2b75e', fontWeight: 600 }}>
          {options.eyebrow}
        </div>
        <div
          style={{ display: 'flex', fontSize: 68, fontWeight: 800, lineHeight: 1.1, marginTop: 12 }}
        >
          {options.title.length > 70 ? `${options.title.slice(0, 69)}…` : options.title}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 26, color: '#dcdfea' }}>
        <div style={{ width: 80, height: 6, background: '#c48f2f', marginRight: 20 }} />
        {options.footer}
      </div>
    </div>,
    OG_SIZE,
  );
}
