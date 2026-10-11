import type { ReactNode } from 'react';
import { card } from '@/lib/ui';

/** Frame of the sign-in, registration and password pages. */
export function AuthCard({
  title,
  intro,
  children,
  wide,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="container-page py-10 sm:py-14">
      <div className={`${card} mx-auto p-6 sm:p-8 ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <h1 className="text-2xl font-bold">{title}</h1>
        {intro ? <p className="mt-2 text-muted-foreground">{intro}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
