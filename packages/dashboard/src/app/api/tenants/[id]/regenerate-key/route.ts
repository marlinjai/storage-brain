import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/sdk';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await getAdmin();
    const body = await request.json().catch(() => ({}));
    const result = await admin.regenerateKey(id, body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Not authenticated') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
