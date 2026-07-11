#!/bin/sh
set -e

PROJECT_ID="86dcae14-6cb2-473b-8b2d-43b37977f04e"
DOMAIN="https://infisical.lumitra.co"

# Authenticate with Infisical via machine identity (Universal Auth)
INFISICAL_TOKEN=$(infisical login \
  --method=universal-auth \
  --client-id="$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" \
  --client-secret="$INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET" \
  --domain "$DOMAIN" \
  --silent --plain)

# Pass the token via the environment, NOT --token: argv is visible to every
# process in the container (ps, /proc/*/cmdline), which is how a live token
# once leaked into a debugging transcript. `env -u` strips it from the app
# process again so it lives only in the infisical wrapper.
export INFISICAL_TOKEN

# Inject secrets and start the app — call tsx directly to avoid Corepack
# downloading pnpm from npmjs.org on every container start (can take 17+ min
# when the registry is slow because the app user can't access root's corepack cache).
exec infisical run \
  --env=prod \
  --projectId="$PROJECT_ID" \
  --domain "$DOMAIN" \
  -- env -u INFISICAL_TOKEN /app/packages/api/node_modules/.bin/tsx /app/packages/api/src/node.ts
