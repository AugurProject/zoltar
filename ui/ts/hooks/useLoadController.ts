import { useRef } from 'preact/hooks'
import { createLoadController, type LoadController } from '../lib/loadState.js'

export function useLoadController() {
	const controllerRef = useRef<LoadController | undefined>(undefined)
	if (controllerRef.current === undefined) {
		controllerRef.current = createLoadController()
	}
	return controllerRef.current
}
