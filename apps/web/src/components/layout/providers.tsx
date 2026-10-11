'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

/** Light and dark mode: follows the system at first, then the visitor's choice. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
