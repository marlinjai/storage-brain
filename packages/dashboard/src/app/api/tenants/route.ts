import { NextResponse } from 'next/server';
import type { CreateTenantInput } from '@marlinjai/storage-brain-sdk/admin';
import { getAdmin } from '@/lib/sdk';

export async function GET() {
  try {
    const admin = await getAdmin();
    const result = await admin.listTenants();
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Not authenticated') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await getAdmin();
    const body = (await request.json()) as CreateTenantInput;
    const result = await admin.createTenant(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'Not authenticated') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
