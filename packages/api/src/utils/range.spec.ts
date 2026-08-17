import { describe, it, expect } from 'vitest';
import { parseRangeHeader } from './range';

const SIZE = 1000;

describe('parseRangeHeader', () => {
  it('ignores an absent header', () => {
    expect(parseRangeHeader(undefined, SIZE)).toEqual({ kind: 'none' });
    expect(parseRangeHeader(null, SIZE)).toEqual({ kind: 'none' });
  });

  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-99', SIZE)).toEqual({
      kind: 'range',
      range: { start: 0, end: 99 },
    });
  });

  it('parses an open-ended range as running to the last byte', () => {
    expect(parseRangeHeader('bytes=500-', SIZE)).toEqual({
      kind: 'range',
      range: { start: 500, end: 999 },
    });
  });

  it('parses a suffix range as the last N bytes', () => {
    expect(parseRangeHeader('bytes=-100', SIZE)).toEqual({
      kind: 'range',
      range: { start: 900, end: 999 },
    });
  });

  it('clamps a suffix larger than the object to the whole object', () => {
    expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({
      kind: 'range',
      range: { start: 0, end: 999 },
    });
  });

  it('clamps an end past the last byte rather than rejecting it', () => {
    // Players routinely ask for more than exists at the tail of a file.
    expect(parseRangeHeader('bytes=900-99999', SIZE)).toEqual({
      kind: 'range',
      range: { start: 900, end: 999 },
    });
  });

  it('treats a start at or past the end as unsatisfiable', () => {
    expect(parseRangeHeader(`bytes=${SIZE}-`, SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=5000-6000', SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('treats any range against an empty object as unsatisfiable', () => {
    expect(parseRangeHeader('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('treats a zero-length suffix as unsatisfiable', () => {
    expect(parseRangeHeader('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ignores an inverted range rather than erroring', () => {
    // RFC 9110: a malformed range is ignored, which means a normal 200.
    expect(parseRangeHeader('bytes=500-100', SIZE)).toEqual({ kind: 'none' });
  });

  it('ignores a multi-range request', () => {
    // Legal to answer with the whole representation; multipart/byteranges is
    // deliberately not implemented.
    expect(parseRangeHeader('bytes=0-9,20-29', SIZE)).toEqual({ kind: 'none' });
  });

  it('ignores a non-bytes unit', () => {
    expect(parseRangeHeader('items=0-9', SIZE)).toEqual({ kind: 'none' });
  });

  it('ignores malformed input', () => {
    expect(parseRangeHeader('bytes=', SIZE)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('bytes=-', SIZE)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('nonsense', SIZE)).toEqual({ kind: 'none' });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRangeHeader('  bytes=0-9  ', SIZE)).toEqual({
      kind: 'range',
      range: { start: 0, end: 9 },
    });
  });
});
