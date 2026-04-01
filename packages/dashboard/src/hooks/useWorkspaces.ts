import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useWorkspaces(tenantId: string | undefined) {
  const url = tenantId ? `/api/tenants/${tenantId}/workspaces` : null;

  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    workspaces: data?.workspaces ?? [],
    isLoading,
    error,
    mutate,
  };
}
