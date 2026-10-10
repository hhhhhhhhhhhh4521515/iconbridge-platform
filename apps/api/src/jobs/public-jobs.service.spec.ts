import { prefixTsQuery } from './public-jobs.service.js';

describe('prefixTsQuery', () => {
  it('requires every word, each as a prefix', () => {
    expect(prefixTsQuery('Hotel  Guest')).toBe('hotel:* & guest:*');
  });

  it('keeps letters and digits of any alphabet and drops everything else', () => {
    expect(prefixTsQuery('C+E driver (2027)')).toBe('c:* & e:* & driver:* & 2027:*');
    expect(prefixTsQuery('réceptionniste نادل')).toBe('réceptionniste:* & نادل:*');
  });

  it.each(["'; DROP TABLE jobs; --", 'a & b | !c', 'x:* <-> y', "o'neil"])(
    'cannot produce tsquery syntax from %s',
    (text) => {
      const query = prefixTsQuery(text) ?? '';
      expect(query).toMatch(/^([\p{L}\p{N}]+:\*)( & [\p{L}\p{N}]+:\*)*$/u);
    },
  );

  it('returns null when no word is left', () => {
    expect(prefixTsQuery('%_% --')).toBeNull();
    expect(prefixTsQuery('(((')).toBeNull();
    expect(prefixTsQuery('')).toBeNull();
  });

  it('limits the number of words', () => {
    expect(prefixTsQuery('a b c d e f g h i j k')?.split(' & ')).toHaveLength(8);
  });
});
