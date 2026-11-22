import { expect, spyOn, test } from 'bun:test'
import type { MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'
import { updateHeadMarketConsensus } from '../../src/runtime/market-consensus-state.ts'
import { operatorStateFixture } from '../support/operator-state.ts'

function consensus(cex: boolean, dex: boolean): MarketConsensusEstimate {
	const group = (kind: 'cex' | 'dex', reliable: boolean) => ({ kind, reliable, askDepthAttoEth: 1n, bidDepthAttoEth: 1n, maximumPriceRepPerEth: 1n, minimumPriceRepPerEth: 1n, observations: [], priceRepPerEth: 1n, reasons: [], sourceCount: 1 })
	return { assetId: 'rep', chainId: 1, cex: group('cex', cex), dex: group('dex', dex), priceRepPerEth: 1n, reliable: cex || dex, reasons: [], sourceCount: 2 }
}

test('headless operator warns on fallback transitions without repeating each head', () => {
	const warning = spyOn(console, 'warn').mockImplementation(() => {})
	try {
		const state = operatorStateFixture()
		updateHeadMarketConsensus(state, consensus(true, false))
		expect(state.operationLog[0]).toMatchObject({ level: 'warning', reason: 'CEX-only market consensus fallback' })
		updateHeadMarketConsensus(state, consensus(true, false))
		expect(warning).toHaveBeenCalledTimes(1)
		updateHeadMarketConsensus(state, consensus(true, true))
		updateHeadMarketConsensus(state, consensus(false, true))
		expect(warning).toHaveBeenCalledTimes(2)
		expect(state.operationLog[0]?.reason).toBe('DEX-only market consensus fallback')
		updateHeadMarketConsensus(state, undefined)
		expect(state.marketConsensus).toBeUndefined()
	} finally {
		warning.mockRestore()
	}
})
