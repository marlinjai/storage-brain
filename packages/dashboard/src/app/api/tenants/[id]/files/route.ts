import { NextResponse, type NextRequest } from 'next/server';
import { getAdmin } from '@/lib/sdk';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();

    const searchParams = request.nextUrl.searchParams;
    const query: Record<string, string | number> = {};
    if (searchParams.has('limit')) query.limit = Number(searchParams.get('limit'));
    if (searchParams.has('cursor')) query.cursor = searchParams.get('cursor')!;
    if (searchParams.has('context')) query.context = searchParams.get('context')!;
    if (searchParams.has('fileType')) query.fileType = searchParams.get('fileType')!;
    if (searchParams.has('workspaceId')) query.workspaceId = searchParams.get('workspaceId')!;

    const result = await admin.listTenantFiles(id, query);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Not authenticated') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
