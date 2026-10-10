import { neutraliseFormula, toCsv } from './export.service.js';

describe('neutraliseFormula', () => {
  it.each([
    '=1+1',
    '+SUM(A1)',
    '-2+3',
    '+1+cmd|calc',
    '@SUM(A1)',
    '\tcmd',
    '\rcmd',
    '=HYPERLINK("http://evil","x")',
  ])('prefixes %j with an apostrophe so a spreadsheet shows it as text', (value) => {
    expect(neutraliseFormula(value)).toBe(`'${value}`);
  });

  it('leaves ordinary text, numbers and empty cells alone', () => {
    expect(neutraliseFormula('Amira')).toBe('Amira');
    expect(neutraliseFormula('a=b')).toBe('a=b');
    expect(neutraliseFormula('+21612345678')).toBe('+21612345678');
    expect(neutraliseFormula('+356 2100 0000')).toBe('+356 2100 0000');
    expect(neutraliseFormula('-12.5')).toBe('-12.5');
    expect(neutraliseFormula(5)).toBe(5);
    expect(neutraliseFormula(-5)).toBe(-5);
    expect(neutraliseFormula(null)).toBeNull();
  });
});

describe('toCsv', () => {
  it('starts with a byte-order mark, uses CRLF and quotes what needs it', () => {
    const csv = toCsv(
      ['Name', 'Note'],
      [
        ['Ben Salah, Amira', 'said "hello"'],
        ['line\nbreak', null],
        ['عمر', 3],
      ],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(
      'Name,Note\r\n"Ben Salah, Amira","said ""hello"""\r\n"line\nbreak",\r\nعمر,3\r\n',
    );
  });

  it('neutralises formulas coming from candidate data', () => {
    expect(toCsv(['Name'], [['=cmd|calc']]).slice(1)).toBe("Name\r\n'=cmd|calc\r\n");
  });
});
