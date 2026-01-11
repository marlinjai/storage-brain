/**
 * SDK Test Script
 *
 * Tests the StorageBrain SDK against the production API
 *
 * Setup:
 *   1. Copy .env.example to .env
 *   2. Fill in your API key and base URL
 *
 * Run with: npx tsx test-sdk.ts
 */

// Load environment variables from .env file
import { config } from 'dotenv';
config();

const API_KEY = process.env.STORAGE_BRAIN_API_KEY;
const BASE_URL = process.env.STORAGE_BRAIN_BASE_URL || 'https://storage-brain-api.workers.dev';

if (!API_KEY) {
  console.error('Error: STORAGE_BRAIN_API_KEY environment variable is required');
  console.error('Create a .env file with your API key. See .env.example for reference.');
  process.exit(1);
}

interface UploadHandshake {
  fileId: string;
  presignedUrl: string;
  expiresAt: string;
}

interface FileInfo {
  id: string;
  url: string;
  originalName: string;
  fileType: string;
  sizeBytes: number;
  context: string;
  processingStatus: string;
}

interface QuotaInfo {
  quotaBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  return response.json() as Promise<T>;
}

async function testSDKFlow() {
  console.log('=== Storage Brain SDK Test ===\n');

  // 1. Get tenant info
  console.log('1. Getting tenant info...');
  const tenantInfo = await request<{ name: string; id: string }>('GET', '/api/v1/tenant/info');
  console.log(`   Tenant: ${tenantInfo.name} (${tenantInfo.id})\n`);

  // 2. Check quota
  console.log('2. Checking quota...');
  const quota = await request<QuotaInfo>('GET', '/api/v1/tenant/quota');
  console.log(`   Used: ${(quota.usedBytes / 1024).toFixed(2)} KB / ${(quota.quotaBytes / 1024 / 1024).toFixed(0)} MB (${quota.usagePercent.toFixed(2)}%)\n`);

  // 3. Request upload handshake
  console.log('3. Requesting upload handshake...');
  const handshake = await request<UploadHandshake>('POST', '/api/v1/upload/request', {
    fileType: 'image/png',
    fileName: 'sdk-test-file.png',
    fileSizeBytes: 256,
    context: 'default',
    tags: { test: 'sdk-verification' },
  });
  console.log(`   File ID: ${handshake.fileId}`);
  console.log(`   Presigned URL: ${handshake.presignedUrl}\n`);

  // 4. Upload file to presigned URL
  console.log('4. Uploading file...');
  const testContent = Buffer.from('This is a test file uploaded via the SDK test script. '.repeat(5));
  const uploadUrl = `${BASE_URL}${handshake.presignedUrl}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png',
    },
    body: testContent,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${await uploadResponse.text()}`);
  }

  const uploadResult = await uploadResponse.json() as { status: string; fileId: string; sizeBytes: number };
  console.log(`   Status: ${uploadResult.status}`);
  console.log(`   Size: ${uploadResult.sizeBytes} bytes\n`);

  // 5. Get file info
  console.log('5. Getting file info...');
  const fileInfo = await request<FileInfo>('GET', `/api/v1/files/${handshake.fileId}`);
  console.log(`   Original Name: ${fileInfo.originalName}`);
  console.log(`   File Type: ${fileInfo.fileType}`);
  console.log(`   Size: ${fileInfo.sizeBytes} bytes`);
  console.log(`   Processing Status: ${fileInfo.processingStatus}`);
  console.log(`   Download URL: ${fileInfo.url}\n`);

  // 6. Download file
  console.log('6. Downloading file...');
  const downloadResponse = await fetch(`${BASE_URL}/api/v1/files/${handshake.fileId}/download`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  });

  if (!downloadResponse.ok) {
    throw new Error(`Download failed: ${await downloadResponse.text()}`);
  }

  const downloadedContent = await downloadResponse.text();
  console.log(`   Downloaded ${downloadedContent.length} bytes`);
  console.log(`   Content matches: ${downloadedContent === testContent.toString()}\n`);

  // 7. List files
  console.log('7. Listing files...');
  const listResult = await request<{ files: FileInfo[]; total: number }>('GET', '/api/v1/files');
  console.log(`   Total files: ${listResult.total}`);
  console.log(`   Files:`);
  for (const file of listResult.files.slice(0, 5)) {
    console.log(`     - ${file.originalName} (${file.processingStatus})`);
  }
  console.log('');

  // 8. Check quota again
  console.log('8. Checking quota after upload...');
  const quotaAfter = await request<QuotaInfo>('GET', '/api/v1/tenant/quota');
  console.log(`   Used: ${(quotaAfter.usedBytes / 1024).toFixed(2)} KB`);
  console.log(`   Increased by: ${quotaAfter.usedBytes - quota.usedBytes} bytes\n`);

  // 9. Delete test file
  console.log('9. Deleting test file...');
  await request<{ success: boolean }>('DELETE', `/api/v1/files/${handshake.fileId}`);
  console.log(`   File deleted successfully\n`);

  console.log('=== All SDK Tests Passed! ===');
}

// Run the test
testSDKFlow().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
