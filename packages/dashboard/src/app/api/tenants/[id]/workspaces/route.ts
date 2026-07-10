import { NextResponse } from 'next/server';
import type { CreateWorkspaceInput } from '@marlinjai/storage-brain-sdk/admin';
import { getAdmin } from '@/lib/sdk';
import { routeError } from '@/lib/route-error';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();
    const result = await admin.listTenantWorkspaces(id);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, 'GET /api/tenants/[id]/workspaces');
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();
    const body = (await request.json()) as Partial<CreateWorkspaceInput>;

    // Auto-generate slug from name if not provided
    if (!body.slug && body.name) {
      body.slug = body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    const workspace = await admin.createTenantWorkspace(
      id,
      body as CreateWorkspaceInput
    );
    return NextResponse.json(workspace, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'Not authenticated') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    console.error('[dashboard] POST /api/tenants/[id]/workspaces failed:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
