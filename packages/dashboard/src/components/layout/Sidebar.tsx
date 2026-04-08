'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import TenantSwitcher from './TenantSwitcher';

const navItems = [
  {
    label: 'Overview',
    href: '/',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    label: 'Tenants',
    href: '/tenants',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
];

const tenantSubNav = [
  { label: 'Files', suffix: '/files' },
  { label: 'Workspaces', suffix: '/workspaces' },
  { label: 'Settings', suffix: '/settings' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  // Extract current tenantId from URL
  const match = pathname.match(/^\/tenants\/([^/]+)/);
  const currentTenantId = match?.[1] ?? null;

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-gray-800 bg-gray-950 md:flex md:flex-col">
      {/* Header */}
      <div className="flex h-16 items-center border-b border-gray-800 px-6">
        <h1 className="text-lg font-bold text-gray-100">Storage Brain</h1>
      </div>

      {/* Tenant Switcher */}
      <div className="border-b border-gray-800 py-3">
        <TenantSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}

        {/* Tenant sub-navigation */}
        {currentTenantId && (
          <div className="ml-4 mt-1 space-y-0.5 border-l border-gray-800 pl-3">
            {tenantSubNav.map((item) => {
              const href = `/tenants/${currentTenantId}${item.suffix}`;
              const isActive = pathname === href;

              return (
                <Link
                  key={item.suffix}
                  href={href}
                  className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-gray-800 text-gray-100'
                      : 'text-gray-500 hover:bg-gray-900 hover:text-gray-300'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      {/* Logout */}
      <div className="border-t border-gray-800 p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-900 hover:text-gray-200"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          Logout
        </button>
      </div>
    </aside>
  );
}
