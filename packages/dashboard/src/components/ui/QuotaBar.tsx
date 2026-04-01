'use client';

import { formatBytes } from '@/lib/format';

interface QuotaBarProps {
  usedBytes: number;
  quotaBytes: number;
}

export function QuotaBar({ usedBytes, quotaBytes }: QuotaBarProps) {
  const percentage = quotaBytes > 0 ? Math.min((usedBytes / quotaBytes) * 100, 100) : 0;

  let barColor = 'bg-blue-600';
  if (percentage > 90) barColor = 'bg-red-500';
  else if (percentage > 75) barColor = 'bg-yellow-500';

  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {formatBytes(usedBytes)} / {formatBytes(quotaBytes)} ({percentage.toFixed(0)}%)
      </p>
    </div>
  );
}
