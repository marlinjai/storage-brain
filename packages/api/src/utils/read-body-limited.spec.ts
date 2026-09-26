import { describe, it, expect } from 'vitest';
import { BodyTooLargeError, declaredContentLength, readBodyWithLimit } from './read-body-limited';
import { countingStream } from '../test-utils/counting-stream';

function streamRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request('http://test/upload', {
    method: 'PUT',
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
}

describe('declaredContentLength', () => {
  it('parses a plain integer', () => {
    expect(
      declaredContentLength(new Request('http://t', { headers: { 'content-length': '42' } }))
    ).toBe(42);
  });

  it('treats an absent or malformed header as unknown', () => {
    expect(declaredContentLength(new Request('http://t'))).toBeNull();
    for (const bad of ['-1', '1e3', 'abc', '12abc', '99999999999999999999']) {
      expect(
        declaredContentLength(new Request('http://t', { headers: { 'content-length': bad } }))
      ).toBeNull();
    }
  });
});

describe('readBodyWithLimit', () => {
  it('rejects an oversized Content-Length without reading the body', async () => {
    const src = countingStream(10_000, 1_000);
    const req = streamRequest(src.stream, { 'content-length': '10000' });

    const err = await readBodyWithLimit(req, 5_000).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BodyTooLargeError);
    expect((err as BodyTooLargeError).declaredBytes).toBe(10_000);
    expect((err as BodyTooLargeError).limitBytes).toBe(5_000);
    expect(src.pulls).toBe(0);
  });

  it('cuts a body without Content-Length off at the limit and cancels the source', async () => {
    const src = countingStream(1_000_000, 1_000);
    const req = streamRequest(src.stream);

    const err = await readBodyWithLimit(req, 5_000).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BodyTooLargeError);
    expect((err as BodyTooLargeError).declaredBytes).toBeNull();
    // Six chunks cross the 5000-byte limit; never the whole megabyte.
    expect(src.bytesProduced).toBeLessThanOrEqual(6_000);
    expect(src.cancelled).toBe(true);
  });

  it('cuts off a body larger than the Content-Length it claimed', async () => {
    const src = countingStream(1_000_000, 1_000);
    const req = streamRequest(src.stream, { 'content-length': '100' });

    await expect(readBodyWithLimit(req, 5_000)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(src.bytesProduced).toBeLessThanOrEqual(6_000);
    expect(src.cancelled).toBe(true);
  });

  it('returns exactly the bytes of a body at the limit', async () => {
    const src = countingStream(5_000, 700, (offset, chunk) => {
      for (let i = 0; i < chunk.length; i++) chunk[i] = (offset + i) % 251;
    });
    const req = streamRequest(src.stream, { 'content-length': '5000' });

    const buf = await readBodyWithLimit(req, 5_000);

    expect(buf.byteLength).toBe(5_000);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== i % 251) throw new Error(`byte ${i} is ${bytes[i]}`);
    }
  });

  it('returns an empty buffer for a request without a body', async () => {
    const buf = await readBodyWithLimit(new Request('http://t', { method: 'PUT' }), 10);
    expect(buf.byteLength).toBe(0);
  });
});
