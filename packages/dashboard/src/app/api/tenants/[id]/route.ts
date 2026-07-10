import { NextResponse } from 'next/server';
import type { UpdateTenantInput } from '@marlinjai/storage-brain-sdk/admin';
import { getAdmin } from '@/lib/sdk';
import { routeError } from '@/lib/route-error';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();
    const result = await admin.getTenant(id);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, 'GET /api/tenants/[id]');
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();
    const body = (await request.json()) as UpdateTenantInput;
    const result = await admin.updateTenant(id, body);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, 'PATCH /api/tenants/[id]');
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();
    await admin.deleteTenant(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return routeError(err, 'DELETE /api/tenants/[id]');
  }
}
