#!/usr/bin/env bash
# One-off operator script: bind the lola-stories Storage Brain tenant to an
# auth-brain workspace, issue a workspace-scoped service-account key, verify it
# against prod, and stage the key swap in lola-stories' Infisical.
#
# RUN THIS LOCALLY with the `!` prefix in Claude Code (or a plain terminal) so
# every secret value stays on this machine and never enters an AI context:
#
#   ! bash scripts/bind-lola-stories-auth-brain.sh
#
# Prereqs:
#   - Lumitra reads use the dev machine identity token (viewer is enough).
#   - The lola-stories Infisical write at the end needs an ambient session on
#     the LOLA org (`infisical login`), or do that one step in the UI.
#
# Zero-downtime: nothing here touches the legacy key. lola-stories keeps
# working on its current key until YOU redeploy it with the new one, and the
# old key stays valid until explicitly revoked.

set -euo pipefail

AUTH=https://auth.lumitra.co
SB=https://api.storage-brain.lumitra.co
DOMAIN=https://infisical.lumitra.co
ACTOR_EMAIL="${ACTOR_EMAIL:-marlinjaipohl@gmail.com}"
SB_PROJECT_ID=86dcae14-6cb2-473b-8b2d-43b37977f04e
LOLA_PROJECT_ID=a510e5be-4d0b-48b3-8964-c846a4c69cca

# Lumitra org read token (viewer role suffices for reads)
LUMITRA_TOK="$("$HOME/software-dev/infra/scripts/infisical-mi-token.sh")"

get_secret() { # project_id key
  infisical secrets get "$2" --token="$LUMITRA_TOK" --projectId="$1" \
    --domain="$DOMAIN" --env=prod --path=/ --plain 2>/dev/null
}

echo "== Pre-check: AUTH_BRAIN_URL must be in storage-brain prod Infisical =="
if [ -z "$(get_secret "$SB_PROJECT_ID" AUTH_BRAIN_URL || true)" ]; then
  echo "MISSING. Set it first (Lumitra org session or Infisical UI), then restart the SB API app in Coolify:"
  echo "  infisical secrets set AUTH_BRAIN_URL=https://auth.lumitra.co --projectId=$SB_PROJECT_ID --env=prod --path=/ --domain=$DOMAIN"
  exit 1
fi
echo "present."

echo
echo "== 0. Resolve admin keys from Infisical (values stay in shell vars) =="
SB_ADMIN_KEY="$(get_secret "$SB_PROJECT_ID" ADMIN_API_KEY)"
[ -n "$SB_ADMIN_KEY" ] || { echo "FATAL: could not read storage-brain ADMIN_API_KEY"; exit 1; }

# auth-brain project id is not pinned locally; probe the Lumitra projects the
# dev MI can see. Override with AB_PROJECT_ID=<uuid> to skip the probe.
AB_ADMIN_KEY=""
for pid in ${AB_PROJECT_ID:-9af620f0-be34-4a82-859b-0026306eea64 c5041cf9-c523-4ecb-a5ea-f0cffa18dc3b 56bd6cd4-f5d7-4ddb-8aac-b204cee5e264 d896344c-45a2-4da1-a752-22348055ebca 45b9c32b-3deb-42ef-ad8a-9a931b86c01a 934b272e-0a37-4eb1-9b12-0530d3d2ff23 95d42533-3157-4b66-a49b-cc386ec1214d 6adabd49-59d3-4bab-8a1e-c104a0da3c64}; do
  v="$(get_secret "$pid" ADMIN_API_KEY || true)"
  # Distinguish auth-brain's from storage-brain's by value inequality
  if [ -n "$v" ] && [ "$v" != "$SB_ADMIN_KEY" ]; then
    # Confirm it actually authenticates against auth-brain
    code=$(curl -s -o /dev/null -w '%{http_code}' "$AUTH/api/admin/machine/tenants?limit=1" -H "Authorization: Bearer $v")
    if [ "$code" = "200" ]; then AB_ADMIN_KEY="$v"; echo "auth-brain ADMIN_API_KEY found in project $pid"; break; fi
  fi
done
[ -n "$AB_ADMIN_KEY" ] || { echo "FATAL: no auth-brain ADMIN_API_KEY found; set AB_PROJECT_ID=<uuid> and rerun"; exit 1; }

echo
echo "== 1. Storage Brain tenants (find the lola-stories one) =="
curl -sf "$SB/api/v1/admin/tenants" -H "Authorization: Bearer $SB_ADMIN_KEY" \
  | python3 -c "import json,sys; [print(t['id'], t['name']) for t in json.load(sys.stdin).get('tenants', [])]"
read -rp "Storage Brain tenant id for lola-stories: " SB_TENANT_ID

echo
echo "== 2. auth-brain tenants (pick the parent for the workspace) =="
curl -sf "$AUTH/api/admin/machine/tenants" -H "Authorization: Bearer $AB_ADMIN_KEY" \
  | python3 -c "import json,sys; [print(t.get('id'), t.get('slug'), t.get('name')) for t in json.load(sys.stdin).get('items', [])]"
read -rp "auth-brain tenant slug to create/find the lola-stories workspace under: " AB_TENANT_SLUG

echo
echo "== 3. Find or create the lola-stories workspace =="
WS_ID=$(curl -sf "$AUTH/api/admin/machine/workspaces?tenant_slug=$AB_TENANT_SLUG" -H "Authorization: Bearer $AB_ADMIN_KEY" \
  | python3 -c "import json,sys; print(next((w['id'] for w in json.load(sys.stdin).get('items', []) if w.get('slug')=='lola-stories'), ''))")
if [ -z "$WS_ID" ]; then
  WS_ID=$(curl -sf -X POST "$AUTH/api/admin/machine/workspaces" -H "Authorization: Bearer $AB_ADMIN_KEY" -H 'Content-Type: application/json' \
    -d "{\"owner_email\":\"$ACTOR_EMAIL\",\"tenant_slug\":\"$AB_TENANT_SLUG\",\"name\":\"Lola Stories\",\"slug\":\"lola-stories\"}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('workspace',{}).get('id') or d.get('id',''))")
  echo "created workspace: $WS_ID"
else
  echo "workspace exists: $WS_ID"
fi
[ -n "$WS_ID" ] || { echo "FATAL: no workspace id"; exit 1; }

echo
echo "== 4. Find or create the service account (role: member) =="
SA_ID=$(curl -sf "$AUTH/api/admin/machine/service-accounts?workspace_id=$WS_ID" -H "Authorization: Bearer $AB_ADMIN_KEY" \
  | python3 -c "import json,sys; print(next((s['id'] for s in json.load(sys.stdin).get('items', []) if s.get('name')=='lola-stories-api'), ''))")
if [ -z "$SA_ID" ]; then
  SA_ID=$(curl -sf -X POST "$AUTH/api/admin/machine/service-accounts" -H "Authorization: Bearer $AB_ADMIN_KEY" -H 'Content-Type: application/json' \
    -d "{\"actor_email\":\"$ACTOR_EMAIL\",\"scope\":{\"workspace_id\":\"$WS_ID\"},\"name\":\"lola-stories-api\",\"role\":\"member\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('service_account_id',''))")
  echo "created service account: $SA_ID"
else
  echo "service account exists: $SA_ID"
fi
[ -n "$SA_ID" ] || { echo "FATAL: no service account id"; exit 1; }

echo
echo "== 5. Bind the SB tenant to the auth-brain workspace =="
curl -sf -X PATCH "$SB/api/v1/admin/tenants/$SB_TENANT_ID" -H "Authorization: Bearer $SB_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d "{\"authWorkspaceId\":\"$WS_ID\"}" >/dev/null && echo "bound tenant $SB_TENANT_ID -> workspace $WS_ID"

echo
echo "== 6. Issue the API key (plaintext stays in this shell) =="
NEW_KEY=$(curl -sf -X POST "$AUTH/api/admin/machine/service-accounts/$SA_ID/keys" -H "Authorization: Bearer $AB_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d "{\"actor_email\":\"$ACTOR_EMAIL\",\"name\":\"lola-stories prod\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('api_key',''))")
[ -n "$NEW_KEY" ] || { echo "FATAL: key issuance failed"; exit 1; }
echo "key issued (not printed)"

echo
echo "== 7. Smoke test: new key against prod (old key untouched) =="
code=$(curl -s -o /dev/null -w '%{http_code}' "$SB/api/v1/tenant/info" -H "Authorization: Bearer $NEW_KEY")
if [ "$code" = "200" ]; then echo "PASS: new auth-brain key resolves the tenant (200)"; else echo "FAIL: got $code, aborting before any swap"; exit 1; fi

echo
echo "== 8. Stage the swap in lola-stories Infisical (needs LOLA org session) =="
read -rp "Write STORAGE_BRAIN_API_KEY to lola-stories prod Infisical now? [y/N] " yn
if [ "$yn" = "y" ]; then
  infisical secrets set STORAGE_BRAIN_API_KEY="$NEW_KEY" --projectId="$LOLA_PROJECT_ID" --env=prod --path=/ --domain="$DOMAIN"
  echo "done. Redeploy lola-stories to pick it up. Rollback = restore the previous value."
else
  echo "skipped. Set it in the Infisical UI (project lola-stories, prod, STORAGE_BRAIN_API_KEY)."
fi

echo
echo "All steps complete. After a soak period, revoke the legacy SB tenant key via"
echo "POST $SB/api/v1/admin/tenants/$SB_TENANT_ID/regenerate-key (or leave it until workstream 4)."
