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

  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (tenant) {
      setName(tenant.name || '');
      setQuotaMB(Math.round((tenant.quotaBytes || 0) / (1024 * 1024)));
      setAllowedTypes(tenant.allowedFileTypes || []);
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

  async function handleRegenerateKey() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/regenerate-key`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setNewKey(data.apiKey);
        mutate(); // Refresh tenant data to pick up new keyPrefix
      }
    } catch {
      // silent
    } finally {
      setRegenerating(false);
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

      {/* API Key */}
      <div className="mb-10 max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-100">API Key</h2>
        <p className="mb-4 text-sm text-gray-400">
          Regenerate the tenant API key. The old key will be invalidated immediately.
        </p>

        <div className="mb-4">
          {tenant?.keyPrefix ? (
            <code className="font-mono text-sm text-gray-300">
              {tenant.keyPrefix}****
            </code>
          ) : (
            <p className="text-sm text-gray-500 italic">
              Key prefix unavailable — regenerate to enable
            </p>
          )}
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

        <button
          onClick={handleRegenerateKey}
          disabled={regenerating}
          className="rounded-lg border border-yellow-700 px-4 py-2 text-sm text-yellow-400 hover:bg-yellow-900/20 disabled:opacity-50"
        >
          {regenerating ? 'Regenerating...' : 'Regenerate API Key'}
        </button>
      </div>

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
