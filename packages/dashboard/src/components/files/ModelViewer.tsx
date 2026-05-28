'use client';

import { useEffect, useState } from 'react';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- custom-element JSX typing requires namespace augmentation
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          'camera-controls'?: boolean;
          'auto-rotate'?: boolean;
          'shadow-intensity'?: string;
          exposure?: string;
        },
        HTMLElement
      >;
    }
  }
}

interface ModelViewerProps {
  url: string;
  alt: string;
}

export function ModelViewer({ url, alt }: ModelViewerProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // model-viewer self-registers a custom element and touches `window`,
    // so the import must run in the browser only (this app is SSR'd).
    let active = true;
    void import('@google/model-viewer').then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-gray-800 bg-gray-900"
      style={{ height: '400px' }}
    >
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          Loading 3D model…
        </div>
      )}
      {ready && (
        <model-viewer
          src={url}
          alt={alt}
          camera-controls
          auto-rotate
          shadow-intensity="1"
          exposure="1"
          style={{ width: '100%', height: '100%', backgroundColor: '#111827' }}
        />
      )}
    </div>
  );
}
