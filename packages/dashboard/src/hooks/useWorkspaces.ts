import useSWR from 'swr';
import type { AdminWorkspace } from '@marlinjai/storage-brain-sdk/admin';
import { fetcher } from '@/lib/fetcher';

interface WorkspacesResponse {
  workspaces: AdminWorkspace[];
}

export function useWorkspaces(tenantId: string | undefined) {
  const url = tenantId ? `/api/tenants/${tenantId}/workspaces` : null;

  const { data, error, isLoading, mutate } = useSWR<WorkspacesResponse, Error>(
    url,
    fetcher
  );

  return {
    workspaces: data?.workspaces ?? [],
    isLoading,
    error,
    mutate,
  };
}
