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
          'interaction-prompt'?: string;
          'shadow-intensity'?: string;
          loading?: string;
          reveal?: string;
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
  /** Interactive (orbit + auto-rotate) for the detail view; static thumbnail in the grid. */
  interactive?: boolean;
}

// Fills its parent: the caller provides a positioned (relative) box that sets
// the size. Used both as a small static grid thumbnail and the large
// interactive detail viewer.
export function ModelViewer({ url, alt, interactive = true }: ModelViewerProps) {
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
    <>
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
          Loading 3D…
        </div>
      )}
      {ready && (
        <model-viewer
          src={url}
          alt={alt}
          camera-controls={interactive || undefined}
          auto-rotate={interactive || undefined}
          interaction-prompt="none"
          loading="lazy"
          reveal="auto"
          shadow-intensity="1"
          exposure="1"
          style={{ width: '100%', height: '100%', backgroundColor: '#111827' }}
        />
      )}
    </>
  );
}
