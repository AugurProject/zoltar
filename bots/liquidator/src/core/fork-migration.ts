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

function approvedChildUniverses(universes: readonly UniverseObservation[], approvedUniverses: readonly bigint[]) {
	const childrenByParentUniverse = new Map<string, Set<string>>()
	for (const universe of universes) {
		if (universe.parentId === undefined || !approvedUniverses.includes(universe.id)) continue
		const key = universe.parentId.toString()
		const children = childrenByParentUniverse.get(key) ?? new Set<string>()
		children.add(universe.id.toString())
		childrenByParentUniverse.set(key, children)
	}
	return childrenByParentUniverse
}

export function validateApprovedUniverseSelection(universes: readonly UniverseObservation[], approvedUniverses: readonly bigint[]) {
	const knownUniverses = new Set(universes.map(universe => universe.id.toString()))
	const unknown = approvedUniverses.find(universe => !knownUniverses.has(universe.toString()))
	if (unknown !== undefined) throw new Error(`Universe ${unknown.toString()} is not present in the Zoltar universe tree`)
	for (const [parentUniverse, children] of approvedChildUniverses(universes, approvedUniverses)) {
		if (children.size > 1) {
			throw new Error(`Select only one truthful child of universe ${parentUniverse}`)
		}
	}
}

export function selectVaultMigration(pools: readonly PoolObservation[], universes: readonly UniverseObservation[], settings: OperatorSettings, currentTimestamp: bigint): VaultMigration | undefined {
	if (!settings.strategy.allowAutomaticVaultMigrations) return undefined
	validateApprovedUniverseSelection(universes, settings.approvedUniverses)
	for (const parent of pools) {
		if (!parent.selected || parent.systemState !== 1n || !hasVaultPosition(parent) || hasBotStagedOperation(parent) || parent.forkActivationTime === 0n) continue
		const approvedChildren = universes.filter(universe => universe.parentId === parent.universeId && settings.approvedUniverses.includes(universe.id))
		const childUniverse = approvedChildren[0]
		if (childUniverse === undefined || childUniverse.outcomeIndex === undefined) continue
		const childPool = pools.find(pool => pool.parent.toLowerCase() === parent.address.toLowerCase() && pool.universeId === childUniverse.id)
		if (childPool !== undefined && childPool.securityPoolForker.toLowerCase() !== parent.securityPoolForker.toLowerCase()) {
			throw new Error(`Forker mismatch between parent pool ${parent.address} and child pool ${childPool.address}`)
		}
		const deadline = parent.forkActivationTime + FORK_MIGRATION_WINDOW_SECONDS
		if (currentTimestamp > deadline) continue
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
