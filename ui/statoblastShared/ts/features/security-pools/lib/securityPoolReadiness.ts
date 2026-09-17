import type { ReadinessAction } from '../../types.js'

export function getSecurityPoolVaultReadinessActions(actions: Omit<ReadinessAction, 'title'>[]) {
	return actions
}
