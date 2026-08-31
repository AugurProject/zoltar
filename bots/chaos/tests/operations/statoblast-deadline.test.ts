import { describe, expect, test } from 'bun:test'
import { eligibleOperationPlans } from '../../src/operations/catalog.ts'
import { address, snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maximumBlockIntervalSeconds: 15,
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 0x1234_5678,
} as const

describe('Statoblast timestamp safety', () => {
	test('does not plan a deadline-bound auction call inside one custom-chain block interval', () => {
		const snapshot = snapshotFixture()
		snapshot.auctions = [
			{
				address: address(40),
				bids: [],
				clearingTick: '0',
				endTime: (BigInt(snapshot.anchor.timestamp) + 200n).toString(),
				finalized: false,
				hasClearingPrice: false,
				minimumBidAttoEth: 1n.toString(),
				pendingEthRefund: '0',
				pool: snapshot.pools[0]?.address ?? address(11),
				startTime: '1',
				underfunded: false,
				underfundedWinningAttoEth: 0n.toString(),
			},
		]

		expect(eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.auction.bid')).toBeDefined()
		expect(eligibleOperationPlans(snapshot, { ...options, maximumBlockIntervalSeconds: 300 }).find(plan => plan.definitionId === 'statoblast.auction.bid')).toBeUndefined()
	})
})
