import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useTenants() {
  const { data, error, isLoading, mutate } = useSWR('/api/tenants', fetcher);

  return {
    tenants: data?.tenants ?? [],
    isLoading,
    error,
    mutate,
  };
}
