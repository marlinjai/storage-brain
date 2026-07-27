import { describe, it, expect } from 'vitest';
import {
  signErasureBody,
  verifyErasureSignature,
  ERASURE_SIGNATURE_HEADER,
  ERASURE_EVENT_ID_HEADER,
} from './signature';

const SECRET = 'erasure-signing-secret';
const BODY = '{"event_id":"evt-1","kind":"tenant.erased","user_id":"u-1","tenant_id":"c-1","requested_at":"2026-07-27T00:00:00.000Z"}';

describe('erasure signature', () => {
  it('signs as sha256=<hex> and round-trips through verify', async () => {
    const sig = await signErasureBody(BODY, SECRET);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await verifyErasureSignature(BODY, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const sig = await signErasureBody(BODY, SECRET);
    expect(await verifyErasureSignature(BODY + ' ', sig, SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', async () => {
    const sig = await signErasureBody(BODY, 'other-secret');
    expect(await verifyErasureSignature(BODY, sig, SECRET)).toBe(false);
  });

  it('rejects a missing, empty, or unprefixed header without throwing', async () => {
    expect(await verifyErasureSignature(BODY, undefined, SECRET)).toBe(false);
    expect(await verifyErasureSignature(BODY, null, SECRET)).toBe(false);
    expect(await verifyErasureSignature(BODY, '', SECRET)).toBe(false);
    expect(await verifyErasureSignature(BODY, 'deadbeef', SECRET)).toBe(false);
  });

  it('rejects a malformed hex payload without throwing', async () => {
    expect(await verifyErasureSignature(BODY, 'sha256=', SECRET)).toBe(false);
    expect(await verifyErasureSignature(BODY, 'sha256=zz', SECRET)).toBe(false);
    expect(await verifyErasureSignature(BODY, 'sha256=abc', SECRET)).toBe(false); // odd length
  });

  it('exposes the header names both sides agree on', () => {
    expect(ERASURE_SIGNATURE_HEADER).toBe('x-lumitra-erasure-signature');
    expect(ERASURE_EVENT_ID_HEADER).toBe('x-lumitra-erasure-event-id');
  });
});
