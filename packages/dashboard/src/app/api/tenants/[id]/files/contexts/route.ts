import { NextResponse, type NextRequest } from 'next/server';
import { getAdmin } from '@/lib/sdk';
import { routeError } from '@/lib/route-error';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();

    const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;

    const result = await admin.listFileContexts(id, workspaceId ? { workspaceId } : undefined);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, 'GET /api/tenants/[id]/files/contexts');
  }
}
