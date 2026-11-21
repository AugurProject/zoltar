import { recordOperation, type OperatorState } from '#state/operator-state'
import type { MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'

/** Surface degraded independence to both dashboard and headless operators once per transition. */
export function updateHeadMarketConsensus(state: Pick<OperatorState, 'marketConsensus' | 'operationLog'>, next: MarketConsensusEstimate | undefined) {
	const fallback = (estimate: MarketConsensusEstimate | undefined) => {
		if (estimate?.reliable !== true || estimate.cex.reliable === estimate.dex.reliable) return undefined
		return estimate.cex.reliable ? 'CEX' : 'DEX'
	}
	const previous = fallback(state.marketConsensus)
	state.marketConsensus = next
	const group = fallback(next)
	if (group === undefined || group === previous) return
	const reason = `${group}-only market consensus fallback`
	recordOperation(state, { category: 'decision', details: undefined, level: 'warning', message: 'Independent CEX + DEX consensus unavailable', reportId: undefined, reason })
	console.warn(reason)
}
