import { describe, expect, test } from 'bun:test'
import { eligibleOperationPlans } from '../support/operation-plans.ts'
import { address, planningOptionsFixture, snapshotFixture } from './fixture.ts'

const options = planningOptionsFixture()

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
