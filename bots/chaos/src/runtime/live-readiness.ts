import type { StrategySettings } from '../config/settings.ts'
import type { EvaluatedOperation } from '../operations/types.ts'
import type { RuntimeTopologySummary, WalletBalanceState } from '../state/operator-state.ts'

type LiveInventoryStrategy = Pick<StrategySettings, 'maximumEthPerOperationAttoEth' | 'maximumGasCostAttoEth' | 'maximumRepPerOperationAttoRep' | 'minimumEthReserveAttoEth' | 'minimumRepReserveAttoRep'>
type CanonicalUniverse = Pick<RuntimeTopologySummary['universes'][number], 'id' | 'repToken'>

function inventoryAmount(value: string, label: string) {
	try {
		const amount = BigInt(value)
		if (amount < 0n) throw new Error(`${label} cannot be negative`)
		return amount
	} catch (error) {
		throw new Error(`The latest canonical scan returned an invalid ${label} balance`, { cause: error })
	}
}

export function requiredLiveInventory(strategy: LiveInventoryStrategy) {
	return {
		ethAttoEth: strategy.minimumEthReserveAttoEth + strategy.maximumEthPerOperationAttoEth + strategy.maximumGasCostAttoEth,
		repAttoRep: strategy.minimumRepReserveAttoRep + strategy.maximumRepPerOperationAttoRep,
	}
}

export function liveInventoryReadinessBlockers(inventory: Pick<WalletBalanceState, 'eth' | 'rep'>, universes: readonly CanonicalUniverse[], strategy: LiveInventoryStrategy) {
	const blockers: string[] = []
	const required = requiredLiveInventory(strategy)
	if (inventoryAmount(inventory.eth, 'ETH') < required.ethAttoEth) {
		blockers.push('Live execution requires scanned ETH inventory to cover strategy.minimumEthReserve plus one strategy.maximumEthPerOperation principal and one strategy.maximumGasCostEth budget')
	}
	const canonicalRepTokens = new Set(universes.map(universe => `${universe.id}:${universe.repToken.toLowerCase()}`))
	const fundedRep = inventory.rep.some(candidate => {
		if (!canonicalRepTokens.has(`${candidate.universeId}:${candidate.token.toLowerCase()}`)) return false
		return inventoryAmount(candidate.balance, `${candidate.symbol} REP`) >= required.repAttoRep
	})
	if (!fundedRep) {
		blockers.push('Live execution requires at least one canonical REP inventory balance that covers strategy.minimumRepReserve plus one strategy.maximumRepPerOperation principal')
	}
	return blockers
}

export function applyLiveNoveltyInventoryReadiness(evaluations: readonly EvaluatedOperation[], inventory: Pick<WalletBalanceState, 'eth' | 'rep'>, universes: readonly CanonicalUniverse[], strategy: LiveInventoryStrategy) {
	const blockers = liveInventoryReadinessBlockers(inventory, universes, strategy)
	if (blockers.length === 0) return [...evaluations]
	return evaluations.map(evaluation => {
		if (evaluation.definition.classification !== 'selectable') return evaluation
		return {
			definition: evaluation.definition,
			eligibility: {
				blockers: [...evaluation.eligibility.blockers, ...blockers],
				eligible: false,
			},
		}
	})
}
