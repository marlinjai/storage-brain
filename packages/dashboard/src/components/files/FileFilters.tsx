'use client';

interface FileFiltersState {
  fileType?: string;
  context?: string;
  workspaceId?: string;
  search?: string;
}

interface FileFiltersProps {
  filters: FileFiltersState;
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

export function FileFilters({ filters, onChange }: FileFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={filters.fileType || ''}
        onChange={(e) => onChange({ ...filters, fileType: e.target.value || undefined })}
        className={inputClass}
      >
        {FILE_TYPES.map((ft) => (
          <option key={ft.value} value={ft.value}>
            {ft.label}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Filter by context..."
        value={filters.context || ''}
        onChange={(e) => onChange({ ...filters, context: e.target.value || undefined })}
        className={inputClass}
      />

      <input
        type="text"
        placeholder="Search by name..."
        value={filters.search || ''}
        onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
        className={inputClass}
      />
    </div>
  );
}
