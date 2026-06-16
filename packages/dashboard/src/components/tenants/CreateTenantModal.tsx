'use client';

import { useState, type FormEvent } from 'react';

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

interface CreateTenantModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTenantModal({ open, onClose, onCreated }: CreateTenantModalProps) {
  const [name, setName] = useState('');
  const [quotaMB, setQuotaMB] = useState(500);
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [authWorkspaceId, setAuthWorkspaceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  function toggleType(type: string) {
    setAllowedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          quotaBytes: quotaMB * 1024 * 1024,
          allowedFileTypes: allowedTypes.length > 0 ? allowedTypes : undefined,
          authWorkspaceId: authWorkspaceId.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create tenant');
        return;
      }

      const data = await res.json();
      setCreatedKey(data.apiKey);
      onCreated();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleClose() {
    setName('');
    setQuotaMB(500);
    setAllowedTypes([]);
    setAuthWorkspaceId('');
    setError('');
    setCreatedKey(null);
    setCopied(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
        {createdKey ? (
          <>
            <h2 className="mb-2 text-lg font-semibold text-gray-100">
              Tenant Created
            </h2>
            <p className="mb-4 text-sm text-gray-400">
              Copy this API key now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2 rounded-lg bg-gray-800 p-3">
              <code className="flex-1 break-all font-mono text-sm text-gray-200">
                {createdKey}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleClose}
                className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-4 text-lg font-semibold text-gray-100">
              Create Tenant
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Tenant name"
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
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">
                  Auth Workspace ID (optional)
                </label>
                <input
                  type="text"
                  value={authWorkspaceId}
                  onChange={(e) => setAuthWorkspaceId(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="auth-brain workspace id"
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

              {error && (
                <div className="rounded-lg border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create Tenant'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
