'use client';

import { formatBytes, formatDate } from '@/lib/format';
import { useSignedUrl } from '@/hooks/useSignedUrl';

interface FileItem {
  id: string;
  originalName: string;
  fileType: string;
  sizeBytes: number;
  createdAt: string;
}

interface FileGridProps {
  files: FileItem[];
  tenantId: string;
  onFileClick: (file: FileItem) => void;
  onDeleteFile: (file: FileItem) => void;
}

function isPreviewable(fileType: string) {
  return fileType.startsWith('image/') || fileType === 'application/pdf';
}

function FileTypeIcon({ fileType }: { fileType: string }) {
  const ext = fileType.split('/')[1]?.toUpperCase() || 'FILE';
  return (
    <div className="flex h-full items-center justify-center bg-gray-800 text-2xl font-bold text-gray-500">
      {ext}
    </div>
  );
}

function FilePreview({
  file,
  tenantId,
}: {
  file: FileItem;
  tenantId: string;
}) {
  const { url } = useSignedUrl(
    tenantId,
    isPreviewable(file.fileType) ? file.id : undefined,
  );

  const inlineUrl = url ? `${url}${url.includes('?') ? '&' : '?'}disposition=inline` : '';

  if (file.fileType.startsWith('image/') && url) {
    return (
      <img
        src={inlineUrl}
        alt={file.originalName}
        className="h-full w-full object-cover"
      />
    );
  }

  if (file.fileType === 'application/pdf' && url) {
    return (
      <iframe
        src={`${inlineUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
        className="pointer-events-none h-full w-full"
        title={file.originalName}
      />
    );
  }

  return <FileTypeIcon fileType={file.fileType} />;
}

export function FileGrid({ files, tenantId, onFileClick, onDeleteFile }: FileGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {files.map((file) => (
        <div
          key={file.id}
          className="group cursor-pointer overflow-hidden rounded-xl border border-gray-800 bg-gray-900 transition-colors hover:border-gray-700"
        >
          <div
            className="relative aspect-[4/3] overflow-hidden"
            onClick={() => onFileClick(file)}
          >
            <FilePreview file={file} tenantId={tenantId} />
          </div>
          <div className="p-3" onClick={() => onFileClick(file)}>
            <p className="truncate text-sm font-medium text-gray-200">
              {file.originalName}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                {file.fileType.split('/')[1]}
              </span>
              <span className="text-xs text-gray-500">
                {formatBytes(file.sizeBytes)}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {formatDate(file.createdAt)}
            </p>
          </div>
          <div className="flex border-t border-gray-800 px-3 py-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFile(file);
              }}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
