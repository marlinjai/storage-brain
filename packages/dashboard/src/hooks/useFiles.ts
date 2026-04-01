import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface UseFilesFilters {
  limit?: number;
  cursor?: string;
  context?: string;
  fileType?: string;
  workspaceId?: string;
}

export function useFiles(tenantId: string | undefined, filters?: UseFilesFilters) {
  const params = new URLSearchParams();
  if (filters?.limit) params.set('limit', filters.limit.toString());
  if (filters?.cursor) params.set('cursor', filters.cursor);
  if (filters?.context) params.set('context', filters.context);
  if (filters?.fileType) params.set('fileType', filters.fileType);
  if (filters?.workspaceId) params.set('workspaceId', filters.workspaceId);

  const query = params.toString();
  const url = tenantId
    ? `/api/tenants/${tenantId}/files${query ? `?${query}` : ''}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    files: data?.files ?? [],
    total: data?.total ?? 0,
    nextCursor: data?.nextCursor,
    isLoading,
    error,
    mutate,
  };
}
