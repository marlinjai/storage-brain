import { NextResponse } from 'next/server';
import type { RequestTenantUploadInput } from '@marlinjai/storage-brain-sdk/admin';
import { getAdmin, getStorageBrainBaseUrl } from '@/lib/sdk';

/**
 * Best-effort HTTP status for a Storage Brain SDK error when the error itself
 * does not carry a usable `statusCode`. Keyed by the API error `code` so the
 * client can still render the right unhappy-path message.
 */
const STATUS_BY_CODE: Record<string, number> = {
  INVALID_FILE_TYPE: 400,
  FILE_TOO_LARGE: 413,
  QUOTA_EXCEEDED: 403,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  FILE_NOT_FOUND: 404,
  UNAUTHORIZED: 401,
};

/**
 * POST /api/tenants/[id]/upload/request
 *
 * Proxies an upload-request handshake to the admin-scoped API endpoint using
 * the dashboard's admin credential (never a tenant key). The API-relative
 * presigned URL is absolutized so the browser can PUT bytes straight to the API
 * origin. API errors are mapped through (status + code + message) so the UI can
 * surface every unhappy path instead of swallowing it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();
    const baseUrl = await getStorageBrainBaseUrl();
    const body = (await request.json()) as RequestTenantUploadInput;

    const handshake = await admin.requestTenantUpload(id, body);

    // The handshake presigned URL is API-relative (e.g. /_internal/upload/...).
    // Absolutize it against the browser-reachable API base so the browser can
    // PUT the file bytes directly to the API origin.
    const presignedUrl =
      baseUrl && handshake.presignedUrl.startsWith('/')
        ? `${baseUrl}${handshake.presignedUrl}`
        : handshake.presignedUrl;

    return NextResponse.json({ ...handshake, presignedUrl });
  } catch (err) {
    if (err instanceof Error && err.message === 'Not authenticated') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const e = err as {
      statusCode?: number;
      code?: string;
      details?: Record<string, unknown>;
    };
    const code = typeof e?.code === 'string' ? e.code : undefined;
    const status =
      typeof e?.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 600
        ? e.statusCode
        : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- falls back to 500 for unknown code (undefined) and missing code (false)
          (code && STATUS_BY_CODE[code]) || 500;
    const message = err instanceof Error ? err.message : 'Internal error';

    return NextResponse.json({ error: message, code, details: e?.details }, { status });
  }
}
