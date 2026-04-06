import type { InfisicalConfig } from '@storage-brain/shared';

export interface InfisicalCredentials {
  clientId?: string;
  clientSecret?: string;
  siteUrl?: string;
}

/**
 * Push a new API key value to Infisical after key rotation.
 * Uses Universal Auth (machine identity) to authenticate.
 */
export async function pushKeyToInfisical(
  config: InfisicalConfig,
  newKeyValue: string,
  credentials: InfisicalCredentials,
): Promise<void> {
  const siteUrl = credentials.siteUrl || 'https://infisical.lumitra.co';

  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error('Infisical credentials not configured (INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET)');
  }

  // Step 1: Authenticate with Universal Auth
  const authRes = await fetch(`${siteUrl}/api/v1/auth/universal-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    }),
  });

  if (!authRes.ok) {
    const text = await authRes.text();
    throw new Error(`Infisical auth failed (${authRes.status}): ${text}`);
  }

  const { accessToken } = (await authRes.json()) as { accessToken: string };

  // Step 2: Update the secret value
  const updateRes = await fetch(
    `${siteUrl}/api/v3/secrets/raw/${encodeURIComponent(config.secretName)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        workspaceId: config.projectId,
        environment: config.environment,
        secretPath: config.secretPath,
        secretValue: newKeyValue,
      }),
    },
  );

  if (!updateRes.ok) {
    const text = await updateRes.text();
    throw new Error(`Infisical secret update failed (${updateRes.status}): ${text}`);
  }
}
