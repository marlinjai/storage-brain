'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  uploadFile,
  UploadCanceledError,
  UPLOAD_MESSAGES,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/upload-file';

interface Workspace {
  id: string;
  name: string;
}

interface UploadDialogProps {
  open: boolean;
  tenantId: string;
  onClose: () => void;
  /** Called after at least one file uploaded successfully (refresh the list). */
  onUploaded: () => void;
}

type RowStatus = 'pending' | 'uploading' | 'done' | 'error' | 'canceled';

interface QueueRow {
  key: string;
  file: File;
  progress: number;
  status: RowStatus;
  error?: string;
  controller?: AbortController;
}

let rowSeq = 0;

function parseTags(input: string): Record<string, string> | undefined {
  const entries = input
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(':');
      if (idx === -1) return null;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      return key ? ([key, value] as const) : null;
    })
    .filter((e): e is readonly [string, string] => e !== null);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function UploadDialog({ open, tenantId, onClose, onUploaded }: UploadDialogProps) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [context, setContext] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/tenants/${tenantId}/workspaces`)
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ workspaces?: Workspace[] }>)
          : { workspaces: [] }
      )
      .then((data) => {
        if (!cancelled) setWorkspaces(data.workspaces ?? []);
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tenantId]);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).map((file) => ({
      key: `row-${rowSeq++}`,
      file,
      progress: 0,
      status: file.size > MAX_FILE_SIZE_BYTES ? ('error' as RowStatus) : ('pending' as RowStatus),
      error: file.size > MAX_FILE_SIZE_BYTES ? UPLOAD_MESSAGES.tooLarge : undefined,
    }));
    setRows((prev) => [...prev, ...incoming]);
  }, []);

  const patchRow = useCallback((key: string, patch: Partial<QueueRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const handleUploadAll = useCallback(async () => {
    const pending = rows.filter((r) => r.status === 'pending');
    if (pending.length === 0) return;

    setBusy(true);
    let anySucceeded = false;
    const meta = {
      context: context.trim() || undefined,
      tags: parseTags(tagsInput),
      workspaceId: workspaceId || undefined,
    };

    for (const row of pending) {
      const controller = new AbortController();
      patchRow(row.key, { status: 'uploading', progress: 0, error: undefined, controller });
      try {
        await uploadFile({
          tenantId,
          file: row.file,
          meta,
          signal: controller.signal,
          onProgress: (percent) => patchRow(row.key, { progress: percent }),
        });
        patchRow(row.key, { status: 'done', progress: 100, controller: undefined });
        anySucceeded = true;
      } catch (err) {
        if (err instanceof UploadCanceledError) {
          patchRow(row.key, { status: 'canceled', error: UPLOAD_MESSAGES.canceled, controller: undefined });
        } else {
          const message = err instanceof Error ? err.message : UPLOAD_MESSAGES.generic;
          patchRow(row.key, { status: 'error', error: message, controller: undefined });
        }
      }
    }

    setBusy(false);
    if (anySucceeded) onUploaded();
  }, [rows, context, tagsInput, workspaceId, tenantId, patchRow, onUploaded]);

  const cancelRow = useCallback(
    (key: string) => {
      const row = rows.find((r) => r.key === key);
      row?.controller?.abort();
    },
    [rows]
  );

  const removeRow = useCallback((key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  function handleClose() {
    if (busy) return;
    rows.forEach((r) => r.controller?.abort());
    setRows([]);
    setContext('');
    setTagsInput('');
    setWorkspaceId('');
    setDragging(false);
    onClose();
  }

  if (!open) return null;

  const hasPending = rows.some((r) => r.status === 'pending');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-100">Upload Files</h2>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition-colors ${
            dragging
              ? 'border-blue-500 bg-blue-900/10 text-blue-300'
              : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
          }`}
        >
          <p>Drag and drop files here, or click to browse.</p>
          <p className="mt-1 text-xs text-gray-500">Up to 100 MB per file.</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              Workspace (optional)
            </label>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Tenant root</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              Context (optional)
            </label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. invoices"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            Tags (optional, key:value comma separated)
          </label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="env:prod, team:design"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {rows.length > 0 && (
          <ul className="mb-4 max-h-56 space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <li key={row.key} className="rounded-lg border border-gray-800 bg-gray-800/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-gray-200" title={row.file.name}>
                    {row.file.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.status === 'uploading' && (
                      <button
                        onClick={() => cancelRow(row.key)}
                        className="text-xs text-gray-400 hover:text-gray-200"
                      >
                        Cancel
                      </button>
                    )}
                    {(row.status === 'pending' ||
                      row.status === 'error' ||
                      row.status === 'canceled') && (
                      <button
                        onClick={() => removeRow(row.key)}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        Remove
                      </button>
                    )}
                    {row.status === 'done' && (
                      <span className="text-xs text-green-400">Done</span>
                    )}
                  </div>
                </div>

                {(row.status === 'uploading' || row.status === 'done') && (
                  <div className="mt-2 h-2 rounded-full bg-gray-800">
                    <div
                      className="h-2 rounded-full bg-blue-600 transition-all"
                      style={{ width: `${row.progress}%` }}
                    />
                  </div>
                )}

                {row.error && (
                  <p className="mt-2 rounded border border-red-800 bg-red-900/30 px-2 py-1 text-xs text-red-400">
                    {row.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleUploadAll()}
            disabled={busy || !hasPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
