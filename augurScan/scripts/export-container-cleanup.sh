#!/usr/bin/env bash

augurscan_cleanup_export_container() {
	if test "${AUGURSCAN_EXPORT_CONTAINER_ACTIVE:-0}" != 1; then
		return
	fi
	AUGURSCAN_EXPORT_CONTAINER_ACTIVE=0
	docker rm --force "$AUGURSCAN_EXPORT_CONTAINER" >/dev/null 2>&1 || true
}

augurscan_install_export_cleanup() {
	: "${AUGURSCAN_EXPORT_CONTAINER:?Set the isolated export container name}"
	AUGURSCAN_EXPORT_CONTAINER_ACTIVE=1
	trap augurscan_cleanup_export_container EXIT
}

augurscan_disarm_export_cleanup() {
	AUGURSCAN_EXPORT_CONTAINER_ACTIVE=0
	trap - EXIT
}
