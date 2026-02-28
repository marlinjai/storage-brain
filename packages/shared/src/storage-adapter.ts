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

export interface GetResult {
  body: ReadableStream;
  contentType: string;
  size: number;
  etag?: string;
}

export interface PresignedUrlOptions {
  expiresIn: number;
  contentType?: string;
}

export interface StorageAdapter {
  put(key: string, data: ReadableStream | ArrayBuffer, options: PutOptions): Promise<StorageObject>;
  get(key: string): Promise<GetResult | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  head(key: string): Promise<StorageObject | null>;
  getPresignedUploadUrl?(key: string, options: PresignedUrlOptions): Promise<string>;
  getPresignedDownloadUrl?(key: string, options: PresignedUrlOptions): Promise<string>;
}
