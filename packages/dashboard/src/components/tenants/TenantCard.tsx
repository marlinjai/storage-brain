'use client';

import Link from 'next/link';
import { QuotaBar } from '@/components/ui/QuotaBar';
import { formatDate } from '@/lib/format';

interface Tenant {
  id: string;
  name: string;
  quotaBytes: number;
  usedBytes: number;
  allowedFileTypes: string[];
  createdAt: string;
}

interface TenantCardProps {
  tenant: Tenant;
}

export function TenantCard({ tenant }: TenantCardProps) {
  return (
    <Link
      href={`/tenants/${tenant.id}`}
      className="block rounded-xl border border-gray-800 bg-gray-900 p-5 transition-colors hover:border-gray-700"
    >
      <h3 className="mb-3 text-lg font-semibold text-gray-100">
        {tenant.name}
      </h3>
      <QuotaBar usedBytes={tenant.usedBytes} quotaBytes={tenant.quotaBytes} />
      <p className="mt-3 text-xs text-gray-500">
        Created {formatDate(tenant.createdAt)}
      </p>
    </Link>
  );
}
