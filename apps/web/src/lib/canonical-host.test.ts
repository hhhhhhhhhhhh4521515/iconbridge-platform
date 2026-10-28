import { describe, expect, it } from 'vitest';
import { canonicalRedirectUrl } from './canonical-host';

const SITE = 'https://iconbridgerecruitment.com';
const AZURE = 'ca-iconbridge-web-prod-itn.ambitioushill-65b541eb.italynorth.azurecontainerapps.io';

describe('canonical address of the site', () => {
  it('leaves the main address alone', () => {
    expect(canonicalRedirectUrl(SITE, 'iconbridgerecruitment.com', '/en')).toBeNull();
    expect(canonicalRedirectUrl(SITE, 'IconBridgeRecruitment.com:443', '/en')).toBeNull();
  });

  it('sends www and the default Azure address to the main one, path and query kept', () => {
    expect(canonicalRedirectUrl(SITE, 'www.iconbridgerecruitment.com', '/fr/jobs?q=chef')).toBe(
      'https://iconbridgerecruitment.com/fr/jobs?q=chef',
    );
    expect(canonicalRedirectUrl(SITE, AZURE, '/en/jobs/42')).toBe(
      'https://iconbridgerecruitment.com/en/jobs/42',
    );
    expect(
      canonicalRedirectUrl(
        SITE,
        'ca-iconbridge-web-prod-itn--0000016.ambitioushill-65b541eb.italynorth.azurecontainerapps.io',
        '/',
      ),
    ).toBe('https://iconbridgerecruitment.com/');
  });

  it('serves other hosts as they are (probes by IP, unknown names)', () => {
    expect(canonicalRedirectUrl(SITE, '100.100.0.12:3000', '/en')).toBeNull();
    expect(canonicalRedirectUrl(SITE, 'evil.example', '/en')).toBeNull();
    expect(canonicalRedirectUrl(SITE, 'www.evil.example', '/en')).toBeNull();
    expect(canonicalRedirectUrl(SITE, null, '/en')).toBeNull();
  });

  it('does nothing while the site itself is on the Azure address, or not on HTTPS', () => {
    expect(canonicalRedirectUrl(`https://${AZURE}`, AZURE, '/en')).toBeNull();
    expect(canonicalRedirectUrl('http://localhost:3000', AZURE, '/en')).toBeNull();
    expect(canonicalRedirectUrl(undefined, AZURE, '/en')).toBeNull();
    expect(canonicalRedirectUrl('not a url', AZURE, '/en')).toBeNull();
  });
});
