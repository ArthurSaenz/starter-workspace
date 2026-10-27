#!/bin/bash

# Rotate Grafana service-account tokens
# Mints a fresh token for each identity and stores it in Doppler.
# Called weekly from .github/workflows/rotate-grafana-tokens.yml

set -eu
export AWS_PAGER=""

: "${WORKSPACE_ID:?}"
: "${DOPPLER_TOKEN:?}"
: "${DOPPLER_PROJECT:?}"
: "${AGENT_CONFIG:?}"
: "${OBSERVABILITY_CONFIG:?}"

# One config per identity — `ik env-load -c <config>` is what picks editor or viewer.
if [ "$AGENT_CONFIG" = "$OBSERVABILITY_CONFIG" ]; then
    echo "AGENT_CONFIG and OBSERVABILITY_CONFIG must be different configs" >&2
    exit 1
fi

rotate() {
    account="$1"
    config="$2"

    # Find the service account
    sa_id=$(aws grafana list-workspace-service-accounts \
        --workspace-id "$WORKSPACE_ID" \
        --query "serviceAccounts[?name=='${account}'].id | [0]" --output text)

    if [ -z "$sa_id" ] || [ "$sa_id" = "None" ]; then
        echo "No Grafana service account named '$account' — has prod been applied?" >&2
        exit 1
    fi

    # Mint a token (2592000s = 30 days, the AMG maximum)
    key=$(aws grafana create-workspace-service-account-token \
        --workspace-id "$WORKSPACE_ID" --service-account-id "$sa_id" \
        --name "rotation-${account}-$(date -u +%Y%m%d)-${GITHUB_RUN_ID:-manual}" \
        --seconds-to-live 2592000 \
        --query 'serviceAccountToken.key' --output text)

    # Store it, before deleting anything — AWS returns the key only once
    curl -sS --fail-with-body -X POST \
        -H "Authorization: Bearer $DOPPLER_TOKEN" \
        -H 'Content-Type: application/json' \
        --data "$(jq -n --arg t "$key" --arg p "$DOPPLER_PROJECT" --arg c "$config" \
            '{project:$p, config:$c, secrets:{GRAFANA_SERVICE_ACCOUNT_TOKEN:$t}}')" \
        https://api.doppler.com/v3/configs/config/secrets >/dev/null

    # Delete old tokens, keeping the two newest so last week's still works
    old_ids=$(aws grafana list-workspace-service-account-tokens \
        --workspace-id "$WORKSPACE_ID" --service-account-id "$sa_id" \
        --query 'sort_by(serviceAccountTokens, &createdAt)[:-2].id' --output text)

    for old in $old_ids; do
        if [ "$old" = "None" ]; then
            continue
        fi
        aws grafana delete-workspace-service-account-token \
            --workspace-id "$WORKSPACE_ID" --service-account-id "$sa_id" --token-id "$old"
    done

    echo "Rotated $account -> $DOPPLER_PROJECT/$config"
}

rotate ai-agent "$AGENT_CONFIG"
rotate ai-observability "$OBSERVABILITY_CONFIG"
