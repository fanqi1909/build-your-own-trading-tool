#!/bin/sh
# start.sh — Write OKX CLI config from env vars, then start the server.
# Required env vars (set via fly secrets):
#   OKX_DEMO_API_KEY, OKX_DEMO_SECRET_KEY, OKX_DEMO_PASSPHRASE
#   APP_PASSWORD
#   CLAUDE_CODE_OAUTH_TOKEN  (sk-ant-oat01-... from claude auth)

set -e

mkdir -p ~/.okx
cat > ~/.okx/config.toml <<EOF
default_profile = "demo"

[profiles.demo]
api_key = "${OKX_DEMO_API_KEY}"
secret_key = "${OKX_DEMO_SECRET_KEY}"
passphrase = "${OKX_DEMO_PASSPHRASE}"
demo = true
EOF

exec node server.js
