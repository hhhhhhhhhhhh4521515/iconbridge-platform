/**
 * Loads something the first time it is needed, once; a failure is not kept, so the next
 * call tries again.
 *
 * Why: in Azure the API scales to zero and starts on 0.5 vCPU when a request arrives.
 * Every module imported at start-up is read and compiled before the API listens, so
 * modules the first requests do not need (mjml, exceljs, archiver, sharp, the Azure
 * SDKs) are imported on first use instead (docs/adr/ADR-017-cold-start.md).
 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
