'use client';

import { useState } from 'react';
import { formatBytes, formatDate } from '@/lib/format';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

interface FileItem {
  id: string;
  originalName: string;
  fileType: string;
  sizeBytes: number;
  createdAt: string;
  signedUrl?: string;
  context?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
  workspaceId?: string;
}

interface FileDetailPanelProps {
  file: FileItem | null;
  tenantId: string;
  onClose: () => void;
  onDelete: (fileId: string) => void;
}

export function FileDetailPanel({
  file,
  tenantId,
  onClose,
  onDelete,
}: FileDetailPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!file) return null;

  const isImage = file.fileType.startsWith('image/');

  async function handleDelete() {
    if (!file) return;
    try {
      await fetch(`/api/tenants/${tenantId}/files/${file.id}`, {
        method: 'DELETE',
      });
      onDelete(file.id);
      setConfirmDelete(false);
    } catch {
      // silently fail for now
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-gray-800 bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2 className="truncate text-lg font-semibold text-gray-100">
            {file.originalName}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Preview */}
          {isImage && file.signedUrl && (
            <div className="overflow-hidden rounded-lg border border-gray-800">
              <img
                src={file.signedUrl}
                alt={file.originalName}
                className="w-full object-contain"
              />
            </div>
          )}

          {/* Metadata */}
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium text-gray-500">Type</span>
              <p className="text-sm text-gray-200">{file.fileType}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500">Size</span>
              <p className="text-sm text-gray-200">{formatBytes(file.sizeBytes)}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500">Created</span>
              <p className="text-sm text-gray-200">{formatDate(file.createdAt)}</p>
            </div>
            {file.context && (
              <div>
                <span className="text-xs font-medium text-gray-500">Context</span>
                <p className="text-sm text-gray-200">{file.context}</p>
              </div>
            )}
          </div>

          {/* Tags */}
          {file.tags && Object.keys(file.tags).length > 0 && (
            <div>
              <span className="mb-2 block text-xs font-medium text-gray-500">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(file.tags).map(([key, value]) => (
                  <span
                    key={key}
                    className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300"
                  >
                    {key}: {value}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Raw metadata */}
          {file.metadata && (
            <div>
              <span className="mb-2 block text-xs font-medium text-gray-500">
                Metadata
              </span>
              <pre className="overflow-x-auto rounded-lg bg-gray-800 p-3 font-mono text-xs text-gray-300">
                {JSON.stringify(file.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-gray-800 px-5 py-4">
          {file.signedUrl && (
            <a
              href={file.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Download
            </a>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-400 hover:bg-red-900/30"
          >
            Delete
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Delete File"
        message={`Are you sure you want to delete "${file.originalName}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
