'use client';

import { useState } from 'react';

/**
 * Autoplaying loop, with a graceful stand-in.
 *
 * The scraped template referenced `/1.mp4`, `/2.mp4` and `/screencast.mp4` but
 * did not include the files (see MISSING-ASSETS.md). When the source 404s the
 * component keeps the element's box and paints a placeholder so the layout and
 * the scroll distances stay identical to the original.
 */
export default function Video({
  src,
  className,
  label,
}: {
  src: string;
  className?: string;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={['video-placeholder', className].filter(Boolean).join(' ')} role="img" aria-label={label ?? 'Video placeholder'}>
        <span>{label ?? src}</span>
      </div>
    );
  }

  return (
    <video
      src={src}
      className={className}
      autoPlay
      muted
      loop
      playsInline
      onError={() => setFailed(true)}
    />
  );
}
