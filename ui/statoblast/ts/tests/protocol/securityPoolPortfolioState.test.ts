import { expect, test } from 'bun:test'
import { loadCentralPortfolioQuestion } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolioState.js'
import { createMockLoaderClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { owner, portfolio, capital, token } from '../features/portfolios/capitalFixture.js'

test.each(['active', 'stale', 'runoff', 'sealed', 'disabled', 'frozen', 'basket'] as const)('bound question previews use native fee time and central inherited supply while %s', async mode => {
	const blocks: (bigint | undefined)[] = []
	const client = createMockLoaderClient({
		multicall: async request => {
			blocks.push(request.blockNumber)
			return request.contracts.map(call => {
				switch (call.functionName) {
					case 'portfolio':
						return portfolio
					case 'universeId':
						return 42n
					case 'totals':
						return [300n, 200n, 120n]
					case 'questionId':
						return 7n
					case 'isPriceValid':
						return mode !== 'stale'
					case 'ledger':
						return token
					case 'bookIds':
						return 1n
					case 'feeTimestamp':
						return 1000n
					case 'question':
						return [{ units: 60n, outcomeSupplyAttoShares: 100n, finalAfter: 0n, feeRateAttoEthPerSecond: 2n, feeStart: 1000n, feeEnd: 2000n, feePrincipalAttoEth: 100n, rewardShares: 0n }, mode === 'frozen' ? 1n : 0n]
					case 'books':
						return [mode === 'runoff' ? 50n : 100n, 100n, 0n, 1n, 0n, 0n, 123n, mode === 'sealed', 1n, 1n, 1n, mode !== 'disabled', 0n, 877n, 40n, mode === 'basket' ? 150n : 0n]
					case 'settlement':
						return token
					case 'availableMintCapacity':
						return 20n
					case 'snapshotQuestion':
						return { outcomeSupplyAttoShares: 100n, questionCashAttoEth: 60n, questionRecoveryAttoRep: mode === 'basket' ? 90n : 0n, demandAttoEth: 100n, earnedFeesAttoEth: 0n, timestamp: 123n }
					default:
						throw new Error(`Unexpected ${call.functionName}`)
				}
			})
		},
	})
	expect(await loadCentralPortfolioQuestion(client, owner, capital, 99n)).toEqual({
		centralSettlement: true,
		settlementCollateralAttoEth: 60n,
		settlementRecoveryAttoRep: mode === 'basket' ? 90n : 0n,
		shareTokenSupplyAttoShares: 100n,
		mintingCapacityAttoEth: 80n,
		totalPoolHeldAttoRep: 300n,
		totalUnderwritingLimitAttoEth: 200n,
		feeEligibleUnderwritingLimitAttoEth: 120n,
		lastUpdatedFeeAccumulator: 1000n,
		linearFee: { rateAttoEthPerSecond: mode === 'active' ? 2n : 0n, endTime: 2000n },
		feeEndTimestamp: 2000n,
	})
	expect(blocks).toEqual([99n, 99n, 99n, 99n])
})
