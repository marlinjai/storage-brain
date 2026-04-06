import type { DeployConfig } from '@storage-brain/shared';

export interface DeployCredentials {
  coolifyToken?: string;
  coolifyUrl?: string;
}

/**
 * Trigger a redeployment of the consumer app after key rotation.
 */
export async function triggerDeploy(
  config: DeployConfig,
  credentials: DeployCredentials,
): Promise<void> {
  if (config.type === 'coolify') {
    return triggerCoolifyDeploy(config.appUuid, credentials);
  }

  if (config.type === 'vercel') {
    return triggerVercelDeploy(config.deployHookUrl);
  }

  throw new Error(`Unknown deploy type: ${(config as { type: string }).type}`);
}

async function triggerCoolifyDeploy(
  appUuid: string,
  credentials: DeployCredentials,
): Promise<void> {
  const coolifyUrl = credentials.coolifyUrl || 'https://coolify.lumitra.co';

  if (!credentials.coolifyToken) {
    throw new Error('Coolify API token not configured (COOLIFY_API_TOKEN)');
  }

  const res = await fetch(`${coolifyUrl}/api/v1/applications/${appUuid}/restart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.coolifyToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coolify deploy failed (${res.status}): ${text}`);
  }
}

async function triggerVercelDeploy(deployHookUrl: string): Promise<void> {
  const res = await fetch(deployHookUrl, { method: 'POST' });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel deploy hook failed (${res.status}): ${text}`);
  }
}
