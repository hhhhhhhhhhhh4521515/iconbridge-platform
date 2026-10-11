import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Locale-aware Link, redirect and router: paths are written without the /fr, /en or /ar prefix. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
