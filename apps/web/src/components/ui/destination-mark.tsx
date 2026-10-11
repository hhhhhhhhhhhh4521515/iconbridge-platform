import { Globe, Ship } from 'lucide-react';

/**
 * A small flag (or a ship) for a destination. Drawn as SVG because flag emoji
 * do not display on Windows and on some Linux systems.
 */
export function DestinationMark({
  code,
  className = 'h-4 w-6',
}: {
  code: string;
  className?: string;
}) {
  const frame = `${className} shrink-0 rounded-[3px] ring-1 ring-black/15`;
  switch (code) {
    case 'MALTA':
      return (
        <svg viewBox="0 0 6 4" className={frame} aria-hidden>
          <rect width="3" height="4" fill="#ffffff" />
          <rect x="3" width="3" height="4" fill="#cf142b" />
          <path d="M0.55 0.5h0.3v0.3h0.3v0.3h-0.3v0.3h-0.3v-0.3h-0.3v-0.3h0.3z" fill="#9aa0a6" />
        </svg>
      );
    case 'POLAND':
      return (
        <svg viewBox="0 0 6 4" className={frame} aria-hidden>
          <rect width="6" height="2" fill="#ffffff" />
          <rect y="2" width="6" height="2" fill="#dc143c" />
        </svg>
      );
    case 'CRUISE_SHIP':
      return <Ship className={`${className} shrink-0`} aria-hidden />;
    default:
      return <Globe className={`${className} shrink-0`} aria-hidden />;
  }
}
