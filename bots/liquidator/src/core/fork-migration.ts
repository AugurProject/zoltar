import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '#config/settings'
import type { PoolObservation, UniverseObservation } from '#state/operator-state'

export const FORK_MIGRATION_WINDOW_SECONDS = 8n * 7n * 24n * 60n * 60n

export type VaultMigration = {
	childPool: PoolObservation | undefined
	childUniverse: UniverseObservation
	deadline: bigint
	outcomeIndex: bigint
	parent: PoolObservation
}

function hasVaultPosition(pool: PoolObservation) {
	return pool.botVault.ownership > 0n || pool.botVault.allowance > 0n
}

function hasBotStagedOperation(pool: PoolObservation) {
	const vault = pool.botVault.address.toLowerCase()
	return pool.stagedOperations.some(operation => operation.initiatorVault.toLowerCase() === vault || operation.targetVault.toLowerCase() === vault)
}

export function isPoolExecutionEligible(pool: Pick<PoolObservation, 'approvedUniverse' | 'selected' | 'systemState'>) {
	return pool.selected && pool.approvedUniverse && pool.systemState === 0n
}

export function isVaultMigrationSourceEligible(pool: PoolObservation, currentTimestamp: bigint) {
	if (!pool.selected || pool.systemState !== 1n || !hasVaultPosition(pool) || hasBotStagedOperation(pool) || pool.forkActivationTime === 0n) return false
	return currentTimestamp <= pool.forkActivationTime + FORK_MIGRATION_WINDOW_SECONDS
}

export function inheritedChildPoolSelections(pools: readonly PoolObservation[], selectedPools: readonly `0x${string}`[]) {
	const selectedAddresses = new Set(selectedPools.map(pool => pool.toLowerCase()))
	return pools.filter(pool => {
		if (!pool.approvedUniverse || pool.parent === zeroAddress || selectedAddresses.has(pool.address.toLowerCase())) return false
		const parent = pools.find(candidate => candidate.address.toLowerCase() === pool.parent.toLowerCase())
		return parent?.selected === true
	})
}

export function validateApprovedUniverseSelection(universes: readonly UniverseObservation[], approvedUniverses: readonly bigint[]) {
	const universesById = new Map(universes.map(universe => [universe.id.toString(), universe]))
	const unknown = approvedUniverses.find(universe => !universesById.has(universe.toString()))
	if (unknown !== undefined) throw new Error(`Universe ${unknown.toString()} is not present in the Zoltar universe tree`)
	const childChoiceByParent = new Map<string, string>()
	for (const approvedId of approvedUniverses) {
		let child = universesById.get(approvedId.toString())
		const visited = new Set<string>()
		while (child?.parentId !== undefined) {
			const childId = child.id.toString()
			if (visited.has(childId)) throw new Error(`Universe ${childId} has a cyclic parent lineage`)
			visited.add(childId)
			const parentId = child.parentId.toString()
			const selectedChild = childChoiceByParent.get(parentId)
			if (selectedChild !== undefined && selectedChild !== childId) {
				throw new Error(`Select only one truthful child of universe ${parentId}`)
			}
			childChoiceByParent.set(parentId, childId)
			const parent = universesById.get(parentId)
			if (parent === undefined) throw new Error(`Universe ${childId} references unknown parent universe ${parentId}`)
			child = parent
		}
	}
}

export function selectVaultMigration(pools: readonly PoolObservation[], universes: readonly UniverseObservation[], settings: OperatorSettings, currentTimestamp: bigint): VaultMigration | undefined {
	if (!settings.strategy.allowAutomaticVaultMigrations) return undefined
	validateApprovedUniverseSelection(universes, settings.approvedUniverses)
	for (const parent of pools) {
		if (!isVaultMigrationSourceEligible(parent, currentTimestamp)) continue
		const approvedChildren = universes.filter(universe => universe.parentId === parent.universeId && settings.approvedUniverses.includes(universe.id))
		const childUniverse = approvedChildren[0]
		if (childUniverse === undefined || childUniverse.outcomeIndex === undefined) continue
		const childPool = pools.find(pool => pool.parent.toLowerCase() === parent.address.toLowerCase() && pool.universeId === childUniverse.id)
		if (childPool !== undefined && childPool.securityPoolForker.toLowerCase() !== parent.securityPoolForker.toLowerCase()) {
			throw new Error(`Forker mismatch between parent pool ${parent.address} and child pool ${childPool.address}`)
		}
		const deadline = parent.forkActivationTime + FORK_MIGRATION_WINDOW_SECONDS
		return {
			childPool,
			childUniverse,
			deadline,
			outcomeIndex: childUniverse.outcomeIndex,
			parent,
		}
	}
	return undefined
}
