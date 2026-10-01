import { beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import assert from '../../testSupport/simulator/utils/assert'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import {
	activeTickCount,
	computeClearing,
	finalize,
	getActiveTickPage,
	getBidCountAtTick,
	getBidPageAtTick,
	getBidderBidCount,
	getBidderBidPage,
	getEthRaisedAttoEth,
	getTickCount,
	getTickPage,
	getTickSummary,
	getTotalRepPurchasedAttoRep,
	refundLosingBids,
	simulateWithdrawBids,
	startAuction,
	submitBid,
	withdrawBids,
} from '../../testSupport/simulator/utils/contracts/auction'
import { ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { getPendingEthRefund, useAuctionFixture, withdrawPendingEthRefund } from './fixture'
import { ATTOETH_PER_ETH, AUCTION_TIME, computeModeledClearing } from './model'

describe('UniformPriceDualCapBatchAuction: Enumeration Views', () => {
	const fixture = useAuctionFixture()
	const { createTestClient, finalizeAndVerify } = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let auctionAddress: Address

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		auctionAddress = fixture.auctionAddress
	})

	test('getTickPage returns one historical tick per unique tick and tracks same-tick submission counts', async () => {
		const attoEthRaiseCap = 1_000n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 1_000n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const firstTick = 0n
		const secondTick = 10_000n
		const firstTickBidOne = 2n * ATTOETH_PER_ETH
		const firstTickBidTwo = 3n * ATTOETH_PER_ETH
		const secondTickBid = 5n * ATTOETH_PER_ETH

		await submitBid(client, auctionAddress, firstTick, firstTickBidOne)
		await submitBid(client, auctionAddress, firstTick, firstTickBidTwo)
		await submitBid(client, auctionAddress, secondTick, secondTickBid)

		strictEqualTypeSafe(await getTickCount(client, auctionAddress), 2n, 'unique tick count mismatch')

		const tickPage = await getTickPage(client, auctionAddress, 0n, 100n)
		assert.strictEqual(tickPage.length, 2, 'tick page length mismatch')

		const firstSummary = ensureDefined(tickPage[0], 'missing first tick summary')
		strictEqualTypeSafe(firstSummary.tick, firstTick, 'first historical tick mismatch')
		strictEqualTypeSafe(firstSummary.submissionCount, 2n, 'same-tick submission count mismatch')
		strictEqualTypeSafe(firstSummary.currentTotalBidAttoEth, firstTickBidOne + firstTickBidTwo, 'same-tick active ETH mismatch')
		strictEqualTypeSafe(firstSummary.active, true, 'same-tick should stay active')

		const secondSummary = ensureDefined(tickPage[1], 'missing second tick summary')
		strictEqualTypeSafe(secondSummary.tick, secondTick, 'second historical tick mismatch')
		strictEqualTypeSafe(secondSummary.submissionCount, 1n, 'second tick submission count mismatch')
		strictEqualTypeSafe(secondSummary.currentTotalBidAttoEth, secondTickBid, 'second tick active ETH mismatch')
		strictEqualTypeSafe(secondSummary.active, true, 'second tick should stay active')
	})

	test('a fully refunded tick remains enumerable with zero active ETH', async () => {
		const attoEthRaiseCap = 10n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const losingTick = -20_000n
		const winningTick = 0n
		const losingBid = 2n * ATTOETH_PER_ETH
		const winningBid = 12n * ATTOETH_PER_ETH

		await submitBid(client, auctionAddress, losingTick, losingBid)
		await submitBid(client, auctionAddress, winningTick, winningBid)
		await refundLosingBids(client, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

		const tickPage = await getTickPage(client, auctionAddress, 0n, 100n)
		const refundedSummary = tickPage.find((summary: { tick: bigint }) => summary.tick === losingTick)
		const activeSummary = tickPage.find((summary: { tick: bigint }) => summary.tick === winningTick)

		strictEqualTypeSafe(refundedSummary?.currentTotalBidAttoEth, 0n, 'refunded-away tick should have zero active ETH')
		strictEqualTypeSafe(refundedSummary?.submissionCount, 1n, 'refunded-away tick should keep historical submission count')
		strictEqualTypeSafe(refundedSummary?.active, false, 'refunded-away tick should be inactive')
		strictEqualTypeSafe(activeSummary?.active, true, 'winning tick should remain active')
	})

	test('a bid submitted after a fully refunded tick is recreated remains withdrawable', async () => {
		const attoEthRaiseCap = 10n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const firstBidder = createTestClient(1)
		const secondBidder = createTestClient(2)
		const losingTick = -20_000n
		const winningTick = 0n
		const firstLosingBid = 2n * ATTOETH_PER_ETH
		const secondLosingBid = 3n * ATTOETH_PER_ETH
		const winningBid = 12n * ATTOETH_PER_ETH

		await submitBid(firstBidder, auctionAddress, losingTick, firstLosingBid)
		await submitBid(client, auctionAddress, winningTick, winningBid)
		await refundLosingBids(firstBidder, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])
		await submitBid(secondBidder, auctionAddress, losingTick, secondLosingBid)
		await finalizeAndVerify(client, auctionAddress)

		await withdrawBids(client, auctionAddress, client.account.address, [{ tick: winningTick, bidIndex: 0n }])
		strictEqualTypeSafe(await getETHBalance(client, auctionAddress), firstLosingBid + secondLosingBid + (winningBid - attoEthRaiseCap), 'active and credited refund liabilities should remain in the auction')
		await withdrawPendingEthRefund(firstBidder, auctionAddress)
		strictEqualTypeSafe(await getETHBalance(client, auctionAddress), secondLosingBid + (winningBid - attoEthRaiseCap), 'later losing and partial-fill liabilities should remain after the first credit is withdrawn')
		await withdrawBids(client, auctionAddress, secondBidder.account.address, [{ tick: losingTick, bidIndex: 1n }])
		await withdrawPendingEthRefund(secondBidder, auctionAddress)
		await withdrawPendingEthRefund(client, auctionAddress)
		strictEqualTypeSafe(await getETHBalance(client, auctionAddress), 0n, 'the later losing bid credit should be fully withdrawn')
	})

	test('refund-prefix positions remain correct across repeated tick deletion and recreation', async () => {
		const attoEthRaiseCap = 10n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const firstBidder = createTestClient(1)
		const secondBidder = createTestClient(2)
		const thirdBidder = createTestClient(3)
		const fourthBidder = createTestClient(4)
		const losingTick = -20_000n
		const winningTick = 0n
		const firstAmount = 2n * ATTOETH_PER_ETH
		const secondAmount = 3n * ATTOETH_PER_ETH
		const thirdAmount = 4n * ATTOETH_PER_ETH
		const fourthAmount = 5n * ATTOETH_PER_ETH

		await submitBid(firstBidder, auctionAddress, losingTick, firstAmount)
		await submitBid(client, auctionAddress, winningTick, 12n * ATTOETH_PER_ETH)
		await refundLosingBids(firstBidder, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])
		await submitBid(secondBidder, auctionAddress, losingTick, secondAmount)
		await submitBid(thirdBidder, auctionAddress, losingTick, thirdAmount)

		const firstRecreatedPage = await getBidPageAtTick(client, auctionAddress, losingTick, 0n, 10n)
		strictEqualTypeSafe(firstRecreatedPage[1]?.cumulativeBidAttoEth, firstAmount + secondAmount, 'recreated bid should continue historical cumulative ETH')
		strictEqualTypeSafe(firstRecreatedPage[1]?.activeCumulativeBidBeforeAttoEth, 0n, 'first recreated bid should follow only refunded history')
		strictEqualTypeSafe(firstRecreatedPage[2]?.activeCumulativeBidBeforeAttoEth, secondAmount, 'later recreated bid should include only active predecessors')

		await refundLosingBids(secondBidder, auctionAddress, [{ tick: losingTick, bidIndex: 1n }])
		await refundLosingBids(thirdBidder, auctionAddress, [{ tick: losingTick, bidIndex: 2n }])
		await submitBid(fourthBidder, auctionAddress, losingTick, fourthAmount)

		const secondRecreatedPage = await getBidPageAtTick(client, auctionAddress, losingTick, 0n, 10n)
		strictEqualTypeSafe(secondRecreatedPage[3]?.cumulativeBidAttoEth, firstAmount + secondAmount + thirdAmount + fourthAmount, 'second recreation should preserve the full cumulative history')
		strictEqualTypeSafe(secondRecreatedPage[3]?.activeCumulativeBidBeforeAttoEth, 0n, 'second recreation should subtract every historical refund')
	})

	test('active tick pages stay sorted by descending tick and exclude refunded-away historical levels', async () => {
		const attoEthRaiseCap = 10n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const lowTick = -20_000n
		const middleTick = 0n
		const highTick = 20_000n

		await submitBid(client, auctionAddress, lowTick, 2n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, middleTick, 4n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, highTick, 6n * ATTOETH_PER_ETH)
		await refundLosingBids(client, auctionAddress, [{ tick: lowTick, bidIndex: 0n }])

		strictEqualTypeSafe(await activeTickCount(client, auctionAddress), 2n, 'active tick count mismatch after refund')
		assert.deepStrictEqual(
			(await getActiveTickPage(client, auctionAddress, 0n, 100n)).map((summary: { tick: bigint }) => summary.tick),
			[highTick, middleTick],
		)
	})

	test('getTickSummary returns historical summaries even after a tick is fully refunded away', async () => {
		const attoEthRaiseCap = 10n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const losingTick = -20_000n
		const winningTick = 0n

		await submitBid(client, auctionAddress, losingTick, 2n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, winningTick, 12n * ATTOETH_PER_ETH)
		await refundLosingBids(client, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

		const summary = await getTickSummary(client, auctionAddress, losingTick)
		strictEqualTypeSafe(summary.tick, losingTick, 'historical tick mismatch')
		strictEqualTypeSafe(summary.currentTotalBidAttoEth, 0n, 'historical tick should have zero active ETH')
		strictEqualTypeSafe(summary.submissionCount, 1n, 'historical tick should retain submission count')
		strictEqualTypeSafe(summary.active, false, 'historical tick should be inactive')
	})

	test('getBidPageAtTick returns bid indices, cumulative ETH, and refund state while preserving refunded bid amounts', async () => {
		const attoEthRaiseCap = 10n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const losingTick = -20_000n
		const winningTick = 0n
		const firstLosingBid = 2n * ATTOETH_PER_ETH
		const secondLosingBid = 3n * ATTOETH_PER_ETH
		const winningBid = 12n * ATTOETH_PER_ETH

		await submitBid(client, auctionAddress, losingTick, firstLosingBid)
		await submitBid(client, auctionAddress, losingTick, secondLosingBid)
		await submitBid(client, auctionAddress, winningTick, winningBid)
		await refundLosingBids(client, auctionAddress, [{ tick: losingTick, bidIndex: 1n }])

		strictEqualTypeSafe(await getBidCountAtTick(client, auctionAddress, losingTick), 2n, 'historical bid count mismatch')

		const losingBidPage = await getBidPageAtTick(client, auctionAddress, losingTick, 0n, 100n)
		assert.strictEqual(losingBidPage.length, 2, 'same-tick bid page length mismatch')

		const firstBidView = ensureDefined(losingBidPage[0], 'missing first losing bid view')
		strictEqualTypeSafe(firstBidView.bidIndex, 0n, 'first bid index mismatch')
		strictEqualTypeSafe(firstBidView.bidAmountAttoEth, firstLosingBid, 'first bid amount mismatch')
		strictEqualTypeSafe(firstBidView.cumulativeBidAttoEth, firstLosingBid, 'first cumulative ETH mismatch')
		strictEqualTypeSafe(firstBidView.claimed, false, 'first bid should remain unclaimed')
		strictEqualTypeSafe(firstBidView.refunded, false, 'first bid should not be marked refunded')

		const secondBidView = ensureDefined(losingBidPage[1], 'missing second losing bid view')
		strictEqualTypeSafe(secondBidView.bidIndex, 1n, 'second bid index mismatch')
		strictEqualTypeSafe(secondBidView.bidAmountAttoEth, secondLosingBid, 'refunded bid should retain original amount')
		strictEqualTypeSafe(secondBidView.cumulativeBidAttoEth, firstLosingBid + secondLosingBid, 'second cumulative ETH mismatch')
		strictEqualTypeSafe(secondBidView.claimed, true, 'refunded bid should be marked claimed')
		strictEqualTypeSafe(secondBidView.refunded, true, 'refunded bid should be marked refunded')
	})

	test('bid views expose active cumulative ETH before each bid after same-tick predecessor refunds', async () => {
		const attoEthRaiseCap = 10n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const losingTick = -20_000n
		const winningTick = 0n
		const firstLosingBid = 2n * ATTOETH_PER_ETH
		const secondLosingBid = 3n * ATTOETH_PER_ETH
		const winningBid = 12n * ATTOETH_PER_ETH

		await submitBid(client, auctionAddress, losingTick, firstLosingBid)
		await submitBid(client, auctionAddress, losingTick, secondLosingBid)
		await submitBid(client, auctionAddress, winningTick, winningBid)
		await refundLosingBids(client, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

		const losingBidPage = await getBidPageAtTick(client, auctionAddress, losingTick, 0n, 100n)
		const firstBidView = ensureDefined(losingBidPage[0], 'missing first losing bid view after refund')
		const secondBidView = ensureDefined(losingBidPage[1], 'missing second losing bid view after refund')

		strictEqualTypeSafe(firstBidView.activeCumulativeBidBeforeAttoEth, 0n, 'refunded first bid should have zero active predecessor ETH')
		strictEqualTypeSafe(secondBidView.activeCumulativeBidBeforeAttoEth, 0n, 'second bid should not count refunded predecessors ahead of it')
		strictEqualTypeSafe(secondBidView.refunded, false, 'second bid should remain active after predecessor refund')
	})

	test('getBidderBidPage returns bidder bids in submission order across ticks', async () => {
		const attoEthRaiseCap = 1_000n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 1_000n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)
		const bob = createTestClient(1)
		const firstTick = -10_000n
		const secondTick = 10_000n

		await submitBid(alice, auctionAddress, firstTick, 2n * ATTOETH_PER_ETH)
		await submitBid(bob, auctionAddress, firstTick, 1n * ATTOETH_PER_ETH)
		await submitBid(alice, auctionAddress, secondTick, 3n * ATTOETH_PER_ETH)
		await submitBid(alice, auctionAddress, firstTick, 4n * ATTOETH_PER_ETH)

		strictEqualTypeSafe(await getBidderBidCount(client, auctionAddress, alice.account.address), 3n, 'alice bidder bid count mismatch')

		const aliceBidPage = await getBidderBidPage(client, auctionAddress, alice.account.address, 0n, 100n)
		assert.strictEqual(aliceBidPage.length, 3, 'alice bid page length mismatch')
		assert.deepStrictEqual(
			aliceBidPage.map((bid: { tick: bigint; bidIndex: bigint }) => ({ tick: bid.tick, bidIndex: bid.bidIndex })),
			[
				{ tick: firstTick, bidIndex: 0n },
				{ tick: secondTick, bidIndex: 0n },
				{ tick: firstTick, bidIndex: 2n },
			],
		)
	})

	test('post-finalization withdrawals mark bids claimed without marking them refunded', async () => {
		const attoEthRaiseCap = 20n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const winningTick = 0n
		const winningBid = 12n * ATTOETH_PER_ETH
		await submitBid(client, auctionAddress, winningTick, winningBid)

		await finalizeAndVerify(client, auctionAddress)
		const activeTickCountBeforeWithdrawal = await activeTickCount(client, auctionAddress)
		const activeTicksBeforeWithdrawal = await getActiveTickPage(client, auctionAddress, 0n, 100n)
		const clearingBeforeWithdrawal = await computeClearing(client, auctionAddress)
		await withdrawBids(client, auctionAddress, client.account.address, [{ tick: winningTick, bidIndex: 0n }])

		const winningBidPage = await getBidPageAtTick(client, auctionAddress, winningTick, 0n, 100n)
		const winningBidView = ensureDefined(winningBidPage[0], 'missing winning bid view')
		strictEqualTypeSafe(winningBidView.claimed, true, 'withdrawn bid should be claimed')
		strictEqualTypeSafe(winningBidView.refunded, false, 'withdrawn bid should not be marked refunded')
		strictEqualTypeSafe(await activeTickCount(client, auctionAddress), activeTickCountBeforeWithdrawal, 'post-finalization claims should not change the frozen active tick count')
		assert.deepStrictEqual(await getActiveTickPage(client, auctionAddress, 0n, 100n), activeTicksBeforeWithdrawal, 'post-finalization claims should not change the frozen clearing tree')
		assert.deepStrictEqual(await computeClearing(client, auctionAddress), clearingBeforeWithdrawal, 'post-finalization claims should not change the finalized clearing result')
	})

	test('enumeration views handle empty pages and allow oversized limits', async () => {
		const attoEthRaiseCap = 20n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const tick = 0n
		await submitBid(client, auctionAddress, tick, 2n * ATTOETH_PER_ETH)

		assert.strictEqual((await getTickPage(client, auctionAddress, 5n, 10n)).length, 0, 'tick page should be empty past the end')
		assert.strictEqual((await getTickPage(client, auctionAddress, 0n, 0n)).length, 0, 'tick page should be empty for zero limit')
		assert.strictEqual((await getActiveTickPage(client, auctionAddress, 5n, 10n)).length, 0, 'active tick page should be empty past the end')
		assert.strictEqual((await getActiveTickPage(client, auctionAddress, 0n, 0n)).length, 0, 'active tick page should be empty for zero limit')
		assert.strictEqual((await getBidPageAtTick(client, auctionAddress, tick, 5n, 10n)).length, 0, 'tick bid page should be empty past the end')
		assert.strictEqual((await getBidPageAtTick(client, auctionAddress, tick, 0n, 0n)).length, 0, 'tick bid page should be empty for zero limit')
		assert.strictEqual((await getBidderBidPage(client, auctionAddress, client.account.address, 5n, 10n)).length, 0, 'bidder bid page should be empty past the end')
		assert.strictEqual((await getBidderBidPage(client, auctionAddress, client.account.address, 0n, 0n)).length, 0, 'bidder bid page should be empty for zero limit')
		assert.strictEqual((await getTickPage(client, auctionAddress, 0n, 101n)).length, 1, 'tick page should allow limits above prior caps')
		assert.strictEqual((await getActiveTickPage(client, auctionAddress, 0n, 101n)).length, 1, 'active tick page should allow limits above prior caps')
		assert.strictEqual((await getBidPageAtTick(client, auctionAddress, tick, 0n, 101n)).length, 1, 'tick bid page should allow limits above prior caps')
		assert.strictEqual((await getBidderBidPage(client, auctionAddress, client.account.address, 0n, 101n)).length, 1, 'bidder bid page should allow limits above prior caps')
	})

	test('seeded bid churn keeps public enumeration, clearing, and ETH liabilities equivalent to an independent model', async () => {
		type ModeledBid = {
			amount: bigint
			bidder: WriteClient
			bidIndex: bigint
			claimed: boolean
			refunded: boolean
			tick: bigint
		}

		const attoEthRaiseCap = 10n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 10n * ATTOETH_PER_ETH
		const lowTick = -20_000n
		const middleTick = 0n
		const highTick = 20_000n
		const bidderA = createTestClient(1)
		const bidderB = createTestClient(2)
		const bidderC = createTestClient(3)
		const modeledBids: ModeledBid[] = []
		const historicalTicks: bigint[] = []
		let forcedSurplus = 0n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const addModeledBid = async (bidder: WriteClient, tick: bigint, amount: bigint) => {
			const bidIndex = BigInt(modeledBids.filter(bid => bid.tick === tick).length)
			await submitBid(bidder, auctionAddress, tick, amount)
			if (!historicalTicks.includes(tick)) historicalTicks.push(tick)
			modeledBids.push({ amount, bidder, bidIndex, claimed: false, refunded: false, tick })
		}

		const refundModeledBid = async (bid: ModeledBid) => {
			await refundLosingBids(bid.bidder, auctionAddress, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
			bid.claimed = true
			bid.refunded = true
		}

		const assertPublicModel = async (label: string) => {
			const tickPage = await getTickPage(client, auctionAddress, 0n, 100n)
			assert.deepStrictEqual(
				tickPage.map(summary => summary.tick),
				historicalTicks,
				`${label}: historical ticks should preserve first-insertion order`,
			)
			for (const [tickIndex, tick] of historicalTicks.entries()) {
				const summary = tickPage[tickIndex]
				if (summary === undefined) throw new Error(`${label}: missing historical tick summary ${tickIndex.toString()}`)
				const bidsAtTick = modeledBids.filter(bid => bid.tick === tick)
				const activeEth = bidsAtTick.filter(bid => !bid.claimed).reduce((sum, bid) => sum + bid.amount, 0n)
				strictEqualTypeSafe(summary.submissionCount, BigInt(bidsAtTick.length), `${label}: tick submission count should match the model`)
				strictEqualTypeSafe(summary.currentTotalBidAttoEth, activeEth, `${label}: tick active ETH should match the model`)
				strictEqualTypeSafe(summary.active, activeEth > 0n, `${label}: tick active flag should match the model`)

				const bidPage = await getBidPageAtTick(client, auctionAddress, tick, 0n, 100n)
				let cumulativeEth = 0n
				let activeCumulativeAttoEth = 0n
				for (const [bidIndex, modeledBid] of bidsAtTick.entries()) {
					const bidView = bidPage[bidIndex]
					if (bidView === undefined) throw new Error(`${label}: missing bid view ${bidIndex.toString()} at tick ${tick.toString()}`)
					cumulativeEth += modeledBid.amount
					strictEqualTypeSafe(bidView.bidIndex, modeledBid.bidIndex, `${label}: bid index should match the model`)
					strictEqualTypeSafe(bidView.bidder, modeledBid.bidder.account.address, `${label}: bid owner should match the model`)
					strictEqualTypeSafe(bidView.bidAmountAttoEth, modeledBid.amount, `${label}: bid amount should match the model`)
					strictEqualTypeSafe(bidView.cumulativeBidAttoEth, cumulativeEth, `${label}: historical cumulative ETH should match the model`)
					strictEqualTypeSafe(bidView.activeCumulativeBidBeforeAttoEth, activeCumulativeAttoEth, `${label}: active prefix ETH should exclude refunded predecessors`)
					strictEqualTypeSafe(bidView.claimed, modeledBid.claimed, `${label}: bid claimed flag should match the model`)
					strictEqualTypeSafe(bidView.refunded, modeledBid.refunded, `${label}: bid refunded flag should match the model`)
					if (!modeledBid.claimed) activeCumulativeAttoEth += modeledBid.amount
				}
			}

			const modeledActiveTicks = historicalTicks
				.filter(tick => modeledBids.some(bid => bid.tick === tick && !bid.claimed))
				.sort((a, b) => {
					if (a > b) return -1
					if (a < b) return 1
					return 0
				})
			const activeTickPage = await getActiveTickPage(client, auctionAddress, 0n, 100n)
			strictEqualTypeSafe(await activeTickCount(client, auctionAddress), BigInt(modeledActiveTicks.length), `${label}: active tick count should match the model`)
			assert.deepStrictEqual(
				activeTickPage.map(summary => summary.tick),
				modeledActiveTicks,
				`${label}: active ticks should be descending and contain no refunded-away history`,
			)

			const modeledClearing = computeModeledClearing(
				modeledBids.filter(bid => !bid.claimed).map(bid => ({ amount: bid.amount, tick: bid.tick })),
				maxAttoRepBeingSold,
				attoEthRaiseCap,
			)
			const actualClearing = await computeClearing(client, auctionAddress)
			strictEqualTypeSafe(actualClearing.hitCap, modeledClearing.hitCap, `${label}: clearing cap result should match the model`)
			strictEqualTypeSafe(actualClearing.foundTick, modeledClearing.foundTick, `${label}: clearing tick should match the model`)
			strictEqualTypeSafe(actualClearing.accumulatedBidAttoEth, modeledClearing.accumulatedBidAttoEth, `${label}: clearing ETH should match the model`)
			strictEqualTypeSafe(await getETHBalance(client, auctionAddress), forcedSurplus + modeledBids.reduce((sum, bid) => sum + (bid.claimed ? bid.amount : bid.amount), 0n), `${label}: auction ETH should equal active bids plus unwithdrawn refund credits and forced surplus`)
		}

		await addModeledBid(bidderA, lowTick, 2n * ATTOETH_PER_ETH)
		await assertPublicModel('after low bid')
		await addModeledBid(bidderB, middleTick, 4n * ATTOETH_PER_ETH)
		await assertPublicModel('after middle bid')
		await addModeledBid(bidderC, highTick, 8n * ATTOETH_PER_ETH)
		await assertPublicModel('after high bid')

		const firstLowBid = ensureDefined(modeledBids[0], 'first low bid is missing')
		await refundModeledBid(firstLowBid)
		await assertPublicModel('after first low refund')
		await addModeledBid(bidderA, lowTick, 3n * ATTOETH_PER_ETH)
		await assertPublicModel('after low tick recreation')
		const recreatedLowBid = ensureDefined(modeledBids[3], 'recreated low bid is missing')
		await refundModeledBid(recreatedLowBid)
		await assertPublicModel('after second low refund')

		forcedSurplus = 13n
		await mockWindow.setBalance(auctionAddress, (await getETHBalance(client, auctionAddress)) + forcedSurplus)
		await assertPublicModel('after forced surplus')

		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)
		const unsettledBids = modeledBids.filter(bid => !bid.claimed)
		const simulatedSettlements = []
		for (const bid of unsettledBids) {
			const settlement = await simulateWithdrawBids(client, auctionAddress, bid.bidder.account.address, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
			simulatedSettlements.push({ bid, settlement })
			strictEqualTypeSafe(bid.amount - settlement.totalRefundAttoEth + settlement.totalRefundAttoEth, bid.amount, 'each bid should partition into used ETH and refund')
		}
		const aggregateRefundLiability = simulatedSettlements.reduce((sum, entry) => sum + entry.settlement.totalRefundAttoEth, 0n)
		const preExistingRefundLiability = (await getPendingEthRefund(client, auctionAddress, bidderA.account.address)) + (await getPendingEthRefund(client, auctionAddress, bidderB.account.address)) + (await getPendingEthRefund(client, auctionAddress, bidderC.account.address))
		const aggregateUsedEth = simulatedSettlements.reduce((sum, entry) => sum + entry.bid.amount - entry.settlement.totalRefundAttoEth, 0n)
		const aggregateFilledRep = simulatedSettlements.reduce((sum, entry) => sum + entry.settlement.totalFilledAttoRep, 0n)
		strictEqualTypeSafe(aggregateUsedEth, await getEthRaisedAttoEth(client, auctionAddress), 'aggregate bid ETH used should equal finalized ETH raised')
		strictEqualTypeSafe(aggregateFilledRep, await getTotalRepPurchasedAttoRep(client, auctionAddress), 'aggregate filled REP should equal finalized REP purchased')
		strictEqualTypeSafe(await getETHBalance(client, auctionAddress), forcedSurplus + preExistingRefundLiability + aggregateRefundLiability, 'post-finalization ETH should equal credited and unsettled refunds plus forced surplus')

		for (const { bid } of simulatedSettlements.toReversed()) {
			await withdrawBids(client, auctionAddress, bid.bidder.account.address, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
			bid.claimed = true
			strictEqualTypeSafe(await getETHBalance(client, auctionAddress), forcedSurplus + preExistingRefundLiability + aggregateRefundLiability, 'settlement should move ETH from bid liability to refund credit without an external call')
		}
		await withdrawPendingEthRefund(bidderA, auctionAddress)
		await withdrawPendingEthRefund(bidderB, auctionAddress)
		await withdrawPendingEthRefund(bidderC, auctionAddress)
		strictEqualTypeSafe(await getETHBalance(client, auctionAddress), forcedSurplus, 'all bid liabilities should clear without consuming forced surplus')
	})
})
