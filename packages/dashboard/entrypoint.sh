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

# Inject secrets and start the app
exec infisical run \
  --env=prod \
  --projectId="$PROJECT_ID" \
  --domain "$DOMAIN" \
  --token "$INFISICAL_TOKEN" \
  -- node packages/dashboard/server.js
