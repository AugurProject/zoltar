#!/bin/sh

set -eu

# Compose persists operator state in this mounted directory. Each image serves one bot, so at most one of the
# bot-specific configuration selectors may be set.
default_settings_file='.state/operator.json'
if [ -n "${ZOLTAR_LIQUIDATOR_CONFIG:-}" ] && [ -n "${OPEN_ORACLE_ARBITRAGER_CONFIG:-}" ]; then
	echo 'Set only one of ZOLTAR_LIQUIDATOR_CONFIG and OPEN_ORACLE_ARBITRAGER_CONFIG' >&2
	exit 1
fi
settings_file=${ZOLTAR_LIQUIDATOR_CONFIG:-${OPEN_ORACLE_ARBITRAGER_CONFIG:-$default_settings_file}}
temporary_file=''

cleanup() {
	if [ -n "$temporary_file" ]; then
		rm -f "$temporary_file"
	fi
}

trap cleanup EXIT HUP INT TERM

if [ -L .state ] || [ ! -d .state ]; then
	echo 'bot state path must be a real directory' >&2
	exit 1
fi
chmod 700 .state

if [ ! -e "$settings_file" ] && [ ! -L "$settings_file" ] && [ "$settings_file" != "$default_settings_file" ]; then
	echo 'Selected bot configuration does not exist' >&2
	exit 1
fi

if [ ! -e "$settings_file" ] && [ ! -L "$settings_file" ]; then
	umask 077
	temporary_file=$(mktemp '.state/operator.json.XXXXXX')
	sed 's/"uiHost": "127.0.0.1"/"uiHost": "0.0.0.0"/' config/operator.example.json > "$temporary_file"
	chmod 600 "$temporary_file"
	mv "$temporary_file" "$settings_file"
	temporary_file=''
fi

if [ -L "$settings_file" ]; then
	echo 'bot settings file must not be a symbolic link' >&2
	exit 1
fi

if [ -f "$settings_file" ]; then
	chmod 600 "$settings_file"
fi

trap - EXIT HUP INT TERM
exec "$@"
