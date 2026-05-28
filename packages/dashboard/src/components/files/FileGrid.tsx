'use client';

import { formatBytes, formatDate } from '@/lib/format';
import { isModel, withInlineDisposition } from '@/lib/fileTypes';
import { ModelViewer } from '@/components/files/ModelViewer';

interface FileItem {
  id: string;
  originalName: string;
  fileType: string;
  sizeBytes: number;
  createdAt: string;
  url?: string;
}

interface FileGridProps {
  files: FileItem[];
  onFileClick: (file: FileItem) => void;
  onDeleteFile: (file: FileItem) => void;
}

function FileTypeIcon({ fileType }: { fileType: string }) {
  const ext = fileType.split('/')[1]?.toUpperCase() || 'FILE';
  return (
    <div className="flex h-full items-center justify-center bg-gray-800 text-2xl font-bold text-gray-500">
      {ext}
    </div>
  );
}

function ModelBadge() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 bg-gray-800 text-gray-400">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-10 w-10"
      >
        <path d="M12 2 3 7v10l9 5 9-5V7z" />
        <path d="M3 7l9 5 9-5M12 12v10" />
      </svg>
      <span className="text-xs font-bold tracking-wide">3D</span>
    </div>
  );
}

function FilePreview({ file }: { file: FileItem }) {
  const url = file.url;
  const inlineUrl = url ? withInlineDisposition(url) : '';

  if (isModel(file.fileType, file.originalName)) {
    return inlineUrl ? (
      <ModelViewer url={inlineUrl} alt={file.originalName} interactive={false} />
    ) : (
      <ModelBadge />
    );
  }

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

export function FileGrid({ files, onFileClick, onDeleteFile }: FileGridProps) {
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
            <FilePreview file={file} />
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
