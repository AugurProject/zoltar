import { resolve } from 'node:path'

// Sidecar directory layout that the state stores derive from the durable state path.
export function immutableTopologySidecarDirectory(statePath: string) {
	return `${resolve(statePath)}.immutable-topology-v1`
}

export function protocolIndexSidecarDirectory(statePath: string) {
	return `${resolve(statePath)}.protocol-index-v1`
}
