#!/bin/sh

set -eu

# Compose persists operator state in this mounted directory.
settings_file='.state/operator.json'
temporary_file=''

cleanup() {
	if [ -n "$temporary_file" ]; then
		rm -f "$temporary_file"
	fi
}

trap cleanup EXIT HUP INT TERM

if [ ! -e "$settings_file" ]; then
	umask 077
	temporary_file=$(mktemp '.state/operator.json.XXXXXX')
	sed 's/"uiHost": "127.0.0.1"/"uiHost": "0.0.0.0"/' config/operator.example.json > "$temporary_file"
	chmod 600 "$temporary_file"
	mv "$temporary_file" "$settings_file"
	temporary_file=''
fi

if [ -f "$settings_file" ]; then
	chmod 600 "$settings_file"
fi

trap - EXIT HUP INT TERM
exec "$@"
