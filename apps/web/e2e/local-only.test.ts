import { describe, expect, it } from 'vitest';
import { assertLocalUrl, isLocalUrl } from './local-only';

describe('the clean-up of the browser tests', () => {
  it('runs against this machine only', () => {
    for (const url of [
      'http://localhost:3000',
      'https://localhost:3443',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://azurite.localhost:10000',
    ]) {
      expect(isLocalUrl(url), url).toBe(true);
    }
  });

  it('refuses the production site and anything else', () => {
    for (const url of [
      'https://ca-iconbridge-web-prod-itn.ambitioushill-65b541eb.italynorth.azurecontainerapps.io',
      'https://iconbridgerecruitment.com',
      'https://www.iconbridgerecruitment.com',
      'https://jobs.example.com',
      'http://localhost.evil.example',
      'http://10.0.0.5:3000',
      'not a url',
    ]) {
      expect(isLocalUrl(url), url).toBe(false);
    }
    expect(() => {
      assertLocalUrl('https://jobs.example.com/en', 'The clean-up');
    }).toThrow('The clean-up only runs against this machine; refused for jobs.example.com.');
  });
});
