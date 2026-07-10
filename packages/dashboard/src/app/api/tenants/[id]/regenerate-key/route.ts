import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/sdk';
import { routeError } from '@/lib/route-error';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();
    const result = await admin.regenerateKey(id);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, 'POST /api/tenants/[id]/regenerate-key');
  }
}
