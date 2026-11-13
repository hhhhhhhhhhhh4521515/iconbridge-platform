import { Cairo, Inter } from 'next/font/google';

/**
 * The fonts of every root layout (the site and the partner area). `--font-sans` in
 * globals.css names both variables: a layout that left one out made the whole font-family
 * invalid, and the browser fell back to its serif default.
 */
const inter = Inter({
  // latin-ext: Polish letters (ą, ę, ł, ś, ż) in the partner area and in names on the site.
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});
// Not preloaded: only Arabic pages use it, and the browser fetches it when it is needed.
const cairo = Cairo({
  subsets: ['arabic'],
  variable: '--font-cairo',
  display: 'swap',
  preload: false,
});

/** Class names that define `--font-inter` and `--font-cairo` on `<html>`. */
export const fontVariables = `${inter.variable} ${cairo.variable}`;
