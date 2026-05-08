import type { ReadinessAction } from '../types/components.js'

export function countReadyActions(actions: ReadinessAction[]) {
	return actions.filter(action => action.readiness === 'ready').length
}
