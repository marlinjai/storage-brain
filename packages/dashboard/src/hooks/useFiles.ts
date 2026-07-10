import useSWRInfinite from 'swr/infinite';
import { fetcher } from '@/lib/fetcher';

interface UseFilesFilters {
  limit?: number;
  context?: string;
  fileType?: string;
  workspaceId?: string;
}

interface FilesPage<T> {
  files: T[];
  total: number;
  nextCursor?: string;
}

export function useFiles<T = unknown>(
  tenantId: string | undefined,
  filters?: UseFilesFilters
) {
  const getKey = (pageIndex: number, previousPageData: FilesPage<T> | null) => {
    if (!tenantId) return null;
    // Reached the end: the previous page returned no cursor.
    if (previousPageData && !previousPageData.nextCursor) return null;

    const params = new URLSearchParams();
    if (filters?.limit) params.set('limit', filters.limit.toString());
    if (filters?.context) params.set('context', filters.context);
    if (filters?.fileType) params.set('fileType', filters.fileType);
    if (filters?.workspaceId) params.set('workspaceId', filters.workspaceId);
    // Every page after the first carries the prior page's cursor.
    if (pageIndex > 0 && previousPageData?.nextCursor) {
      params.set('cursor', previousPageData.nextCursor);
    }

    const query = params.toString();
    return `/api/tenants/${tenantId}/files${query ? `?${query}` : ''}`;
  };

  const { data, error, isLoading, size, setSize, mutate } =
    useSWRInfinite<FilesPage<T>, Error>(getKey, fetcher, {
      revalidateFirstPage: false,
    });

  const pages = data ?? [];
  const files = pages.flatMap((p) => p.files ?? []);
  const lastPage = pages[pages.length - 1];
  const hasMore = Boolean(lastPage?.nextCursor);

  // A page was requested (size) but its data hasn't resolved yet (pages.length).
  const isLoadingMore = data !== undefined && pages.length < size;

  return {
    files,
    total: pages[0]?.total ?? 0,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore: () => setSize(size + 1),
    setSize,
    mutate,
  };
}
