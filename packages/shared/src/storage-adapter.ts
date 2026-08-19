export interface StorageObject {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
  etag?: string;
}

export interface PutOptions {
  contentType: string;
  metadata?: Record<string, string>;
}

/**
 * A requested byte range. `end` is INCLUSIVE (RFC 9110); omitting it means
 * "to the end of the object".
 */
export interface ByteRange {
  start: number;
  end?: number;
}

export interface GetResult {
  body: ReadableStream;
  contentType: string;
  /** Size of the WHOLE object, not of `body`, even on a partial read. */
  size: number;
  etag?: string;
  /**
   * Set ONLY when the adapter actually returned a partial body.
   *
   * Callers must branch on this rather than assuming a requested range was
   * honoured. That is the whole point: the download route previously advertised
   * `Accept-Ranges: bytes` while ignoring `Range`, so a ranged request got a 200
   * with the entire body. Clients that trust `Accept-Ranges` (browser `<video>`
   * seeking, and video fetchers such as Meta's) can break on that. An adapter
   * that cannot serve ranges simply leaves this unset and the caller answers
   * 200 with the full body, which is honest.
   */
  range?: { start: number; end: number; total: number };
}

export interface PresignedUrlOptions {
  expiresIn: number;
  contentType?: string;
}

export interface StorageAdapter {
  put(key: string, data: ReadableStream | ArrayBuffer, options: PutOptions): Promise<StorageObject>;
  /**
   * Fetch an object, optionally only a byte range of it. An adapter that cannot
   * serve ranges may ignore `range` and return the whole body, but then it MUST
   * leave `GetResult.range` unset so the caller does not claim a partial
   * response it did not make.
   */
  get(key: string, range?: ByteRange): Promise<GetResult | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  head(key: string): Promise<StorageObject | null>;
  getPresignedUploadUrl?(key: string, options: PresignedUrlOptions): Promise<string>;
  getPresignedDownloadUrl?(key: string, options: PresignedUrlOptions): Promise<string>;
}
