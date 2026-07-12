import useSWR from 'swr';
import type { FileContextAggregate } from '@marlinjai/storage-brain-sdk/admin';
import { fetcher } from '@/lib/fetcher';

interface ContextsResponse {
  contexts: FileContextAggregate[];
}

/**
 * Fetch the context "folder" aggregate for a tenant, optionally scoped to a
 * workspace. Re-keys (and refetches) whenever the workspace changes.
 */
export function useFileContexts(tenantId: string | undefined, workspaceId?: string) {
  const key = tenantId
    ? `/api/tenants/${tenantId}/files/contexts${workspaceId ? `?workspaceId=${workspaceId}` : ''}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<ContextsResponse, Error>(key, fetcher);

  return {
    contexts: data?.contexts ?? [],
    isLoading,
    error,
    mutate,
  };
}
