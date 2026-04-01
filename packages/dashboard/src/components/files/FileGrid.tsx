'use client';

import { formatBytes, formatDate } from '@/lib/format';

interface FileItem {
  id: string;
  originalName: string;
  fileType: string;
  sizeBytes: number;
  createdAt: string;
  signedUrl?: string;
}

interface FileGridProps {
  files: FileItem[];
  onFileClick: (file: FileItem) => void;
  onDeleteFile: (file: FileItem) => void;
}

function isImage(fileType: string) {
  return fileType.startsWith('image/');
}

function FileTypeIcon({ fileType }: { fileType: string }) {
  const ext = fileType.split('/')[1]?.toUpperCase() || 'FILE';
  return (
    <div className="flex h-full items-center justify-center bg-gray-800 text-2xl font-bold text-gray-500">
      {ext}
    </div>
  );
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
            {isImage(file.fileType) && file.signedUrl ? (
              <img
                src={file.signedUrl}
                alt={file.originalName}
                className="h-full w-full object-cover"
              />
            ) : (
              <FileTypeIcon fileType={file.fileType} />
            )}
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
