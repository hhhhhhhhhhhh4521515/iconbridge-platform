/** Shared class names of the calls to action: 44 px high at least, visible focus, AA contrast. */
const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60';

export const cta = {
  primary: `${base} bg-primary text-primary-foreground hover:bg-primary/90`,
  gold: `${base} bg-brand-gold text-brand-navy hover:brightness-110`,
  outline: `${base} border border-input bg-background text-foreground hover:bg-muted`,
  onDark: `${base} border border-white/50 bg-white/10 text-white hover:bg-white/20`,
  ghost: `${base} text-foreground hover:bg-muted`,
} as const;

export const field =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground';

export const card = 'rounded-2xl border border-border bg-card text-card-foreground shadow-sm';
