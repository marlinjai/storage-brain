'use client';

import type { FileContextAggregate } from '@marlinjai/storage-brain-sdk/admin';
import { useWorkspaces } from '@/hooks/useWorkspaces';

interface FileFiltersState {
  fileType?: string;
  context?: string;
  workspaceId?: string;
  search?: string;
}

interface FileFiltersProps {
  tenantId: string;
  filters: FileFiltersState;
  /** Context aggregate used to populate the context ("folder") select. */
  contexts: FileContextAggregate[];
  onChange: (filters: FileFiltersState) => void;
}

const FILE_TYPES = [
  { label: 'All Types', value: '' },
  { label: 'Images', value: 'image' },
  { label: 'PDF', value: 'application/pdf' },
  { label: 'Audio', value: 'audio' },
  { label: 'Video', value: 'video' },
  { label: 'Text', value: 'text' },
];

const inputClass =
  'rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export function FileFilters({ tenantId, filters, contexts, onChange }: FileFiltersProps) {
  const { workspaces } = useWorkspaces(tenantId);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {workspaces.length > 0 && (
        <select
          value={filters.workspaceId ?? ''}
          // Switching workspace clears the context filter, since a context may
          // not exist in the newly selected workspace.
          onChange={(e) =>
            onChange({
              ...filters,
              workspaceId: e.target.value || undefined,
              context: undefined,
            })
          }
          className={inputClass}
        >
          <option value="">All workspaces</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>
      )}

      <select
        value={filters.fileType ?? ''}
        onChange={(e) => onChange({ ...filters, fileType: e.target.value || undefined })}
        className={inputClass}
      >
        {FILE_TYPES.map((ft) => (
          <option key={ft.value} value={ft.value}>
            {ft.label}
          </option>
        ))}
      </select>

      <select
        value={filters.context ?? ''}
        onChange={(e) => onChange({ ...filters, context: e.target.value || undefined })}
        className={inputClass}
      >
        <option value="">All contexts</option>
        {contexts.map((c) => (
          <option key={c.context} value={c.context}>
            {c.context} ({c.fileCount})
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Search by name..."
        value={filters.search ?? ''}
        onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
        className={inputClass}
      />
    </div>
  );
}
