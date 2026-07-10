import useSWR from 'swr';
import type { AdminTenant } from '@marlinjai/storage-brain-sdk/admin';
import { fetcher } from '@/lib/fetcher';

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
