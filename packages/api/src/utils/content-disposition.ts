/**
 * Build a Content-Disposition header value that safely handles non-ASCII filenames.
 *
 * HTTP headers are ByteString (each char must be <= 255). Filenames with multi-byte
 * UTF-8 characters (e.g. "für.pdf" containing combining diaeresis U+0308) crash
 * `Headers.set` if passed raw. RFC 6266 / RFC 5987 solve this: emit an ASCII-only
 * `filename="..."` for legacy clients plus `filename*=UTF-8''<percent-encoded>` for
 * full-fidelity decoding by modern clients.
 */
export function buildContentDisposition(
  disposition: 'inline' | 'attachment',
  filename: string,
): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
