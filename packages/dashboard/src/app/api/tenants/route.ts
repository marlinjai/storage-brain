import { NextResponse } from 'next/server';
import type { CreateTenantInput } from '@marlinjai/storage-brain-sdk/admin';
import { getAdmin } from '@/lib/sdk';
import { routeError } from '@/lib/route-error';

export async function GET() {
  try {
    const admin = await getAdmin();
    const result = await admin.listTenants();
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, 'GET /api/tenants');
  }
}

export async function POST(request: Request) {
  try {
    const admin = await getAdmin();
    const body = (await request.json()) as CreateTenantInput;
    const result = await admin.createTenant(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return routeError(err, 'POST /api/tenants');
  }
}
