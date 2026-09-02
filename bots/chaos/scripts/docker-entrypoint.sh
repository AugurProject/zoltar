#!/bin/sh

set -eu

settings_file='.state/operator.json'
temporary_file=''
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

cleanup() {
	if [ -n "$temporary_file" ]; then
		rm -f "$temporary_file"
	fi
}

trap cleanup EXIT HUP INT TERM

if [ -L .state ] || [ ! -d .state ]; then
	echo 'chaos state path must be a real directory' >&2
	exit 1
fi
chmod 700 .state

if [ ! -e "$settings_file" ]; then
	umask 077
	temporary_file=$(mktemp '.state/operator.json.XXXXXX')
	sed 's/"uiHost": "127.0.0.1"/"uiHost": "0.0.0.0"/' config/operator.example.json > "$temporary_file"
	chmod 600 "$temporary_file"
	mv "$temporary_file" "$settings_file"
	temporary_file=''
fi

if [ -L "$settings_file" ]; then
	echo 'chaos settings file must not be a symbolic link' >&2
	exit 1
fi

if [ -f "$settings_file" ]; then
	chmod 600 "$settings_file"
fi

bun "$script_directory/validate-container-paths.mts" "$settings_file"

if [ "$#" -eq 3 ]; then
	if [ "$1" = 'bun' ] && [ "$2" = 'run' ] && [ "$3" = 'run' ]; then
		echo 'Checking persisted chaos launch policy before starting the operator.'
		bun "$script_directory/../src/cli/doctor.ts" --if-live-capable
	fi
fi

trap - EXIT HUP INT TERM
exec "$@"
