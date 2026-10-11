import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

/** Groups of texts every interactive page of the candidate area needs. */
const ALWAYS = ['common', 'errors', 'forms'] as const;

/**
 * Gives client components the texts of the named groups. Only those groups are
 * sent to the browser, not the whole message file.
 */
export async function ClientMessages({
  groups,
  children,
}: {
  groups: readonly string[];
  children: ReactNode;
}) {
  const messages = await getMessages();
  const picked = Object.fromEntries(
    [...ALWAYS, ...groups].map((group) => [group, messages[group]]),
  );
  return <NextIntlClientProvider messages={picked}>{children}</NextIntlClientProvider>;
}
