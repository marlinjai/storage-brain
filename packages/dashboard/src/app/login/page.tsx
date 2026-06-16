'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(
    'https://api.storage-brain.lumitra.co'
  );
  const [adminApiKey, setAdminApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminApiKey, baseUrl }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty-string error message falls through to generic copy
        setError(data.error || 'Login failed');
        return;
      }

      router.push('/');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-100">
          Storage Brain
        </h1>
        <p className="mb-8 text-sm text-gray-400">
          Sign in with Lumitra, or use your admin credentials
        </p>

        <a
          href="/api/auth/lumitra"
          className="mb-6 flex w-full items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-200"
        >
          Sign in with Lumitra
        </a>

        <div className="mb-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-xs uppercase tracking-wide text-gray-500">
            or
          </span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="baseUrl"
              className="mb-1.5 block text-sm font-medium text-gray-300"
            >
              API Base URL
            </label>
            <input
              id="baseUrl"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="https://api.storage-brain.lumitra.co"
            />
          </div>

          <div>
            <label
              htmlFor="adminApiKey"
              className="mb-1.5 block text-sm font-medium text-gray-300"
            >
              Admin API Key
            </label>
            <input
              id="adminApiKey"
              type="password"
              value={adminApiKey}
              onChange={(e) => setAdminApiKey(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Enter your admin API key"
              required
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
