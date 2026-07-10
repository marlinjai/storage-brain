import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/sdk';
import { routeError } from '@/lib/route-error';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    const admin = await getAdmin();
    await admin.deleteTenantFile(id, fileId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return routeError(err, 'DELETE /api/tenants/[id]/files/[fileId]');
  }
}
