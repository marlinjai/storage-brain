import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateSignedToken,
  verifySignedToken,
  generatePermanentToken,
  verifyPermanentToken,
} from './signed-url';

const SECRET = 'test-signing-secret';
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_ID = '660e8400-e29b-41d4-a716-446655440001';

describe('signed-url service', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateSignedToken', () => {
    it('generates a hex-encoded token', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);

      expect(token).toMatch(/^[0-9a-f]+$/);
      // HMAC-SHA256 produces 32 bytes = 64 hex chars
      expect(token.length).toBe(64);
    });

    it('produces different tokens for different fileIds', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token1 = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);
      const token2 = await generateSignedToken('other-file-id', TENANT_ID, expiresAt, SECRET);

      expect(token1).not.toBe(token2);
    });

    it('produces different tokens for different secrets', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token1 = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);
      const token2 = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, 'other-secret');

      expect(token1).not.toBe(token2);
    });

    it('produces different tokens for different expiry times', async () => {
      const token1 = await generateSignedToken(FILE_ID, TENANT_ID, Date.now() + 3600_000, SECRET);
      const token2 = await generateSignedToken(FILE_ID, TENANT_ID, Date.now() + 7200_000, SECRET);

      expect(token1).not.toBe(token2);
    });

    it('produces different tokens for different tenantIds', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token1 = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);
      const token2 = await generateSignedToken(FILE_ID, 'other-tenant', expiresAt, SECRET);

      expect(token1).not.toBe(token2);
    });
  });

  describe('verifySignedToken', () => {
    it('verifies a valid token', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);

      const valid = await verifySignedToken(FILE_ID, TENANT_ID, expiresAt, token, SECRET);
      expect(valid).toBe(true);
    });

    it('rejects an expired token', async () => {
      const expiresAt = Date.now() - 1000; // already expired
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);

      const valid = await verifySignedToken(FILE_ID, TENANT_ID, expiresAt, token, SECRET);
      expect(valid).toBe(false);
    });

    it('rejects token with wrong fileId', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);

      const valid = await verifySignedToken('wrong-id', TENANT_ID, expiresAt, token, SECRET);
      expect(valid).toBe(false);
    });

    it('rejects token with wrong tenantId', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);

      const valid = await verifySignedToken(FILE_ID, 'wrong-tenant', expiresAt, token, SECRET);
      expect(valid).toBe(false);
    });

    it('rejects token with wrong secret', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);

      const valid = await verifySignedToken(FILE_ID, TENANT_ID, expiresAt, token, 'wrong-secret');
      expect(valid).toBe(false);
    });

    it('rejects tampered token', async () => {
      const expiresAt = Date.now() + 3600_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, SECRET);
      const tampered = token.replace(/^./, token[0] === 'a' ? 'b' : 'a');

      const valid = await verifySignedToken(FILE_ID, TENANT_ID, expiresAt, tampered, SECRET);
      expect(valid).toBe(false);
    });
  });

  describe('generatePermanentToken', () => {
    it('generates a hex-encoded token', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);

      expect(token).toMatch(/^[0-9a-f]+$/);
      expect(token.length).toBe(64);
    });

    it('is deterministic — same inputs produce the same token', async () => {
      const token1 = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);
      const token2 = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);

      expect(token1).toBe(token2);
    });

    it('does NOT match a time-limited token with expires=0', async () => {
      // Permanent tokens use a distinct payload (":permanent") so they can't
      // be confused with a time-limited token that happens to use expires=0.
      const permanent = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);
      const timeLimited = await generateSignedToken(FILE_ID, TENANT_ID, 0, SECRET);

      expect(permanent).not.toBe(timeLimited);
    });

    it('produces different tokens for different secrets (rotation invalidates)', async () => {
      const token1 = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);
      const token2 = await generatePermanentToken(FILE_ID, TENANT_ID, 'rotated-secret');

      expect(token1).not.toBe(token2);
    });

    it('produces different tokens for different tenantIds', async () => {
      const token1 = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);
      const token2 = await generatePermanentToken(FILE_ID, 'other-tenant', SECRET);

      expect(token1).not.toBe(token2);
    });

    it('produces different tokens for different fileIds', async () => {
      const token1 = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);
      const token2 = await generatePermanentToken('other-file', TENANT_ID, SECRET);

      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyPermanentToken', () => {
    it('verifies a valid permanent token', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);

      const valid = await verifyPermanentToken(FILE_ID, TENANT_ID, token, SECRET);
      expect(valid).toBe(true);
    });

    it('never expires — still valid far in the future', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);

      // Jump 10 years forward.
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 10 * 365 * 24 * 3600 * 1000);

      const valid = await verifyPermanentToken(FILE_ID, TENANT_ID, token, SECRET);
      expect(valid).toBe(true);
    });

    it('rejects token after secret rotation', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);

      const valid = await verifyPermanentToken(FILE_ID, TENANT_ID, token, 'rotated-secret');
      expect(valid).toBe(false);
    });

    it('rejects token with wrong tenantId (cross-tenant defense)', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);

      const valid = await verifyPermanentToken(FILE_ID, 'other-tenant', token, SECRET);
      expect(valid).toBe(false);
    });

    it('rejects token with wrong fileId', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);

      const valid = await verifyPermanentToken('other-file', TENANT_ID, token, SECRET);
      expect(valid).toBe(false);
    });

    it('rejects tampered token', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, SECRET);
      const tampered = token.replace(/^./, token[0] === 'a' ? 'b' : 'a');

      const valid = await verifyPermanentToken(FILE_ID, TENANT_ID, tampered, SECRET);
      expect(valid).toBe(false);
    });

    it('does NOT accept a time-limited token (mode confusion defense)', async () => {
      // A token generated for the time-limited path must NOT verify against the
      // permanent path, even if a caller passes expires=0.
      const timeLimited = await generateSignedToken(FILE_ID, TENANT_ID, 0, SECRET);

      const valid = await verifyPermanentToken(FILE_ID, TENANT_ID, timeLimited, SECRET);
      expect(valid).toBe(false);
    });
  });
});
