'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTenants } from '@/hooks/useTenants';

interface Tenant {
  id: string;
  name: string;
}

export default function TenantSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { tenants, isLoading } = useTenants();

  // Extract current tenantId from URL
  const match = pathname.match(/^\/tenants\/([^/]+)/);
  const currentTenantId = match?.[1] ?? null;
  const currentTenant = tenants.find((t: Tenant) => t.id === currentTenantId);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close on navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function selectTenant(tenantId: string) {
    // Navigate to the same sub-section for the new tenant, or default to tenant detail
    if (currentTenantId && pathname.includes(`/tenants/${currentTenantId}/`)) {
      const subPath = pathname.split(`/tenants/${currentTenantId}`)[1];
      router.push(`/tenants/${tenantId}${subPath}`);
    } else {
      router.push(`/tenants/${tenantId}`);
    }
    setOpen(false);
  }

  if (isLoading) {
    return (
      <div className="px-3">
        <div className="h-9 animate-pulse rounded-lg bg-gray-800" />
      </div>
    );
  }

  if (!tenants.length) return null;

  return (
    <div ref={ref} className="relative px-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-left text-sm transition-colors hover:border-gray-700"
      >
        <div className="flex items-center gap-2 truncate">
          <svg
            className="h-4 w-4 shrink-0 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3.75"
            />
          </svg>
          <span className={currentTenant ? 'text-gray-100' : 'text-gray-500'}>
            {currentTenant?.name ?? 'Select tenant'}
          </span>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-3 right-3 z-50 mt-1 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          {tenants.map((tenant: Tenant) => (
            <button
              key={tenant.id}
              onClick={() => selectTenant(tenant.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                tenant.id === currentTenantId
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              {tenant.id === currentTenantId && (
                <svg
                  className="h-3.5 w-3.5 shrink-0 text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              <span className={tenant.id === currentTenantId ? '' : 'ml-5.5'}>
                {tenant.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
