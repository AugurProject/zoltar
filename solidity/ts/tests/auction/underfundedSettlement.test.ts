import { beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import assert from '../../testSupport/simulator/utils/assert'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { computeClearing, finalize, getClearingTick, getEthRaisedAttoEth, getMinBidSizeAttoEth, getTotalRepPurchasedAttoRep, refundLosingBids, simulateWithdrawBids, startAuction, submitBid, withdrawBids } from '../../testSupport/simulator/utils/contracts/auction'
import { strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../types/contractArtifact'
import { assertContractEmpty, getPendingEthRefund, previewFinalization, setupStandardAuction, submitBidAndVerifyLock, useAuctionFixture, withdrawPendingEthRefund } from './fixture'
import { AUCTION_TIME, LOWEST_POSITIVE_PRICE_TICK, MAX_ATTO_REP, tickAtOrAbovePrice, tickForPrice } from './model'

describe('UniformPriceDualCapBatchAuction: Lifecycle & Finalization refunds and underfunded settlement', () => {
	const fixture = useAuctionFixture()
	const { createTestClient, finalizeAndVerify, assertFairPayoutForUser } = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let auctionAddress: Address

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		auctionAddress = fixture.auctionAddress
	})

	test('winner unaffected after bidder refunds multiple losing bids', async () => {
		await setupStandardAuction(client, auctionAddress)

		const alice = createTestClient(0)
		const bob = createTestClient(1)

		const lowTicks = [tickForPrice(TRUTH_AUCTION_PRICE_PRECISION / 4n), tickForPrice(TRUTH_AUCTION_PRICE_PRECISION / 3n), tickForPrice(TRUTH_AUCTION_PRICE_PRECISION / 2n)]
		const minBidSizeAttoEth = await getMinBidSizeAttoEth(client, auctionAddress)
		const lowBid = minBidSizeAttoEth
		for (const t of lowTicks) {
			await submitBid(alice, auctionAddress, t, lowBid)
		}

		const bobTick = 0n
		const bobEth = 120n * 10n ** 18n
		await submitBidAndVerifyLock(bob, auctionAddress, bobTick, bobEth)

		const clearingPre = await computeClearing(client, auctionAddress)
		assert.ok(clearingPre.hitCap, 'price found')
		strictEqualTypeSafe(clearingPre.foundTick, bobTick, 'clearing tick is bobTick')

		const aliceBalanceBefore = await getETHBalance(client, alice.account.address)

		const refundIndices = lowTicks.map(t => ({ tick: t, bidIndex: 0n }))
		await refundLosingBids(alice, auctionAddress, refundIndices)
		strictEqualTypeSafe(await getPendingEthRefund(client, auctionAddress, alice.account.address), 3n * lowBid, 'Alice refund credit')
		await withdrawPendingEthRefund(alice, auctionAddress)
		const aliceBalanceAfter = await getETHBalance(client, alice.account.address)
		strictEqualTypeSafe(aliceBalanceAfter - aliceBalanceBefore, 3n * lowBid, 'Alice total refund')

		await finalizeAndVerify(client, auctionAddress)

		const bobBids = [{ tick: bobTick, bidSize: bobEth, bidIndex: 0n }]
		await assertFairPayoutForUser(client, auctionAddress, bob.account.address, bobBids, bobTick, 10n)
	})

	test('should correctly handle underfunded auctions', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const price = TRUTH_AUCTION_PRICE_PRECISION
		const alice = createTestClient(0)

		await submitBid(alice, auctionAddress, tickForPrice(price), 1n * 10n ** 18n)

		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.hitCap, false, 'auction should not have price')
	})

	test('underfunded auction with no bids keeps the cap-implied reserve and purchases nothing', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)
		const [previewEthToSend, previewRepPurchased] = await previewFinalization(client, auctionAddress)
		strictEqualTypeSafe(previewEthToSend, 0n, 'no-bid preview should send no ETH')
		strictEqualTypeSafe(previewRepPurchased, 0n, 'no-bid preview should purchase no REP')

		const ownerBalanceBeforeFinalize = await getETHBalance(client, client.account.address)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)
		const ownerBalanceAfterFinalize = await getETHBalance(client, client.account.address)

		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.hitCap, false, 'no-bid auctions should stay on the underfunded path')
		strictEqualTypeSafe(await getClearingTick(client, auctionAddress), 0n, 'no-winning-prefix auctions should keep clearingTick at 0')
		strictEqualTypeSafe(await getEthRaisedAttoEth(client, auctionAddress), 0n, 'no-winning-prefix auctions should not retain any ETH')
		strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, auctionAddress), 0n, 'no-winning-prefix auctions should not purchase any REP')
		strictEqualTypeSafe(ownerBalanceAfterFinalize - ownerBalanceBeforeFinalize, 0n, 'no-winning-prefix auctions should not forward ETH to the owner')

		const underfunded = await client.readContract({
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'underfunded',
			address: auctionAddress,
			args: [],
		})
		const underfundedWinningAttoEth = await client.readContract({
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'underfundedWinningAttoEth',
			address: auctionAddress,
			args: [],
		})
		const underfundedThreshold = await client.readContract({
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'underfundedThreshold',
			address: auctionAddress,
			args: [],
		})

		strictEqualTypeSafe(underfunded, true, 'no-winning-prefix auctions should finalize on the underfunded branch')
		strictEqualTypeSafe(underfundedWinningAttoEth, 0n, 'no-winning-prefix auctions should record zero winning ETH')
		strictEqualTypeSafe(underfundedThreshold, 10n ** 18n, 'no-bid auctions should retain the cap-implied reserve')
	})

	test('accepted positive-price bids below the cap-implied reserve are refunded', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = MAX_ATTO_REP
		const bidAmount = 1n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)
		const aliceBalanceBeforeWithdraw = await getETHBalance(client, alice.account.address)
		await submitBid(alice, auctionAddress, LOWEST_POSITIVE_PRICE_TICK, bidAmount)

		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		const underfundedWinningAttoEth = await client.readContract({
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'underfundedWinningAttoEth',
			address: auctionAddress,
			args: [],
		})
		const underfundedThreshold = await client.readContract({
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'underfundedThreshold',
			address: auctionAddress,
			args: [],
		})

		strictEqualTypeSafe(await getEthRaisedAttoEth(client, auctionAddress), 0n, 'below-reserve ETH must not enter the clearing total')
		strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, auctionAddress), 0n, 'a positive-price bid below reserve must not purchase REP')
		strictEqualTypeSafe(underfundedWinningAttoEth, 0n, 'below-reserve ETH must not enter the winning total')
		assert.ok(underfundedThreshold > 1n, 'the reserve should be derived from both auction caps')

		const refundPreview = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: LOWEST_POSITIVE_PRICE_TICK, bidIndex: 0n }])
		strictEqualTypeSafe(refundPreview.totalFilledAttoRep, 0n, 'below-reserve bids should allocate no REP')
		strictEqualTypeSafe(refundPreview.totalRefundAttoEth, bidAmount, 'below-reserve bids should refund all ETH')
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: LOWEST_POSITIVE_PRICE_TICK, bidIndex: 0n }])
		strictEqualTypeSafe(await getPendingEthRefund(client, auctionAddress, alice.account.address), bidAmount, 'below-reserve refund must be credited')
		await withdrawPendingEthRefund(alice, auctionAddress)
		const aliceBalanceAfterWithdraw = await getETHBalance(client, alice.account.address)
		strictEqualTypeSafe(aliceBalanceAfterWithdraw - aliceBalanceBeforeWithdraw, 0n, 'withdrawing should restore the below-reserve bidder balance')
		await assertContractEmpty(client, auctionAddress)
	})

	test('underfunded auction sells the complete REP cap at one weak-demand price', async () => {
		const attoEthRaiseCap = 20n * 10n ** 18n
		const maxAttoRepBeingSold = 10n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)
		const bob = createTestClient(1)

		const aliceEth = 4n * 10n ** 18n
		const bobEth = 6n * 10n ** 18n

		// Use prices that make the auction underfunded (hitCap false)
		const aliceTick = tickAtOrAbovePrice(2n * 10n ** 18n) // 2 ETH/REP reserve
		const bobTick = tickAtOrAbovePrice(4n * 10n ** 18n) // 4 ETH/REP

		await submitBid(alice, auctionAddress, aliceTick, aliceEth)
		await submitBid(bob, auctionAddress, bobTick, bobEth)

		// Check clearing result before finalize to verify underfunded condition
		const clearingPre = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPre.hitCap, false, 'hitCap should be false (underfunded)')
		const [previewEthToSend, previewRepPurchased] = await previewFinalization(client, auctionAddress)
		const expectedWinningEth = aliceEth + bobEth
		const expectedRepPurchased = maxAttoRepBeingSold
		strictEqualTypeSafe(previewEthToSend, expectedWinningEth, 'underfunded preview should return qualifying ETH')
		strictEqualTypeSafe(previewRepPurchased, expectedRepPurchased, 'underfunded preview should sell the complete REP cap')

		// Finalize the auction
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		const totalAttoRep = await getTotalRepPurchasedAttoRep(client, auctionAddress)
		strictEqualTypeSafe(totalAttoRep, previewRepPurchased, 'finalization should use the previewed REP amount')
		strictEqualTypeSafe(totalAttoRep, maxAttoRepBeingSold, 'underfunded qualifying demand should buy the complete REP cap')
		const expectedBobRep = (bobEth * totalAttoRep) / (aliceEth + bobEth)
		const expectedAliceRep = totalAttoRep - expectedBobRep

		const aliceBids = [{ tick: aliceTick, bidIndex: 0n }]
		const aliceResult = await simulateWithdrawBids(client, auctionAddress, alice.account.address, aliceBids)
		strictEqualTypeSafe(aliceResult.totalFilledAttoRep, expectedAliceRep, 'alice should receive her uniform-price REP share')
		strictEqualTypeSafe(aliceResult.totalRefundAttoEth, 0n, 'alice no ETH refund')
		await withdrawBids(client, auctionAddress, alice.account.address, aliceBids)

		const bobBids = [{ tick: bobTick, bidIndex: 0n }]
		const bobResult = await simulateWithdrawBids(client, auctionAddress, bob.account.address, bobBids)
		strictEqualTypeSafe(bobResult.totalFilledAttoRep, expectedBobRep, 'bob should receive the remaining uniform-price REP share')
		strictEqualTypeSafe(bobResult.totalRefundAttoEth, 0n, 'bob no ETH refund')
		await withdrawBids(client, auctionAddress, bob.account.address, bobBids)
		await assertContractEmpty(client, auctionAddress)
	})

	test('below-reserve demand cannot reach the REP cap through the funded clearing path', async () => {
		const attoEthRaiseCap = 1_000n * 10n ** 18n
		const maxAttoRepBeingSold = 4n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)
		const bob = createTestClient(1)
		const winningTick = tickForPrice(5n * 10n ** 18n)
		const excludedTick = tickForPrice(3n * 10n ** 18n)
		const aliceEth = 3n * 10n ** 18n
		const bobEth = 10n * 10n ** 18n

		await submitBid(alice, auctionAddress, winningTick, aliceEth)
		await submitBid(bob, auctionAddress, excludedTick, bobEth)

		const clearingPre = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPre.hitCap, false, 'demand entirely below the cap-implied reserve must not satisfy either auction cap')

		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, auctionAddress), 0n, 'below-reserve demand must not purchase any REP')

		const aliceResult = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: winningTick, bidIndex: 0n }])
		strictEqualTypeSafe(aliceResult.totalFilledAttoRep, 0n, 'the higher below-reserve bid should receive no REP')
		strictEqualTypeSafe(aliceResult.totalRefundAttoEth, aliceEth, 'the higher below-reserve bid should be refunded in full')
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: winningTick, bidIndex: 0n }])

		const bobResult = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: excludedTick, bidIndex: 0n }])
		strictEqualTypeSafe(bobResult.totalFilledAttoRep, 0n, 'the lower below-reserve bid should receive no REP')
		strictEqualTypeSafe(bobResult.totalRefundAttoEth, bobEth, 'the lower below-reserve bid should be refunded in full')
		await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: excludedTick, bidIndex: 0n }])
		await withdrawPendingEthRefund(alice, auctionAddress)
		await withdrawPendingEthRefund(bob, auctionAddress)

		await assertContractEmpty(client, auctionAddress)
	})

	test('underfunded same-tick withdrawals reconcile reserve-price rounding across separate calls', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)
		const bob = createTestClient(1)
		const carol = createTestClient(2)
		const winningTick = tickForPrice(7n * 10n ** 18n)
		const bidAmounts = [1n * 10n ** 18n, 2n * 10n ** 18n, 4n * 10n ** 18n] as const

		await submitBid(alice, auctionAddress, winningTick, bidAmounts[0])
		await submitBid(bob, auctionAddress, winningTick, bidAmounts[1])
		await submitBid(carol, auctionAddress, winningTick, bidAmounts[2])

		const clearingPre = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPre.hitCap, false, 'same-tick bids should leave this auction underfunded')

		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		const expectedTotalRep = await getTotalRepPurchasedAttoRep(client, auctionAddress)
		strictEqualTypeSafe(expectedTotalRep, maxAttoRepBeingSold, 'underfunded demand should purchase the complete REP cap')

		const settlementSnapshot = await mockWindow.anvilSnapshot()
		const winningBids = [
			[alice.account.address, 0n],
			[bob.account.address, 1n],
			[carol.account.address, 2n],
		] as const
		const forwardRepByBid: bigint[] = []
		let withdrawnRep = 0n
		for (const [withdrawFor, bidIndex] of winningBids) {
			const result = await simulateWithdrawBids(client, auctionAddress, withdrawFor, [{ tick: winningTick, bidIndex }])
			strictEqualTypeSafe(result.totalRefundAttoEth, 0n, 'winning same-tick bid should not receive an ETH refund')
			forwardRepByBid[Number.parseInt(bidIndex.toString(), 10)] = result.totalFilledAttoRep
			withdrawnRep += result.totalFilledAttoRep
			await withdrawBids(client, auctionAddress, withdrawFor, [{ tick: winningTick, bidIndex }])
		}

		strictEqualTypeSafe(withdrawnRep, expectedTotalRep, 'separate same-tick withdrawals should reconcile to the finalized REP cap')
		await assertContractEmpty(client, auctionAddress)

		await mockWindow.anvilRevert(settlementSnapshot)
		let reverseWithdrawnRep = 0n
		for (const [withdrawFor, bidIndex] of [...winningBids].reverse()) {
			const result = await simulateWithdrawBids(client, auctionAddress, withdrawFor, [{ tick: winningTick, bidIndex }])
			strictEqualTypeSafe(result.totalFilledAttoRep, forwardRepByBid[Number.parseInt(bidIndex.toString(), 10)], 'underfunded REP allocation should not depend on withdrawal order')
			reverseWithdrawnRep += result.totalFilledAttoRep
			await withdrawBids(client, auctionAddress, withdrawFor, [{ tick: winningTick, bidIndex }])
		}
		strictEqualTypeSafe(reverseWithdrawnRep, expectedTotalRep, 'reverse-order underfunded withdrawals should reconcile to the finalized REP cap')
		await assertContractEmpty(client, auctionAddress)
	})

	test('underfunded cross-tick dust allocation is independent of withdrawal order', async () => {
		const alice = createTestClient(0)
		const bob = createTestClient(1)
		const expensiveTick = tickForPrice(4n * TRUTH_AUCTION_PRICE_PRECISION)
		const cheaperWinningTick = tickForPrice(3n * TRUTH_AUCTION_PRICE_PRECISION)

		await startAuction(client, auctionAddress, 2n * TRUTH_AUCTION_PRICE_PRECISION, 1n * TRUTH_AUCTION_PRICE_PRECISION)
		await submitBid(alice, auctionAddress, expensiveTick, 1n * TRUTH_AUCTION_PRICE_PRECISION)
		await submitBid(bob, auctionAddress, cheaperWinningTick, 1n * TRUTH_AUCTION_PRICE_PRECISION)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		const expectedTotalRep = await getTotalRepPurchasedAttoRep(client, auctionAddress)
		assert.ok(expectedTotalRep > 0n && expectedTotalRep < TRUTH_AUCTION_PRICE_PRECISION, 'underfunded auction should sell REP in proportion to qualifying ETH')
		const backingBudget = 7n * expectedTotalRep + 1n
		const settlementSnapshot = await mockWindow.anvilSnapshot()
		const aliceForward = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: expensiveTick, bidIndex: 0n }], 0n, 0n, backingBudget)
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: expensiveTick, bidIndex: 0n }], 0n, 0n, backingBudget)
		const bobForward = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: cheaperWinningTick, bidIndex: 0n }], 0n, 0n, backingBudget)
		await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: cheaperWinningTick, bidIndex: 0n }], 0n, 0n, backingBudget)

		strictEqualTypeSafe(aliceForward.totalFilledAttoRep + bobForward.totalFilledAttoRep, expectedTotalRep, 'forward withdrawals should reconcile to proportional REP purchased')
		strictEqualTypeSafe(aliceForward.totalRepBackingUnitsAllocation + bobForward.totalRepBackingUnitsAllocation, backingBudget, 'the complete backing budget must be allocated')

		await mockWindow.anvilRevert(settlementSnapshot)
		const bobReverse = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: cheaperWinningTick, bidIndex: 0n }], 0n, 0n, backingBudget)
		await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: cheaperWinningTick, bidIndex: 0n }], 0n, 0n, backingBudget)
		const aliceReverse = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: expensiveTick, bidIndex: 0n }], 0n, 0n, backingBudget)
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: expensiveTick, bidIndex: 0n }], 0n, 0n, backingBudget)

		strictEqualTypeSafe(aliceReverse.totalRepBackingUnitsAllocation, aliceForward.totalRepBackingUnitsAllocation, 'backing-unit dust must follow bid position')
		strictEqualTypeSafe(bobReverse.totalRepBackingUnitsAllocation, bobForward.totalRepBackingUnitsAllocation, 'backing-unit dust must not follow claim order')
		strictEqualTypeSafe(bobReverse.totalFilledAttoRep, bobForward.totalFilledAttoRep, 'lower-tick allocation should not depend on withdrawing first')
		strictEqualTypeSafe(aliceReverse.totalFilledAttoRep, aliceForward.totalFilledAttoRep, 'higher-tick allocation should not depend on withdrawing second')
		strictEqualTypeSafe(aliceReverse.totalFilledAttoRep + bobReverse.totalFilledAttoRep, expectedTotalRep, 'reverse withdrawals should reconcile to proportional REP purchased')
	})

	test('companion allocation remains claimable when a winning bid rounds to zero REP', async () => {
		const alice = createTestClient(0)
		const bob = createTestClient(1)
		const aliceTick = tickForPrice(5n * TRUTH_AUCTION_PRICE_PRECISION)
		const bobTick = tickForPrice(4n * TRUTH_AUCTION_PRICE_PRECISION)

		await startAuction(client, auctionAddress, 4n, 1n)
		await submitBid(alice, auctionAddress, aliceTick, 1n)
		await submitBid(bob, auctionAddress, bobTick, 1n)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		const settlementSnapshot = await mockWindow.anvilSnapshot()
		const aliceForward = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: aliceTick, bidIndex: 0n }], 3n, 1n, 10n)
		strictEqualTypeSafe(aliceForward.totalRepBackingUnitsAllocation, 0n, 'zero purchased REP must receive no backing units')
		strictEqualTypeSafe(aliceForward.totalFilledAttoRep, 0n, 'the first winning bid should exercise zero REP rounding')
		strictEqualTypeSafe(aliceForward.totalProRataAllocation, 1n, 'zero REP rounding must not discard the bid positional companion allocation')
		strictEqualTypeSafe(aliceForward.totalSecondaryProRataAllocation, 0n, 'the earlier position should receive no indivisible secondary allocation')
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: aliceTick, bidIndex: 0n }], 3n, 1n, 10n)
		const bobForward = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: bobTick, bidIndex: 0n }], 3n, 1n, 10n)
		strictEqualTypeSafe(bobForward.totalRepBackingUnitsAllocation, 10n, 'the positive REP interval must receive the entire backing budget')
		strictEqualTypeSafe(bobForward.totalFilledAttoRep, 1n, 'the final winning bid should receive the REP rounding unit')
		strictEqualTypeSafe(bobForward.totalProRataAllocation, 2n, 'the final winning bid should receive the remaining companion allocation')
		strictEqualTypeSafe(bobForward.totalSecondaryProRataAllocation, 1n, 'the later position should receive the indivisible secondary allocation')

		await mockWindow.anvilRevert(settlementSnapshot)
		const bobReverse = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: bobTick, bidIndex: 0n }], 3n, 1n, 10n)
		await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: bobTick, bidIndex: 0n }], 3n, 1n, 10n)
		const aliceReverse = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: aliceTick, bidIndex: 0n }], 3n, 1n, 10n)

		strictEqualTypeSafe(aliceReverse.totalRepBackingUnitsAllocation, aliceForward.totalRepBackingUnitsAllocation, 'zero-REP backing allocation must not depend on claim order')
		strictEqualTypeSafe(bobReverse.totalRepBackingUnitsAllocation, bobForward.totalRepBackingUnitsAllocation, 'backing allocation must not depend on claim order')
		strictEqualTypeSafe(aliceReverse.totalProRataAllocation, aliceForward.totalProRataAllocation, 'zero-REP companion allocation must not depend on withdrawal order')
		strictEqualTypeSafe(bobReverse.totalProRataAllocation, bobForward.totalProRataAllocation, 'positive-REP companion allocation must not depend on withdrawal order')
		strictEqualTypeSafe(aliceReverse.totalProRataAllocation + bobReverse.totalProRataAllocation, 3n, 'all companion allocation units should reconcile across separately settled bids')
		strictEqualTypeSafe(aliceReverse.totalSecondaryProRataAllocation, aliceForward.totalSecondaryProRataAllocation, 'earlier-position secondary allocation must not depend on withdrawal order')
		strictEqualTypeSafe(bobReverse.totalSecondaryProRataAllocation, bobForward.totalSecondaryProRataAllocation, 'later-position secondary allocation must not depend on withdrawal order')
	})

	test('rounded intermediate prefixes do not hide a later valid underfunded prefix', async () => {
		const highBidder = createTestClient(0)
		const mediumBidder = createTestClient(1)
		const lowBidder = createTestClient(2)
		const highTick = tickForPrice(4n * TRUTH_AUCTION_PRICE_PRECISION)
		const mediumTick = tickForPrice(3n * TRUTH_AUCTION_PRICE_PRECISION)
		const lowTick = tickForPrice((7n * TRUTH_AUCTION_PRICE_PRECISION) / 4n)

		await startAuction(client, auctionAddress, 4n, 2n)
		await submitBid(highBidder, auctionAddress, highTick, 1n)
		await submitBid(mediumBidder, auctionAddress, mediumTick, 1n)
		await submitBid(lowBidder, auctionAddress, lowTick, 1n)

		const clearingPre = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPre.hitCap, false, 'the below-reserve low tick should leave the auction underfunded')
		await finalizeAndVerify(client, auctionAddress)

		strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, auctionAddress), 2n, 'qualifying demand should purchase the complete two-attoREP cap')

		const highResult = await simulateWithdrawBids(client, auctionAddress, highBidder.account.address, [{ tick: highTick, bidIndex: 0n }])
		const mediumResult = await simulateWithdrawBids(client, auctionAddress, mediumBidder.account.address, [{ tick: mediumTick, bidIndex: 0n }])
		const lowResult = await simulateWithdrawBids(client, auctionAddress, lowBidder.account.address, [{ tick: lowTick, bidIndex: 0n }])
		strictEqualTypeSafe(highResult.totalFilledAttoRep + mediumResult.totalFilledAttoRep, 2n, 'the valid winning prefix should reconcile to the complete REP cap')
		strictEqualTypeSafe(highResult.totalRefundAttoEth + mediumResult.totalRefundAttoEth, 0n, 'the qualifying high-and-medium bids should retain their ETH')
		strictEqualTypeSafe(lowResult.totalFilledAttoRep, 0n, 'the below-reserve low bid should receive no REP')
		strictEqualTypeSafe(lowResult.totalRefundAttoEth, 1n, 'the below-reserve low bid should refund in full')
	})

	test('underfunded auctions treat bids exactly at the threshold price as winners', async () => {
		const attoEthRaiseCap = 1_000n * 10n ** 18n
		const maxAttoRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)
		const thresholdPrice = (attoEthRaiseCap * TRUTH_AUCTION_PRICE_PRECISION) / maxAttoRepBeingSold
		const thresholdTick = tickAtOrAbovePrice(thresholdPrice)
		const aliceEth = attoEthRaiseCap / 2n

		await submitBid(alice, auctionAddress, thresholdTick, aliceEth)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		const totalAttoRep = await getTotalRepPurchasedAttoRep(client, auctionAddress)
		strictEqualTypeSafe(totalAttoRep, maxAttoRepBeingSold, 'reserve-price demand below the ETH cap should buy the complete REP cap')

		const withdrawal = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: thresholdTick, bidIndex: 0n }])
		strictEqualTypeSafe(withdrawal.totalRefundAttoEth, 0n, 'threshold-clearing winner should not receive an ETH refund')
		strictEqualTypeSafe(withdrawal.totalFilledAttoRep, totalAttoRep, 'reserve-price winner should receive the complete REP cap')
	})

	test('underfunded winning prefixes can end at tick 0', async () => {
		const attoEthRaiseCap = 4n * 10n ** 18n
		const maxAttoRepBeingSold = 4n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)
		const bob = createTestClient(1)
		const carol = createTestClient(2)
		const higherWinningTick = 20n
		const middleWinningTick = 10n
		const boundaryWinningTick = 0n
		const bidAmount = 1n * 10n ** 18n

		await submitBid(alice, auctionAddress, higherWinningTick, bidAmount)
		await submitBid(bob, auctionAddress, middleWinningTick, bidAmount)
		await submitBid(carol, auctionAddress, boundaryWinningTick, bidAmount)

		const clearingPre = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPre.hitCap, false, 'the three-tick prefix should remain on the underfunded path')

		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)

		strictEqualTypeSafe(await getClearingTick(client, auctionAddress), boundaryWinningTick, 'the winning prefix boundary should be tick 0')
		const totalAttoRepPurchased = await getTotalRepPurchasedAttoRep(client, auctionAddress)
		strictEqualTypeSafe(totalAttoRepPurchased, maxAttoRepBeingSold, 'the underfunded winning prefix should receive the complete REP cap')
		strictEqualTypeSafe(await getEthRaisedAttoEth(client, auctionAddress), 3n * bidAmount, 'attoEthRaised should continue to track submitted ETH')

		let totalWinningRep = 0n
		for (const [withdrawFor, tick] of [
			[alice.account.address, higherWinningTick],
			[bob.account.address, middleWinningTick],
			[carol.account.address, boundaryWinningTick],
		] as const) {
			const result = await simulateWithdrawBids(client, auctionAddress, withdrawFor, [{ tick, bidIndex: 0n }])
			strictEqualTypeSafe(result.totalRefundAttoEth, 0n, 'winning-prefix bids should not receive ETH refunds')
			assert.ok(result.totalFilledAttoRep > 0n, 'winning-prefix bids should receive REP')
			totalWinningRep += result.totalFilledAttoRep
			await withdrawBids(client, auctionAddress, withdrawFor, [{ tick, bidIndex: 0n }])
		}

		strictEqualTypeSafe(totalWinningRep, totalAttoRepPurchased, 'winning-prefix withdrawals should reconcile to the complete REP cap')

		await assertContractEmpty(client, auctionAddress)
	})

	test('auction time limit prevents bids after expiration', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 10n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		await mockWindow.advanceTime(AUCTION_TIME + 1n)

		const tick = tickForPrice(TRUTH_AUCTION_PRICE_PRECISION)
		const bidAmount = 1n * 10n ** 18n
		await assert.rejects(async () => await submitBid(client, auctionAddress, tick, bidAmount), /Auction bidding period has ended/)
	})
})
