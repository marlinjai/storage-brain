'use client';

import type { FileContextAggregate } from '@marlinjai/storage-brain-sdk/admin';
import { formatBytes } from '@/lib/format';

interface FolderGridProps {
  contexts: FileContextAggregate[];
  /** The context currently applied to the file list, or undefined for "all". */
  activeContext?: string;
  onSelect: (context: string | undefined) => void;
}

const cardBase =
  'flex flex-col gap-2 rounded-xl border bg-gray-900 p-4 text-left transition-colors';
const cardActive = 'border-blue-500 ring-1 ring-blue-500';
const cardIdle = 'border-gray-800 hover:border-gray-700';

function FolderIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={`h-6 w-6 ${active ? 'text-blue-400' : 'text-gray-500'}`}
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function FolderGrid({ contexts, activeContext, onSelect }: FolderGridProps) {
  if (contexts.length === 0) return null;

  const totalFiles = contexts.reduce((sum, c) => sum + c.fileCount, 0);
  const totalBytes = contexts.reduce((sum, c) => sum + c.totalBytes, 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <button
        type="button"
        onClick={() => onSelect(undefined)}
        className={`${cardBase} ${!activeContext ? cardActive : cardIdle}`}
      >
        <FolderIcon active={!activeContext} />
        <div>
          <p className="truncate text-sm font-medium text-gray-100">All files</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {totalFiles} file{totalFiles !== 1 ? 's' : ''} · {formatBytes(totalBytes)}
          </p>
        </div>
      </button>

      {contexts.map((c) => {
        const active = activeContext === c.context;
        return (
          <button
            key={c.context}
            type="button"
            onClick={() => onSelect(c.context)}
            className={`${cardBase} ${active ? cardActive : cardIdle}`}
          >
            <FolderIcon active={active} />
            <div>
              <p className="truncate text-sm font-medium text-gray-100" title={c.context}>
                {c.context}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {c.fileCount} file{c.fileCount !== 1 ? 's' : ''} · {formatBytes(c.totalBytes)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
