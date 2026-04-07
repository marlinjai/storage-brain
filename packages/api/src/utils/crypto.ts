// Re-export crypto utilities from brain-core
export {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  timingSafeEqual,
  generateId,
} from '@marlinjai/brain-core';

/**
 * Extract the first 12 characters of an API key as a recognisable prefix
 * (e.g. "sk_live_a3f9" — enough to identify the key without exposing it)
 */
export function getKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12);
}
