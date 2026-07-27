import { z } from 'zod';
import type { ErasureWebhookPayload } from '@marlinjai/auth-brain-shared';

/**
 * Runtime validator for the erasure webhook body. The wire shape is owned by
 * `@marlinjai/auth-brain-shared` (the `ErasureWebhookPayload` type); that package
 * ships the type only, so we re-declare the matching zod schema here and pin the
 * two together with the `satisfies` check below — a drift in the shared type
 * fails typecheck rather than passing silently.
 *
 * `tenant_id` and `workspace_ids` are optional/additive: a `user.erased` body
 * omits `tenant_id`, and a pre-1.4.0 `tenant.erased` body omits `workspace_ids`.
 */
export const erasureWebhookPayloadSchema = z.object({
  event_id: z.string().min(1),
  kind: z.enum(['user.erased', 'tenant.erased']),
  user_id: z.string().min(1),
  tenant_id: z.string().min(1).optional(),
  workspace_ids: z.array(z.string().min(1)).optional(),
  requested_at: z.string().min(1),
});

// Compile-time guard: the parsed output must be assignable to the shared type.
type _ParsedIsPayload = z.infer<typeof erasureWebhookPayloadSchema> extends ErasureWebhookPayload
  ? true
  : never;
const _assertParsedIsPayload: _ParsedIsPayload = true;
void _assertParsedIsPayload;

export type ErasurePayload = z.infer<typeof erasureWebhookPayloadSchema>;
