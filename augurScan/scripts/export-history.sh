#!/usr/bin/env bash

augurscan_curl() {
	curl "$@"
}

augurscan_export_readiness() {
	augurscan_curl --fail --silent --show-error "$AUGURSCAN_EXPORT_URL/health/ready"
}

augurscan_verify_export_page() {
	docker compose run --rm --no-deps \
		--user "$(id -u):$(id -g)" \
		--volume "$AUGURSCAN_EXPORT_DIRECTORY:/evidence:ro" \
		--entrypoint bun \
		app augurScan/scripts/verify-export-page.ts "$@"
}

augurscan_export_history() {
	: "${AUGURSCAN_DATABASE_MODE:?Set AUGURSCAN_DATABASE_MODE to bundled or external}"
	: "${AUGURSCAN_RESTORE_URL:?Set the direct, container-reachable restore URL}"
	: "${AUGURSCAN_CHAIN_ID:?Set the export chain ID}"
	: "${AUGURSCAN_EXPORT_DIRECTORY:?Set a new export directory}"

	case "$AUGURSCAN_DATABASE_MODE" in
		bundled)
			: "${AUGURSCAN_RESTORE_DATABASE:?Set the verified restore database name}"
			[[ "$AUGURSCAN_RESTORE_DATABASE" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] || {
				echo 'AUGURSCAN_RESTORE_DATABASE must be a simple PostgreSQL identifier.' >&2
				return 2
			}
			test "$(printf '%s\n' "$AUGURSCAN_RESTORE_URL" | sed -n 's#^[^:]*://[^@]*@\([^/:]*\).*#\1#p')" = postgres || {
				echo 'Bundled AUGURSCAN_RESTORE_URL must use the postgres service hostname.' >&2
				return 2
			}
			test "$(printf '%s\n' "$AUGURSCAN_RESTORE_URL" | sed -n 's#^[^:]*://[^@]*@[^/]*/\([^?]*\).*$#\1#p')" = "$AUGURSCAN_RESTORE_DATABASE" || {
				echo 'Bundled AUGURSCAN_RESTORE_URL must name the verified restore database.' >&2
				return 2
			}
			;;
		external) ;;
		*)
			echo 'AUGURSCAN_DATABASE_MODE must be bundled or external.' >&2
			return 2
			;;
	esac

	[[ "$AUGURSCAN_CHAIN_ID" =~ ^[0-9]+$ ]] || {
		echo 'AUGURSCAN_CHAIN_ID must be a non-negative integer.' >&2
		return 2
	}
	AUGURSCAN_EXPORT_DATASET=${AUGURSCAN_EXPORT_DATASET:-logs}
	AUGURSCAN_EXPORT_CANONICAL=${AUGURSCAN_EXPORT_CANONICAL:-all}
	AUGURSCAN_EXPORT_FROM_BLOCK=${AUGURSCAN_EXPORT_FROM_BLOCK:-0}
	AUGURSCAN_EXPORT_TO_BLOCK=${AUGURSCAN_EXPORT_TO_BLOCK:-9223372036854775807}
	AUGURSCAN_EXPORT_PORT=${AUGURSCAN_EXPORT_PORT:-3002}
	case "$AUGURSCAN_EXPORT_DATASET" in
		logs | timeline) ;;
		reorgs)
			test "$AUGURSCAN_EXPORT_CANONICAL" = all || {
				echo 'Reorganization exports require AUGURSCAN_EXPORT_CANONICAL=all.' >&2
				return 2
			}
			;;
		*)
			echo 'AUGURSCAN_EXPORT_DATASET must be logs, timeline, or reorgs.' >&2
			return 2
			;;
	esac
	case "$AUGURSCAN_EXPORT_CANONICAL" in
		canonical | orphaned | all) ;;
		*)
			echo 'AUGURSCAN_EXPORT_CANONICAL must be canonical, orphaned, or all.' >&2
			return 2
			;;
	esac
	[[ "$AUGURSCAN_EXPORT_FROM_BLOCK" =~ ^[0-9]+$ && "$AUGURSCAN_EXPORT_TO_BLOCK" =~ ^[0-9]+$ ]] || {
		echo 'Export block bounds must be non-negative integers.' >&2
		return 2
	}
	[[ "$AUGURSCAN_EXPORT_PORT" =~ ^[0-9]+$ ]] && ((AUGURSCAN_EXPORT_PORT >= 1 && AUGURSCAN_EXPORT_PORT <= 65535)) || {
		echo 'AUGURSCAN_EXPORT_PORT must be between 1 and 65535.' >&2
		return 2
	}

	local script_directory project_root
	script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
	project_root=$(cd "$script_directory/.." && pwd -P)
	# shellcheck source=export-container-cleanup.sh
	source "$script_directory/export-container-cleanup.sh"
	cd "$project_root"
	mkdir -p "$AUGURSCAN_EXPORT_DIRECTORY"
	AUGURSCAN_EXPORT_DIRECTORY=$(cd "$AUGURSCAN_EXPORT_DIRECTORY" && pwd -P)
	export AUGURSCAN_EXPORT_DIRECTORY
	AUGURSCAN_EXPORT_CONTAINER=${AUGURSCAN_EXPORT_CONTAINER:-"augurscan-export-$$"}
	AUGURSCAN_EXPORT_URL="http://localhost:$AUGURSCAN_EXPORT_PORT"
	export AUGURSCAN_EXPORT_CONTAINER AUGURSCAN_EXPORT_URL

	docker compose run --detach --rm --no-deps \
		--name "$AUGURSCAN_EXPORT_CONTAINER" \
		--publish "127.0.0.1:$AUGURSCAN_EXPORT_PORT:3000" \
		--env "POSTGRES_URL=$AUGURSCAN_RESTORE_URL" \
		--env DISABLE_INDEXER=1 \
		app >/dev/null
	augurscan_install_export_cleanup

	local ready=0
	for _ in {1..30}; do
		if augurscan_export_readiness; then
			ready=1
			break
		fi
		sleep 2
	done
	if test "$ready" != 1; then
		docker logs "$AUGURSCAN_EXPORT_CONTAINER" >&2
		return 1
	fi

	local cursor= validation= page=0
	while :; do
		local page_directory pending body headers status pending_name
		page_directory="$AUGURSCAN_EXPORT_DIRECTORY/page-$page"
		test ! -e "$page_directory" || {
			echo "Refusing to overwrite $page_directory" >&2
			return 1
		}
		pending=$(mktemp -d "$AUGURSCAN_EXPORT_DIRECTORY/.page-$page.pending.XXXXXX")
		body="$pending/evidence.ndjson"
		headers="$pending/headers"
		local request_args=(
			--silent --show-error --dump-header "$headers" --output "$body"
			--write-out '%{http_code}' --get "$AUGURSCAN_EXPORT_URL/api/v1/export"
			--data-urlencode "chainId=$AUGURSCAN_CHAIN_ID"
			--data-urlencode "dataset=$AUGURSCAN_EXPORT_DATASET"
			--data-urlencode "canonical=$AUGURSCAN_EXPORT_CANONICAL"
			--data-urlencode "fromBlock=$AUGURSCAN_EXPORT_FROM_BLOCK"
			--data-urlencode "toBlock=$AUGURSCAN_EXPORT_TO_BLOCK"
			--data-urlencode 'limit=50000'
		)
		if test -n "$cursor"; then
			request_args+=(--data-urlencode "cursor=$cursor")
		fi
		if status=$(augurscan_curl "${request_args[@]}"); then
			case "$status" in
				2??) ;;
				409)
					mv "$pending" "$AUGURSCAN_EXPORT_DIRECTORY/INVALIDATED-page-$page"
					echo 'The export boundary changed. Quarantine this attempt and restart at page zero.' >&2
					return 1
					;;
				*)
					mv "$pending" "$AUGURSCAN_EXPORT_DIRECTORY/FAILED-page-$page"
					echo "Export failed with HTTP $status; inspect the saved response." >&2
					return 1
					;;
			esac
		else
			mv "$pending" "$AUGURSCAN_EXPORT_DIRECTORY/FAILED-page-$page"
			echo 'Export transport failed; inspect the saved response and retry in a new attempt.' >&2
			return 1
		fi

		pending_name=$(basename "$pending")
		local validation_args=(
			"/evidence/$pending_name/headers"
			"/evidence/$pending_name/evidence.ndjson"
			"$AUGURSCAN_EXPORT_DATASET"
			"$AUGURSCAN_CHAIN_ID"
			"$AUGURSCAN_EXPORT_CANONICAL"
			"$AUGURSCAN_EXPORT_FROM_BLOCK"
			"$AUGURSCAN_EXPORT_TO_BLOCK"
		)
		if test -n "$validation"; then
			validation_args+=("$validation" "$cursor")
		fi
		if ! augurscan_verify_export_page "${validation_args[@]}" >"$pending/validation.json"; then
			mv "$pending" "$AUGURSCAN_EXPORT_DIRECTORY/INVALID-page-$page"
			echo 'Export proof failed; inspect the quarantined headers, body, and validation output.' >&2
			return 1
		fi
		cursor=$(tr -d '\r' <"$headers" | awk 'tolower($1) == "x-augurscan-next-cursor:" { print $2 }')
		mv "$pending" "$page_directory"
		validation="/evidence/page-$page/validation.json"
		test -n "$cursor" || break
		page=$((page + 1))
	done

	docker stop "$AUGURSCAN_EXPORT_CONTAINER" >/dev/null
	augurscan_disarm_export_cleanup
	printf 'Validated export: %s\n' "$AUGURSCAN_EXPORT_DIRECTORY"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	set -euo pipefail
	augurscan_export_history "$@"
fi
