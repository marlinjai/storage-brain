'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isRateLimited = /too many requests|rate limit/i.test(error.message);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-lg font-semibold text-gray-100">
        {isRateLimited ? 'The service is busy right now' : 'Something went wrong'}
      </h2>
      <p className="max-w-md text-sm text-gray-400">
        {isRateLimited
          ? 'Too many requests hit the storage service at once. Give it a moment and try again.'
          : 'We could not load this page. This is usually temporary, please try again.'}
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  );
}
