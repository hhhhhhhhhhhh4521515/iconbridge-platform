import { wakeApi } from '@/lib/wake-api';

/** Runs once when the web server starts. */
export function register(): void {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    void wakeApi(process.env.API_INTERNAL_URL);
  }
}
