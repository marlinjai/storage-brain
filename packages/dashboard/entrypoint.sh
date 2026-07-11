#!/bin/sh
set -e

# Next.js standalone binds to $HOSTNAME. The container runtime sets HOSTNAME to
# the container id, so the server listens on that host's IP only and is
# unreachable on localhost, which fails Coolify's in-container healthcheck and
# triggers a rollback. Force binding to all interfaces.
export HOSTNAME=0.0.0.0

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

# Inject secrets and start the app
exec infisical run \
  --env=prod \
  --projectId="$PROJECT_ID" \
  --domain "$DOMAIN" \
  -- env -u INFISICAL_TOKEN node packages/dashboard/server.js
