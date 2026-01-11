import type { Env } from '../env';
import type { OcrResult } from '@storage-brain/shared';
import { getFromR2 } from '../services/r2';

/**
 * Process OCR using Google Cloud Vision API
 */
export async function processOcr(env: Env, storedPath: string): Promise<OcrResult | null> {
  const apiKey = env.GCP_VISION_API_KEY;

  if (!apiKey) {
    console.warn('GCP Vision API key not configured, skipping OCR');
    return null;
  }

  try {
    // Get file from R2
    const r2Object = await getFromR2(env.BUCKET, storedPath);
    if (!r2Object) {
      console.error(`File not found in R2: ${storedPath}`);
      return null;
    }

    // Read file as base64
    const arrayBuffer = await r2Object.arrayBuffer();
    const base64Content = btoa(
      String.fromCharCode(...new Uint8Array(arrayBuffer))
    );

    // Call Google Cloud Vision API
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: base64Content,
              },
              features: [
                {
                  type: 'DOCUMENT_TEXT_DETECTION',
                  maxResults: 1,
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Google Vision API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json() as GoogleVisionResponse;

    // Parse response
    const annotation = result.responses?.[0]?.fullTextAnnotation;
    if (!annotation) {
      console.log('No text found in image');
      return {
        fullText: '',
        confidence: 0,
        blocks: [],
      };
    }

    // Extract blocks with bounding boxes
    const blocks = annotation.pages?.[0]?.blocks?.map((block) => ({
      text: block.paragraphs
        ?.map((p) => p.words?.map((w) => w.symbols?.map((s) => s.text).join('')).join(' '))
        .join('\n') ?? '',
      confidence: block.confidence ?? 0,
      boundingBox: {
        x: block.boundingBox?.vertices?.[0]?.x ?? 0,
        y: block.boundingBox?.vertices?.[0]?.y ?? 0,
        width:
          (block.boundingBox?.vertices?.[2]?.x ?? 0) - (block.boundingBox?.vertices?.[0]?.x ?? 0),
        height:
          (block.boundingBox?.vertices?.[2]?.y ?? 0) - (block.boundingBox?.vertices?.[0]?.y ?? 0),
      },
    })) ?? [];

    return {
      fullText: annotation.text ?? '',
      confidence: annotation.pages?.[0]?.confidence ?? 0,
      blocks,
    };
  } catch (error) {
    console.error('OCR processing error:', error);
    return null;
  }
}

// Google Vision API response types
interface GoogleVisionResponse {
  responses?: Array<{
    fullTextAnnotation?: {
      text?: string;
      pages?: Array<{
        confidence?: number;
        blocks?: Array<{
          confidence?: number;
          boundingBox?: {
            vertices?: Array<{ x?: number; y?: number }>;
          };
          paragraphs?: Array<{
            words?: Array<{
              symbols?: Array<{ text?: string }>;
            }>;
          }>;
        }>;
      }>;
    };
  }>;
}
