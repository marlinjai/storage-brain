'use client';

import { useState } from 'react';
import { useTenants } from '@/hooks/useTenants';
import { TenantCard } from '@/components/tenants/TenantCard';
import { CreateTenantModal } from '@/components/tenants/CreateTenantModal';

export default function TenantsPage() {
  const { tenants, isLoading, error, mutate } = useTenants();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Tenants</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Create Tenant
        </button>
      </div>

      {isLoading && (
        <p className="text-sm text-gray-400">Loading tenants...</p>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400">
          Failed to load tenants
        </div>
      )}

      {tenants && tenants.length === 0 && !isLoading && (
        <p className="text-sm text-gray-500">
          No tenants yet. Create one to get started.
        </p>
      )}

      {tenants && tenants.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tenants.map((tenant) => (
            <TenantCard key={tenant.id} tenant={tenant} />
          ))}
        </div>
      )}

      <CreateTenantModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => void mutate()}
      />
    </div>
  );
}
