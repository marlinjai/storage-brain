import useSWR from 'swr';
import type { AdminTenant } from '@marlinjai/storage-brain-sdk/admin';

const fetcher = <T>(url: string): Promise<T> =>
  fetch(url).then((r) => r.json() as Promise<T>);

interface TenantsResponse {
  tenants: AdminTenant[];
  nextCursor: string | null;
  total: number;
}

export function useTenants() {
  const { data, error, isLoading, mutate } = useSWR<TenantsResponse, Error>(
    '/api/tenants',
    fetcher
  );

  return {
    tenants: data?.tenants ?? [],
    isLoading,
    error,
    mutate,
  };
}
