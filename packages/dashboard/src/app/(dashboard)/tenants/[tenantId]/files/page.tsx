'use client';

import { use, useState, useCallback, useEffect } from 'react';
import { useFiles } from '@/hooks/useFiles';
import { FileGrid } from '@/components/files/FileGrid';
import { FileFilters } from '@/components/files/FileFilters';
import { FileDetailPanel } from '@/components/files/FileDetailPanel';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { UploadDialog } from '@/components/files/UploadDialog';


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
  url?: string;
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
  const [uploadOpen, setUploadOpen] = useState(false);

  const { files, isLoading, isLoadingMore, error, hasMore, loadMore, setSize, mutate } =
    useFiles<FileItem>(tenantId, filters);

  // Reset to the first page whenever the filters change, otherwise the
  // accumulated pages would keep refetching under the new filter.
  useEffect(() => {
    setSize(1);
  }, [filters, setSize]);

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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Files</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setUploadOpen(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Upload
          </button>
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

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={() => loadMore()}
            disabled={isLoadingMore}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoadingMore ? 'Loading...' : 'Load More'}
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

      <UploadDialog
        open={uploadOpen}
        tenantId={tenantId}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => mutate()}
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
