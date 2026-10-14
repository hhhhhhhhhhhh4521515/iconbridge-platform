'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

/** Light and dark mode: follows the system at first, then the visitor's choice. */
export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      // The small script that sets the theme before the first paint carries the nonce of the page.
      nonce={nonce}
    >
      {children}
    </ThemeProvider>
  );
}
