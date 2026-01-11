import type { Env } from '../env';
import type { ProcessingQueueMessage, FileMetadata } from '@storage-brain/shared';
import { updateFileMetadata, updateFileProcessingStatus, getFileById } from '../db/queries';
import { processOcr } from '../processors/ocr';
import { processThumbnails } from '../processors/thumbnail';

/**
 * Process a batch of queue messages
 */
export async function processQueueBatch(
  batch: MessageBatch<ProcessingQueueMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processFile(message.body, env);
      message.ack();
    } catch (error) {
      console.error(`Error processing file ${message.body.fileId}:`, error);

      // Retry up to 3 times
      if (message.attempts < 3) {
        message.retry();
      } else {
        // Mark as failed after max retries
        await updateFileProcessingStatus(env.DB, message.body.fileId, 'failed');
        message.ack();
      }
    }
  }
}

/**
 * Process a single file based on its context
 */
async function processFile(message: ProcessingQueueMessage, env: Env): Promise<void> {
  const { fileId, tenantId, context, storedPath, fileType } = message;

  console.log(`Processing file ${fileId} with context: ${context}`);

  // Update status to processing
  await updateFileProcessingStatus(env.DB, fileId, 'processing');

  // Initialize metadata
  const metadata: FileMetadata = {};

  try {
    // Route to appropriate processor based on context
    switch (context) {
      case 'invoice':
        // OCR processing for invoices
        if (fileType === 'application/pdf' || fileType.startsWith('image/')) {
          const ocrResult = await processOcr(env, storedPath);
          if (ocrResult) {
            metadata.ocrData = ocrResult;
          }
        }
        break;

      case 'framer-site':
        // Thumbnail generation for framer-site images
        if (fileType.startsWith('image/')) {
          const thumbnailUrls = await processThumbnails(env, storedPath, fileId);
          if (thumbnailUrls) {
            metadata.thumbnailUrls = thumbnailUrls;
          }
        }
        break;

      case 'newsletter':
        // For newsletters, we could extract image info
        // For MVP, just mark as processed
        break;

      case 'default':
      default:
        // No special processing for default context
        break;
    }

    // Update file with metadata and mark as completed
    await updateFileMetadata(env.DB, fileId, metadata, 'completed');

    console.log(`Successfully processed file ${fileId}`);

    // Call webhook if configured
    if (message.webhookUrl) {
      await callWebhook(message.webhookUrl, fileId, tenantId, env);
    }
  } catch (error) {
    console.error(`Processing failed for file ${fileId}:`, error);
    metadata.processingError = error instanceof Error ? error.message : 'Unknown error';
    await updateFileMetadata(env.DB, fileId, metadata, 'failed');
    throw error;
  }
}

/**
 * Call the configured webhook after processing
 */
async function callWebhook(
  webhookUrl: string,
  fileId: string,
  tenantId: string,
  env: Env
): Promise<void> {
  try {
    const file = await getFileById(env.DB, fileId, tenantId);
    if (!file) {
      console.error(`File not found for webhook: ${fileId}`);
      return;
    }

    const payload = {
      event: file.processingStatus === 'completed' ? 'file.processed' : 'file.failed',
      fileId,
      tenantId,
      file: {
        id: file.id,
        url: `/api/v1/files/download/${encodeURIComponent(file.storedPath)}`,
        originalName: file.originalName,
        fileType: file.fileType,
        sizeBytes: file.sizeBytes,
        context: file.context,
        tags: file.tags,
        metadata: file.metadata,
        processingStatus: file.processingStatus,
        createdAt: new Date(file.createdAt).toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    // Attempt webhook with retries
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          console.log(`Webhook delivered successfully for file ${fileId}`);
          return;
        }

        console.warn(
          `Webhook attempt ${attempt + 1} failed with status ${response.status} for file ${fileId}`
        );
      } catch (fetchError) {
        console.warn(`Webhook attempt ${attempt + 1} failed for file ${fileId}:`, fetchError);
      }

      // Exponential backoff
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    console.error(`All webhook attempts failed for file ${fileId}`);
  } catch (error) {
    console.error(`Error calling webhook for file ${fileId}:`, error);
  }
}
