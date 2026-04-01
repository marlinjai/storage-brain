import { NextResponse, type NextRequest } from 'next/server';
import { getAdmin } from '@/lib/sdk';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    const admin = await getAdmin();

    const expiresIn = request.nextUrl.searchParams.get('expiresIn');
    const result = await admin.getTenantFileSignedUrl(
      id,
      fileId,
      expiresIn ? Number(expiresIn) : undefined
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Not authenticated') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
