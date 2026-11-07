import { expect, test } from 'bun:test'
import { evaluateSecurityPoolState } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'

test('operational questions allow complete sets but not outcome settlement or migration', () => {
	expect(evaluateSecurityPoolState({ lifecycleState: 'operational', universeHasForked: false }).actions).toEqual({
		createCompleteSet: { enabled: true },
		redeemCompleteSet: { enabled: true },
		migrateShares: { enabled: false },
		redeemShares: { enabled: false },
	})
})
test('unresolved forked questions permit only share migration', () => {
	expect(evaluateSecurityPoolState({ lifecycleState: 'poolForked', universeHasForked: true }).actions).toEqual({
		createCompleteSet: { enabled: false },
		redeemCompleteSet: { enabled: false },
		migrateShares: { enabled: true },
		redeemShares: { enabled: false },
	})
})
test.each([false, true])('a finalized question stays redeemable across a universe fork: %s', universeHasForked => {
	const actions = evaluateSecurityPoolState({ lifecycleState: 'ended', universeHasForked }).actions
	expect(actions.redeemShares.enabled).toBe(true)
	expect(actions.createCompleteSet.enabled).toBe(false)
	expect(actions.migrateShares.enabled).toBe(false)
	expect(actions.redeemCompleteSet.enabled).toBe(!universeHasForked)
})
test('unloaded question state cannot enable a purchase', () => {
	expect(evaluateSecurityPoolState({ universeHasForked: false }).actions.createCompleteSet.enabled).toBe(false)
})
