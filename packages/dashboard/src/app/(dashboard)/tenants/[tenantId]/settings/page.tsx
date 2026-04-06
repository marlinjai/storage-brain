'use client';

import { use, useState, useEffect, type FormEvent } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const FILE_TYPE_OPTIONS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'text/plain',
];

interface RotationConfig {
  infisical?: {
    projectId: string;
    environment: string;
    secretPath: string;
    secretName: string;
  };
  deploy?: {
    type: 'coolify' | 'vercel';
    appUuid?: string;
    projectId?: string;
    deployHookUrl?: string;
  };
}

interface RotationStatus {
  keyRotated: boolean;
  gracePeriodSeconds: number;
  infisicalPush: 'success' | 'failed' | null;
  infisicalError?: string;
  deployTrigger: 'success' | 'failed' | null;
  deployError?: string;
}

export default function TenantSettingsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const router = useRouter();
  const { data: tenant, isLoading, mutate } = useSWR(
    `/api/tenants/${tenantId}`,
    fetcher
  );

  const [name, setName] = useState('');
  const [quotaMB, setQuotaMB] = useState(500);
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [gracePeriod, setGracePeriod] = useState(600);
  const [rotationResult, setRotationResult] = useState<RotationStatus | null>(null);

  // Rotation config state
  const [rotationConfig, setRotationConfig] = useState<RotationConfig | null>(null);
  const [savingRotation, setSavingRotation] = useState(false);
  const [rotationMsg, setRotationMsg] = useState('');

  // Infisical config fields
  const [infProjectId, setInfProjectId] = useState('');
  const [infEnvironment, setInfEnvironment] = useState('prod');
  const [infSecretPath, setInfSecretPath] = useState('/');
  const [infSecretName, setInfSecretName] = useState('STORAGE_BRAIN_API_KEY');

  // Deploy config fields
  const [deployType, setDeployType] = useState<'none' | 'coolify' | 'vercel'>('none');
  const [coolifyAppUuid, setCoolifyAppUuid] = useState('');
  const [vercelProjectId, setVercelProjectId] = useState('');
  const [vercelDeployHookUrl, setVercelDeployHookUrl] = useState('');

  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (tenant) {
      setName(tenant.name || '');
      setQuotaMB(Math.round((tenant.quotaBytes || 0) / (1024 * 1024)));
      setAllowedTypes(tenant.allowedFileTypes || []);

      // Load rotation config
      const rc = tenant.rotationConfig as RotationConfig | null;
      setRotationConfig(rc);
      if (rc?.infisical) {
        setInfProjectId(rc.infisical.projectId);
        setInfEnvironment(rc.infisical.environment);
        setInfSecretPath(rc.infisical.secretPath);
        setInfSecretName(rc.infisical.secretName);
      }
      if (rc?.deploy) {
        setDeployType(rc.deploy.type);
        if (rc.deploy.type === 'coolify' && rc.deploy.appUuid) {
          setCoolifyAppUuid(rc.deploy.appUuid);
        }
        if (rc.deploy.type === 'vercel') {
          if (rc.deploy.projectId) setVercelProjectId(rc.deploy.projectId);
          if (rc.deploy.deployHookUrl) setVercelDeployHookUrl(rc.deploy.deployHookUrl);
        }
      }
    }
  }, [tenant]);

  function toggleType(type: string) {
    setAllowedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg('');

    try {
      const res = await fetch(`/api/tenants/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          quotaBytes: quotaMB * 1024 * 1024,
          allowedFileTypes: allowedTypes.length > 0 ? allowedTypes : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveMsg(data.error || 'Failed to save');
        return;
      }

      setSaveMsg('Settings saved');
      mutate();
    } catch {
      setSaveMsg('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateKey() {
    setRegenerating(true);
    setRotationResult(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/regenerate-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gracePeriodSeconds: gracePeriod }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewKey(data.apiKey);
        setRotationResult(data.rotation);
        mutate();
      }
    } catch {
      // silent
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSaveRotationConfig(e: FormEvent) {
    e.preventDefault();
    setSavingRotation(true);
    setRotationMsg('');

    const config: RotationConfig = {};

    if (infProjectId) {
      config.infisical = {
        projectId: infProjectId,
        environment: infEnvironment,
        secretPath: infSecretPath,
        secretName: infSecretName,
      };
    }

    if (deployType === 'coolify' && coolifyAppUuid) {
      config.deploy = { type: 'coolify', appUuid: coolifyAppUuid };
    } else if (deployType === 'vercel' && vercelDeployHookUrl) {
      config.deploy = { type: 'vercel', projectId: vercelProjectId, deployHookUrl: vercelDeployHookUrl };
    }

    const hasConfig = config.infisical || config.deploy;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/rotation-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotationConfig: hasConfig ? config : null }),
      });

      if (!res.ok) {
        setRotationMsg('Failed to save rotation config');
        return;
      }

      setRotationMsg('Rotation config saved');
      setRotationConfig(hasConfig ? config : null);
      mutate();
    } catch {
      setRotationMsg('Network error');
    } finally {
      setSavingRotation(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/tenants/${tenantId}`, { method: 'DELETE' });
      router.push('/tenants');
    } catch {
      setDeleting(false);
    }
  }

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading settings...</div>;
  }

  const inputClass =
    'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

  const hasRotationPipeline = rotationConfig?.infisical || rotationConfig?.deploy;

  return (
    <div>
      <div className="mb-6">
        <a
          href={`/tenants/${tenantId}`}
          className="text-sm text-gray-500 hover:text-gray-300"
        >
          &larr; Back to Tenant
        </a>
      </div>

      <h1 className="mb-8 text-2xl font-bold text-gray-100">
        Tenant Settings
      </h1>

      {/* Settings form */}
      <form
        onSubmit={handleSave}
        className="mb-10 max-w-lg space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-6"
      >
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            Quota (MB)
          </label>
          <input
            type="number"
            value={quotaMB}
            onChange={(e) => setQuotaMB(Number(e.target.value))}
            min={1}
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            Allowed File Types
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            {FILE_TYPE_OPTIONS.map((type) => (
              <label
                key={type}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300"
              >
                <input
                  type="checkbox"
                  checked={allowedTypes.includes(type)}
                  onChange={() => toggleType(type)}
                  className="accent-blue-600"
                />
                {type.split('/')[1]}
              </label>
            ))}
          </div>
        </div>

        {saveMsg && (
          <p
            className={`text-sm ${
              saveMsg === 'Settings saved' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {saveMsg}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      {/* Key Rotation */}
      <div className="mb-10 max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-100">Key Rotation</h2>

        <div className="mb-4">
          {tenant?.keyPrefix ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Current key:</span>
              <code className="font-mono text-sm text-gray-300">
                {tenant.keyPrefix}****
              </code>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">
              Key prefix unavailable — rotate to enable
            </p>
          )}
        </div>

        {hasRotationPipeline && (
          <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800 p-3 text-xs text-gray-400">
            <div className="mb-1 font-medium text-gray-300">Automated pipeline active:</div>
            {rotationConfig?.infisical && (
              <div>Infisical: {rotationConfig.infisical.secretName} @ {rotationConfig.infisical.secretPath}</div>
            )}
            {rotationConfig?.deploy && (
              <div>Deploy: {rotationConfig.deploy.type} {rotationConfig.deploy.type === 'coolify' ? rotationConfig.deploy.appUuid : ''}</div>
            )}
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            Grace Period (seconds)
          </label>
          <select
            value={gracePeriod}
            onChange={(e) => setGracePeriod(Number(e.target.value))}
            className={inputClass}
          >
            <option value={0}>None (immediate invalidation)</option>
            <option value={300}>5 minutes</option>
            <option value={600}>10 minutes (recommended)</option>
            <option value={1800}>30 minutes</option>
            <option value={3600}>1 hour</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Old key remains valid during this window.
          </p>
        </div>

        {newKey && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-800 p-3">
            <code className="flex-1 break-all font-mono text-sm text-gray-200">
              {newKey}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(newKey);
                setKeyCopied(true);
                setTimeout(() => setKeyCopied(false), 2000);
              }}
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              {keyCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        {rotationResult && (
          <div className="mb-4 space-y-1 rounded-lg border border-gray-700 bg-gray-800 p-3">
            <div className="text-xs font-medium text-gray-300">Rotation Status</div>
            <StatusLine label="Key rotated" status={rotationResult.keyRotated ? 'success' : 'failed'} />
            {rotationResult.gracePeriodSeconds > 0 && (
              <div className="text-xs text-gray-500">
                Old key valid for {rotationResult.gracePeriodSeconds}s
              </div>
            )}
            {rotationResult.infisicalPush !== null && (
              <StatusLine
                label="Infisical push"
                status={rotationResult.infisicalPush}
                error={rotationResult.infisicalError}
              />
            )}
            {rotationResult.deployTrigger !== null && (
              <StatusLine
                label="Deploy trigger"
                status={rotationResult.deployTrigger}
                error={rotationResult.deployError}
              />
            )}
          </div>
        )}

        <button
          onClick={handleRotateKey}
          disabled={regenerating}
          className="rounded-lg border border-yellow-700 px-4 py-2 text-sm text-yellow-400 hover:bg-yellow-900/20 disabled:opacity-50"
        >
          {regenerating ? 'Rotating...' : hasRotationPipeline ? 'Rotate Key (Full Pipeline)' : 'Rotate Key'}
        </button>
      </div>

      {/* Rotation Config */}
      <form
        onSubmit={handleSaveRotationConfig}
        className="mb-10 max-w-lg space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-6"
      >
        <h2 className="mb-1 text-lg font-semibold text-gray-100">Rotation Pipeline Config</h2>
        <p className="mb-4 text-sm text-gray-400">
          Configure where new keys are pushed and how to redeploy the consumer.
        </p>

        {/* Infisical */}
        <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <div className="text-sm font-medium text-gray-300">Infisical Push</div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Project ID</label>
            <input
              type="text"
              value={infProjectId}
              onChange={(e) => setInfProjectId(e.target.value)}
              placeholder="a510e5be-..."
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Environment</label>
              <input
                type="text"
                value={infEnvironment}
                onChange={(e) => setInfEnvironment(e.target.value)}
                placeholder="prod"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Secret Name</label>
              <input
                type="text"
                value={infSecretName}
                onChange={(e) => setInfSecretName(e.target.value)}
                placeholder="STORAGE_BRAIN_API_KEY"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Secret Path</label>
            <input
              type="text"
              value={infSecretPath}
              onChange={(e) => setInfSecretPath(e.target.value)}
              placeholder="/apps/api"
              className={inputClass}
            />
          </div>
        </div>

        {/* Deploy */}
        <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <div className="text-sm font-medium text-gray-300">Deploy Trigger</div>
          <select
            value={deployType}
            onChange={(e) => setDeployType(e.target.value as 'none' | 'coolify' | 'vercel')}
            className={inputClass}
          >
            <option value="none">None</option>
            <option value="coolify">Coolify</option>
            <option value="vercel">Vercel</option>
          </select>

          {deployType === 'coolify' && (
            <div>
              <label className="mb-1 block text-xs text-gray-400">App UUID</label>
              <input
                type="text"
                value={coolifyAppUuid}
                onChange={(e) => setCoolifyAppUuid(e.target.value)}
                placeholder="xsstyh7y5xvkfo13dyg0kvfc"
                className={inputClass}
              />
            </div>
          )}

          {deployType === 'vercel' && (
            <>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Project ID</label>
                <input
                  type="text"
                  value={vercelProjectId}
                  onChange={(e) => setVercelProjectId(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Deploy Hook URL</label>
                <input
                  type="text"
                  value={vercelDeployHookUrl}
                  onChange={(e) => setVercelDeployHookUrl(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}
        </div>

        {rotationMsg && (
          <p
            className={`text-sm ${
              rotationMsg.includes('saved') ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {rotationMsg}
          </p>
        )}

        <button
          type="submit"
          disabled={savingRotation}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {savingRotation ? 'Saving...' : 'Save Rotation Config'}
        </button>
      </form>

      {/* Danger zone */}
      <div className="max-w-lg rounded-xl border border-red-900/50 bg-gray-900 p-6">
        <h2 className="mb-3 text-lg font-semibold text-red-400">
          Danger Zone
        </h2>
        <p className="mb-4 text-sm text-gray-400">
          Permanently delete this tenant and all associated files.
        </p>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Delete Tenant
        </button>
      </div>

      <ConfirmModal
        open={showDelete}
        title="Delete Tenant"
        message={`Are you sure you want to delete "${tenant?.name}"? All files and workspaces will be permanently removed.`}
        confirmLabel={deleting ? 'Deleting...' : 'Delete Tenant'}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}

function StatusLine({
  label,
  status,
  error,
}: {
  label: string;
  status: 'success' | 'failed' | null;
  error?: string;
}) {
  const color = status === 'success' ? 'text-green-400' : status === 'failed' ? 'text-red-400' : 'text-gray-500';
  const icon = status === 'success' ? '\u2713' : status === 'failed' ? '\u2717' : '\u2022';

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={color}>{icon}</span>
      <span className="text-gray-300">{label}</span>
      {error && <span className="text-red-400">({error})</span>}
    </div>
  );
}
