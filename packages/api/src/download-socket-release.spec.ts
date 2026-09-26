import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { S3StorageAdapter } from './adapters/storage/s3';
import { createApp } from './app';
import { generatePermanentToken } from './services/signed-url';

// Incident 2026-09-26: every download answered 500 after 15 s with
// `socket usage at capacity=300 and 1707 additional requests are enqueued`,
// until a restart. The S3 socket pool was full of sockets whose response body
// nobody would ever read or destroy. These tests run the REAL stack (Hono on
// @hono/node-server, the real AWS SDK and its NodeHttpHandler) against a fake
// S3 server over real sockets, and assert that every way a download can end
// hands its upstream socket back.

const TENANT = 'aaaa1111-e29b-41d4-a716-446655440000';
const FILE = 'ffff1111-e29b-41d4-a716-446655440001';
const SECRET = 'test-secret';
// Large enough that the body can never fit in socket buffers, so an unread
// body really does pin its socket.
const SIZE = 32 * 1024 * 1024;
// The fake S3 holds its response headers this long, which is the window in
// which a client can give up before the route has a body to hand over.
const HEADER_DELAY_MS = 300;

let s3Server: http.Server;
let apiServer: ServerType;
let apiPort: number;
let storage: S3StorageAdapter;
let downloadPath: string;
let openUpstreamResponses = 0;
let upstreamMethods: string[] = [];

function socketsInUse(): number {
  const handler = (
    storage as unknown as {
      client: { config: { requestHandler: { config?: { httpAgent: http.Agent } } } };
    }
  ).client.config.requestHandler;
  const agent = handler.config?.httpAgent;
  if (!agent) return 0;
  return Object.values(agent.sockets).reduce((n, list) => n + (list?.length ?? 0), 0);
}

function held(): number {
  return Math.max(socketsInUse(), openUpstreamResponses);
}

/**
 * Poll until the pool is back where the scenario found it, or give up and
 * report how many sockets the scenario left behind. Measured against a
 * baseline so one leaking case cannot make the cases after it fail too.
 */
async function leakedSockets(baseline: number, timeoutMs = 3_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (held() <= baseline) return 0;
    await new Promise((r) => setTimeout(r, 25));
  }
  return held() - baseline;
}

function upstreamRequestSeen(): Promise<void> {
  return new Promise((resolve) => s3Server.once('request', () => resolve()));
}

beforeAll(async () => {
  s3Server = http.createServer((req, res) => {
    openUpstreamResponses++;
    upstreamMethods.push(req.method ?? '');
    res.on('close', () => {
      openUpstreamResponses--;
    });
    setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(SIZE),
        ETag: '"etag"',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const chunk = Buffer.alloc(64 * 1024, 1);
      let sent = 0;
      const pump = (): void => {
        while (sent < SIZE) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      pump();
    }, HEADER_DELAY_MS);
  });
  await new Promise<void>((resolve) => s3Server.listen(0, '127.0.0.1', resolve));
  const s3Port = (s3Server.address() as AddressInfo).port;

  storage = new S3StorageAdapter({
    bucket: 'bucket',
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${s3Port}`,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  const db = {
    getFileById: () =>
      Promise.resolve({
        id: FILE,
        tenantId: TENANT,
        originalName: 'clip.mp4',
        storedPath: `tenants/${TENANT}/files/${FILE}/clip.mp4`,
        fileType: 'video/mp4',
        sizeBytes: SIZE,
      }),
  };
  const app = createApp({
    storage,
    db: db as never,
    env: { URL_SIGNING_SECRET: SECRET, ADMIN_API_KEY: 'admin', ENVIRONMENT: 'development' },
  });
  apiServer = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => {
    if (apiServer.listening) resolve();
    else apiServer.once('listening', () => resolve());
  });
  apiPort = (apiServer.address() as AddressInfo).port;

  const token = await generatePermanentToken(FILE, TENANT, SECRET);
  downloadPath = `/api/v1/files/${FILE}/download?token=${encodeURIComponent(token)}&tid=${TENANT}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
  s3Server.closeAllConnections();
  await new Promise<void>((resolve) => s3Server.close(() => resolve()));
});

describe('download routes release their S3 socket (incident 2026-09-26)', () => {
  it('a client that gives up while GetObject is still pending does not strand the socket', async () => {
    const baseline = held();
    const seen = upstreamRequestSeen();
    const req = http.get({ port: apiPort, path: downloadPath });
    req.on('error', () => {});
    await seen;
    // Leave before S3 has answered: the route has no body to hand over yet.
    req.destroy();

    expect(await leakedSockets(baseline)).toBe(0);
  });

  it('a HEAD request is answered from the database row without reading the object', async () => {
    const baseline = held();
    upstreamMethods = [];
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request({ port: apiPort, path: downloadPath, method: 'HEAD' }, resolve);
      req.on('error', reject);
      req.end();
    });
    res.resume();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe(String(SIZE));
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(upstreamMethods).not.toContain('GET');
    expect(await leakedSockets(baseline)).toBe(0);
  });

  it('a client that disconnects mid-stream releases the socket', async () => {
    const baseline = held();
    await new Promise<void>((resolve, reject) => {
      const req = http.get({ port: apiPort, path: downloadPath }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', (err) => {
        if (!req.destroyed) reject(err);
      });
    });

    expect(await leakedSockets(baseline)).toBe(0);
  });

  it('a download read to the end delivers every byte and returns the socket to the pool', async () => {
    const baseline = held();
    const received = await new Promise<number>((resolve, reject) => {
      http
        .get({ port: apiPort, path: downloadPath }, (res) => {
          let bytes = 0;
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
          });
          res.on('end', () => resolve(bytes));
          res.on('error', reject);
        })
        .on('error', reject);
    });

    expect(received).toBe(SIZE);
    expect(await leakedSockets(baseline)).toBe(0);
  });
});
