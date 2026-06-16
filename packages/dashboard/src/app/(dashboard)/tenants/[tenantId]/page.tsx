'use client';

import { use } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import type { AdminTenantDetail } from '@marlinjai/storage-brain-sdk/admin';
import { QuotaBar } from '@/components/ui/QuotaBar';
import { formatDate } from '@/lib/format';

const fetcher = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => r.json() as Promise<T>);

export default function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const {
    data: tenant,
    isLoading,
    error,
  } = useSWR<AdminTenantDetail, Error>(`/api/tenants/${tenantId}`, fetcher);

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading tenant...</div>;
  }

  if (error != null || !tenant) {
    return (
      <div>
        <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400">
          Failed to load tenant
        </div>
      </div>
    );
  }

  const links = [
    { label: 'Files', href: `/tenants/${tenantId}/files`, description: 'Browse and manage uploaded files' },
    { label: 'Workspaces', href: `/tenants/${tenantId}/workspaces`, description: 'Manage file workspaces' },
    { label: 'Settings', href: `/tenants/${tenantId}/settings`, description: 'Tenant configuration and API keys' },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-100">{tenant.name}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Created {formatDate(tenant.createdAt)}
        </p>
      </div>

      {/* Quota overview */}
      <div className="mb-8 max-w-md rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="mb-3 text-sm font-medium text-gray-300">
          Storage Quota
        </h2>
        <QuotaBar
          usedBytes={tenant.usedBytes ?? 0}
          quotaBytes={tenant.quotaBytes ?? 0}
        />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="rounded-xl border border-gray-800 bg-gray-900 p-5 transition-colors hover:border-gray-700"
          >
            <h3 className="text-lg font-semibold text-gray-100">
              {link.label}
            </h3>
            <p className="mt-1 text-sm text-gray-500">{link.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
