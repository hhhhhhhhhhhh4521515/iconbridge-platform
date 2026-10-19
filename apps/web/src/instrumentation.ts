import { wakeApi } from '@/lib/wake-api';

/** Runs once when the web server starts. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  void wakeApi(process.env.API_INTERNAL_URL);
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (connectionString) {
    const { startTelemetry } = await import('@/lib/telemetry');
    await startTelemetry(connectionString);
  }
}
