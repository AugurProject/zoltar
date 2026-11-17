import { expect, test } from 'bun:test'
import { loadCentralPortfolioQuestion } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolioState.js'
import { createMockLoaderClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { centralPortfolioRead, owner, portfolio, capital, type CentralPortfolioMode } from '../features/portfolios/capitalFixture.js'

test.each<CentralPortfolioMode>(['active', 'stale', 'runoff', 'sealed', 'disabled', 'frozen', 'basket'])('bound question previews use native fee time and central inherited supply while %s', async mode => {
	const blocks: (bigint | undefined)[] = []
	const client = createMockLoaderClient({
		multicall: async request => {
			blocks.push(request.blockNumber)
			return request.contracts.map(call => centralPortfolioRead(call.functionName, mode))
		},
	})
	expect(await loadCentralPortfolioQuestion(client, owner, capital, 99n)).toEqual({
		centralSettlement: true,
		centralCheckpointTimestamp: 5_000n,
		portfolioAddress: portfolio,
		feePrincipalAttoEth: 100n,
		settlementCollateralAttoEth: 60n,
		settlementRecoveryAttoRep: mode === 'basket' ? 90n : 0n,
		shareTokenSupplyAttoShares: 100n,
		mintingCapacityAttoEth: 80n,
		totalPoolHeldAttoRep: 300n,
		totalUnderwritingLimitAttoEth: 200n,
		feeEligibleUnderwritingLimitAttoEth: 120n,
		lastFeeCheckpointNativeTime: 1000n,
		linearFee: { rateAttoEthPerSecond: mode === 'active' || mode === 'basket' ? 2_000_000_000n : 0n, rateScale: 1_000_000_000n, endTime: 2000n },
		feeEndTimestamp: 2000n,
	})
	expect(blocks).toEqual([99n, 99n, 99n, 99n])
})

test('cash funding is read from the ledger predicate independently of its internal unit index', async () => {
	const client = createMockLoaderClient({
		multicall: async request =>
			request.contracts.map(call => {
				if (call.functionName !== 'books') return centralPortfolioRead(call.functionName, 'active')
				const state = centralPortfolioRead('books', 'active')
				if (!Array.isArray(state)) throw new Error('Missing book fixture')
				const indexed = [...state]
				indexed[0] = 1n
				indexed[1] = 10n ** 30n
				return indexed
			}),
	})
	expect((await loadCentralPortfolioQuestion(client, owner, capital, 99n)).linearFee.rateAttoEthPerSecond).toBe(2_000_000_000n)
})
