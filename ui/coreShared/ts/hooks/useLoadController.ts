import { useRef } from 'preact/hooks'
import { createLoadController, type LoadController } from '../lib/loadState.js'

export function useLoadController(options?: Parameters<typeof createLoadController>[0]) {
	const controllerRef = useRef<LoadController | undefined>(undefined)
	if (controllerRef.current === undefined) controllerRef.current = createLoadController(options)
	return controllerRef.current
}
