/**
 * The clean-up of the browser tests signs in as the local super admin and deletes
 * records through the back-office API. It must only ever reach this machine: a run
 * pointed at the production site (E2E_BASE_URL) would otherwise try it there.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Throws unless `url` is on this machine. The message names the host, never a secret. */
export function assertLocalUrl(url: string, what: string): void {
  if (!isLocalUrl(url)) {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // not a URL: shown as given
    }
    throw new Error(`${what} only runs against this machine; refused for ${host}.`);
  }
}
