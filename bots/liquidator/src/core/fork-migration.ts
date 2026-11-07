export { validateApprovedUniverseSelection } from '@zoltar/bot-shared/monitoring/universe-policy'
import type { PoolObservation } from '#state/operator-state'

const FORK_MIGRATION_WINDOW_SECONDS = 8n * 7n * 24n * 60n * 60n

function hasVaultPosition(pool: PoolObservation) {
	return pool.botVault.backingUnits > 0n || pool.botVault.openInterestAttoEth > 0n
}

function hasBotStagedOperation(pool: PoolObservation) {
	const vault = pool.botVault.address.toLowerCase()
	return pool.stagedOperations.some(operation => operation.operator.toLowerCase() === vault || operation.receiverVault.toLowerCase() === vault || operation.targetVault.toLowerCase() === vault)
}

export function isVaultMigrationSourceEligible(pool: PoolObservation, currentTimestamp: bigint) {
	if (!pool.selected || pool.systemState !== 1n || !hasVaultPosition(pool) || hasBotStagedOperation(pool) || pool.forkActivationTime === 0n) return false
	return currentTimestamp <= pool.forkActivationTime + FORK_MIGRATION_WINDOW_SECONDS
}
