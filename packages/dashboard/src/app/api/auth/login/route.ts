import { NextResponse } from 'next/server';
import { StorageBrainAdmin } from '@marlinjai/storage-brain-sdk/admin';
import { getSession } from '@/lib/session';

export async function POST(request: Request) {
  try {
    const { adminApiKey, baseUrl } = (await request.json()) as {
      adminApiKey?: string;
      baseUrl?: string;
    };

    if (!adminApiKey) {
      return NextResponse.json(
        { error: 'Admin API key is required' },
        { status: 400 }
      );
    }

    // Validate credentials by making a test call
    const admin = new StorageBrainAdmin({ adminApiKey, baseUrl });
    await admin.listTenants({ limit: 1 });

    // Save to session
    const session = await getSession();
    session.adminApiKey = adminApiKey;
    session.baseUrl = baseUrl;
    await session.save();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid credentials';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
