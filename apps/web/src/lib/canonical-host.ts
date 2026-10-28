/** Default addresses of Azure Container Apps (apps and their revisions). */
const AZURE_DEFAULT_HOST = /\.azurecontainerapps\.io$/;

/**
 * The site has one address, the origin of NEXT_PUBLIC_SITE_URL. A page asked for on its
 * www. form or on a default Azure address gets the address to redirect to (path and query
 * kept); any other host, and a site that is not on HTTPS (local, tests), gets null.
 */
export function canonicalRedirectUrl(
  siteUrl: string | undefined,
  hostHeader: string | null,
  pathAndQuery: string,
): string | null {
  let site: URL;
  try {
    site = new URL(siteUrl ?? '');
  } catch {
    return null;
  }
  if (site.protocol !== 'https:' || !hostHeader) {
    return null;
  }
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '');
  if (host === site.hostname) {
    return null;
  }
  if (host === `www.${site.hostname}` || AZURE_DEFAULT_HOST.test(host)) {
    return `${site.origin}${pathAndQuery}`;
  }
  return null;
}
