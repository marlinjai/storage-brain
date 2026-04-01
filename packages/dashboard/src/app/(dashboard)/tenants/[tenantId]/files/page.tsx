'use client';

import { use, useState, useCallback } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { FileGrid } from '@/components/files/FileGrid';
import { FileFilters } from '@/components/files/FileFilters';
import { FileDetailPanel } from '@/components/files/FileDetailPanel';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import Link from 'next/link';

interface FileFiltersState {
  fileType?: string;
  context?: string;
  workspaceId?: string;
  search?: string;
}

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

export default function FilesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const [filters, setFilters] = useState<FileFiltersState>({});
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);

  const { files, isLoading, error, nextCursor, mutate } = useFiles(tenantId, filters);

  const handleDeleteFile = useCallback(
    async (file: FileItem) => {
      try {
        await fetch(`/api/tenants/${tenantId}/files/${file.id}`, {
          method: 'DELETE',
        });
        mutate();
        setDeleteTarget(null);
        if (selectedFile?.id === file.id) setSelectedFile(null);
      } catch {
        // silent
      }
    },
    [tenantId, mutate, selectedFile]
  );

  return (
    <div>
      <div className="mb-4">
        <Link
          href={`/tenants/${tenantId}`}
          className="text-sm text-gray-500 hover:text-gray-300"
        >
          &larr; Back to Tenant
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Files</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              viewMode === 'grid'
                ? 'bg-gray-700 text-gray-100'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              viewMode === 'list'
                ? 'bg-gray-700 text-gray-100'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            List
          </button>
        </div>
      </div>

      <div className="mb-6">
        <FileFilters filters={filters} onChange={setFilters} />
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading files...</p>}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400">
          Failed to load files
        </div>
      )}

      {files && files.length === 0 && !isLoading && (
        <p className="text-sm text-gray-500">No files found.</p>
      )}

      {files && files.length > 0 && viewMode === 'grid' && (
        <FileGrid
          files={files}
          onFileClick={(f) => setSelectedFile(f as FileItem)}
          onDeleteFile={(f) => setDeleteTarget(f as FileItem)}
        />
      )}

      {files && files.length > 0 && viewMode === 'list' && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-800 bg-gray-900/50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-400">Name</th>
                <th className="px-4 py-3 font-medium text-gray-400">Type</th>
                <th className="px-4 py-3 font-medium text-gray-400">Size</th>
                <th className="px-4 py-3 font-medium text-gray-400">Context</th>
                <th className="px-4 py-3 font-medium text-gray-400">Date</th>
                <th className="px-4 py-3 font-medium text-gray-400"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {files.map((file: FileItem) => (
                <tr
                  key={file.id}
                  className="cursor-pointer bg-gray-900 hover:bg-gray-800/50"
                  onClick={() => setSelectedFile(file)}
                >
                  <td className="px-4 py-3 text-gray-200">
                    {file.originalName}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                      {file.fileType.split('/')[1]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatBytesInline(file.sizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {file.context || '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDateInline(file.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(file);
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div className="mt-6 text-center">
          <button
            onClick={() => mutate()}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            Load More
          </button>
        </div>
      )}

      <FileDetailPanel
        file={selectedFile}
        tenantId={tenantId}
        onClose={() => setSelectedFile(null)}
        onDelete={() => {
          mutate();
          setSelectedFile(null);
        }}
      />

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete File"
        message={`Are you sure you want to delete "${deleteTarget?.originalName}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteTarget && handleDeleteFile(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function formatBytesInline(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDateInline(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
