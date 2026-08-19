/**
 * Parsing for the `Range` REQUEST header (RFC 9110 section 14).
 *
 * The download route advertises `Accept-Ranges: bytes`. It previously ignored
 * the header and answered 200 with the whole body, which is a lie clients act
 * on: browser `<video>` seeking and third-party video fetchers (Meta's, when it
 * ingests a Reel) rely on ranged reads.
 *
 * Deliberately conservative. Only a single `bytes` range is honoured; anything
 * else parses as `null`, meaning "ignore the header and serve the whole object",
 * which is always a legal response.
 */

/** Inclusive byte range, already clamped to the object. */
export interface ResolvedRange {
  start: number;
  end: number;
}

export type RangeParse =
  /** Serve these bytes as a 206. */
  | { kind: 'range'; range: ResolvedRange }
  /** Syntactically fine but outside the object: answer 416. */
  | { kind: 'unsatisfiable' }
  /** No range, unsupported unit, multi-range, or malformed: serve 200 in full. */
  | { kind: 'none' };

const SINGLE_BYTES_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Resolve a `Range` header against a known object size.
 *
 * `size` comes from the database row rather than the storage backend, so an
 * unsatisfiable range is rejected before any object read happens.
 */
export function parseRangeHeader(header: string | null | undefined, size: number): RangeParse {
  if (!header) return { kind: 'none' };

  const match = SINGLE_BYTES_RANGE.exec(header.trim());
  // Not `bytes=`, or a multi-range list ("bytes=0-9,20-29"): ignore it. Serving
  // the whole object is a valid answer to a range request, and multipart/byteranges
  // is not worth the complexity for this use case.
  if (!match) return { kind: 'none' };

  const [, rawStart, rawEnd] = match;

  // "bytes=-N": the last N bytes.
  if (rawStart === '') {
    if (rawEnd === '') return { kind: 'none' }; // "bytes=-" is malformed.
    const suffix = Number(rawEnd);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    if (size === 0) return { kind: 'unsatisfiable' };
    const start = Math.max(0, size - suffix);
    return { kind: 'range', range: { start, end: size - 1 } };
  }

  const start = Number(rawStart);
  // A start at or past the end cannot be satisfied. An empty object cannot
  // satisfy any range.
  if (size === 0 || start >= size) return { kind: 'unsatisfiable' };

  // "bytes=N-": from N to the end.
  if (rawEnd === '') return { kind: 'range', range: { start, end: size - 1 } };

  const end = Number(rawEnd);
  // An inverted range is malformed, not unsatisfiable: ignore per RFC 9110.
  if (end < start) return { kind: 'none' };

  // A range running past the end is clamped, not rejected.
  return { kind: 'range', range: { start, end: Math.min(end, size - 1) } };
}
