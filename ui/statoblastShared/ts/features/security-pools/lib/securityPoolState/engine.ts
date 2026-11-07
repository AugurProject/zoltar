import type { SecurityPoolStateInput, SecurityPoolStateModel } from './types.js'

/** Question trading gates; capital, reporting and branch actions own their separate guards. */
export function evaluateSecurityPoolState(input: SecurityPoolStateInput): SecurityPoolStateModel {
	const settled = input.lifecycleState === 'ended'
	const operational = input.lifecycleState === 'operational' && !input.universeHasForked
	return {
		...input,
		actions: {
			createCompleteSet: { enabled: operational },
			redeemCompleteSet: { enabled: operational || (settled && !input.universeHasForked) },
			migrateShares: { enabled: input.universeHasForked && !settled },
			redeemShares: { enabled: settled },
		},
	}
}
