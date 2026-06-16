'use client';

import { use, useState, type FormEvent } from 'react';
import type { AdminWorkspace } from '@marlinjai/storage-brain-sdk/admin';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { QuotaBar } from '@/components/ui/QuotaBar';
import Link from 'next/link';

export default function WorkspacesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const { workspaces, isLoading, error, mutate } = useWorkspaces(tenantId);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    try {
      const res = await fetch(`/api/tenants/${tenantId}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug: slug || undefined }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty-string error message falls through to generic copy
        setCreateError(data.error || 'Failed to create workspace');
        return;
      }

      setName('');
      setSlug('');
      setShowCreate(false);
      void mutate();
    } catch {
      setCreateError('Network error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Workspaces</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Create Workspace
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-100">
              Create Workspace
            </h2>
            <form
              onSubmit={(e) => {
                void handleCreate(e);
              }}
              className="space-y-4"
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
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Workspace name"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">
                  Slug (optional)
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="workspace-slug"
                />
              </div>

              {createError && (
                <div className="rounded-lg border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-400">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoading && (
        <p className="text-sm text-gray-400">Loading workspaces...</p>
      )}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400">
          Failed to load workspaces
        </div>
      )}

      {workspaces && workspaces.length === 0 && !isLoading && (
        <p className="text-sm text-gray-500">No workspaces yet.</p>
      )}

      {workspaces && workspaces.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map(
            (ws: AdminWorkspace & { fileCount?: number }) => (
              <Link
                key={ws.id}
                href={`/tenants/${tenantId}/files?workspaceId=${ws.id}`}
                className="rounded-xl border border-gray-800 bg-gray-900 p-5 transition-colors hover:border-gray-700"
              >
                <h3 className="text-lg font-semibold text-gray-100">
                  {ws.name}
                </h3>
                {ws.slug && (
                  <p className="mt-0.5 text-xs text-gray-500">{ws.slug}</p>
                )}
                {ws.quotaBytes != null && ws.usedBytes != null && (
                  <div className="mt-3">
                    <QuotaBar
                      usedBytes={ws.usedBytes}
                      quotaBytes={ws.quotaBytes}
                    />
                  </div>
                )}
                {ws.fileCount != null && (
                  <p className="mt-2 text-xs text-gray-500">
                    {ws.fileCount} file{ws.fileCount !== 1 ? 's' : ''}
                  </p>
                )}
              </Link>
            )
          )}
        </div>
      )}
    </div>
  );
}
