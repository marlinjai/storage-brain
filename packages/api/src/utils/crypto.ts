// Re-export crypto utilities from brain-core
export {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  timingSafeEqual,
  generateId,
} from '@marlinjai/brain-core';

/**
 * Extract the first 7 characters of an API key as a recognisable prefix
 */
export function getKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 7);
}
