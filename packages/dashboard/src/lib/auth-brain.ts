import {
  createAuthBrainClient,
  type AuthBrainClient,
} from '@marlinjai/auth-brain-sdk';

/**
 * Lazily-built singleton auth-brain client (mirrors the analytics-platform
 * pattern). The dashboard runs on the Node runtime, so the SDK's fetch-based
 * client is fine here. All config comes from server-only env vars; nothing here
 * is ever sent to the client bundle.
 */
let cachedClient: AuthBrainClient | null = null;

export function getAuthBrainClient(): AuthBrainClient {
  if (cachedClient) return cachedClient;

  cachedClient = createAuthBrainClient({
    baseUrl: process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co',
    openfgaUrl: process.env.OPENFGA_API_URL,
    openfgaStoreId: process.env.OPENFGA_STORE_ID,
    openfgaModelId: process.env.OPENFGA_MODEL_ID,
    openfgaToken: process.env.OPENFGA_API_TOKEN,
  });

  return cachedClient;
}
