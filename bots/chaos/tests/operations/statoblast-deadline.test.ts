import { auctionFixture } from '../support/portfolio-fixtures.ts'
import { describe, expect, test } from 'bun:test'
import { eligibleOperationPlans } from '../support/operation-plans.ts'
import { planningOptionsFixture, snapshotFixture } from './fixture.ts'

const options = planningOptionsFixture()

describe('Statoblast timestamp safety', () => {
	test('does not plan a deadline-bound auction call inside one custom-chain block interval', () => {
		const snapshot = snapshotFixture()
		snapshot.auctions = [{ ...auctionFixture(), endTime: (BigInt(snapshot.anchor.timestamp) + 200n).toString() }]

		expect(eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.auction.bid')).toBeDefined()
		expect(eligibleOperationPlans(snapshot, { ...options, maximumBlockIntervalSeconds: 300 }).find(plan => plan.definitionId === 'statoblast.auction.bid')).toBeUndefined()
	})
})
