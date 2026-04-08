import useSWR from 'swr';

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json())
    .then((data) => data?.url ?? null);

/**
 * Fetch and cache a signed download URL for a file.
 * URLs are cached for 30 minutes (signed URLs expire after 1 hour by default)
 * and deduplicated across components rendering the same file.
 */
export function useSignedUrl(tenantId: string, fileId: string | undefined) {
  const { data: url, isLoading } = useSWR(
    fileId ? `/api/tenants/${tenantId}/files/${fileId}/signed-url` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30 * 60 * 1000, // 30 min dedup
      revalidateIfStale: false,
    },
  );

  return { url: url as string | null, isLoading };
}
