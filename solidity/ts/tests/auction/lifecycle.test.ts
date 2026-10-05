import { beforeEach, describe, test } from 'bun:test'
import { encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { tickToPrice, TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { computeClearing, finalize, getClearingTick, getEthRaiseCapAttoEth, getEthRaisedAttoEth, getMinBidSizeAttoEth, getTotalRepPurchasedAttoRep, isFinalized, refundLosingBids, simulateWithdrawBids, startAuction, submitBid, withdrawBids } from '../../testSupport/simulator/utils/contracts/auction'
import { ensureDefined, strictEqual18Decimal, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { formatStorageSlot } from '../../testSupport/storage'
import { priceToClosestTick } from '../../testSupport/truthAuctionTicks'
import { statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../types/contractArtifact'
import { assertContractEmpty, previewFinalization, setupStandardAuction, submitBidAndVerifyLock, useAuctionFixture } from './fixture'
import { assertClearing, assertClearingTickInRange, assertExpectedClearing, ATTOETH_PER_ETH, AUCTION_TIME, buildRefundedTreeStateDiff, DEFAULT_ETH_RAISE_CAP, DEFAULT_MAX_REP, getAuctionNodeBaseSlot, getBidDataStartSlot, requireTransactionHash, tickAtOrAbovePrice, tickForPrice, UINT128_BITS } from './model'

describe('UniformPriceDualCapBatchAuction: Lifecycle & Finalization', () => {
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

	test('deadline boundaries apply consistently to competing bid and finalize transactions in one block', async () => {
		const boundaryCases = [
			{ offset: -1n, bidStatus: 'success', finalizeStatus: 'reverted' },
			{ offset: 0n, bidStatus: 'reverted', finalizeStatus: 'success' },
			{ offset: 1n, bidStatus: 'reverted', finalizeStatus: 'success' },
		] as const

		for (let index = 0; index < boundaryCases.length; index += 1) {
			const boundaryCase = ensureDefined(boundaryCases[index], `boundaryCases[${index}] is undefined`)
			const boundarySnapshot = await mockWindow.anvilSnapshot()
			const bidder = createTestClient(index + 3)
			await startAuction(client, auctionAddress, 10n * ATTOETH_PER_ETH, 10n * ATTOETH_PER_ETH)
			const auctionStarted = await client.readContract({
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				address: auctionAddress,
				functionName: 'auctionStarted',
				args: [],
			})
			const bidValue = await getMinBidSizeAttoEth(client, auctionAddress)
			const bidData = encodeFunctionData({
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'submitBid',
				args: [0n],
			})
			const finalizeData = encodeFunctionData({
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'finalize',
				args: [],
			})

			try {
				await mockWindow.requestRaw({ method: 'anvil_setAutomine', params: [false] })
				await mockWindow.requestRaw({ method: 'evm_setNextBlockTimestamp', params: [`0x${(auctionStarted + AUCTION_TIME + boundaryCase.offset).toString(16)}`] })
				const bidHash = requireTransactionHash(
					await mockWindow.requestRaw({
						method: 'eth_sendTransaction',
						params: [{ from: bidder.account.address, to: auctionAddress, data: bidData, value: `0x${bidValue.toString(16)}`, gas: '0x989680' }],
					}),
				)
				const finalizeHash = requireTransactionHash(
					await mockWindow.requestRaw({
						method: 'eth_sendTransaction',
						params: [{ from: client.account.address, to: auctionAddress, data: finalizeData, gas: '0x989680' }],
					}),
				)
				await mockWindow.requestRaw({ method: 'evm_mine', params: [] })

				const bidReceipt = await client.getTransactionReceipt({ hash: bidHash })
				const finalizeReceipt = await client.getTransactionReceipt({ hash: finalizeHash })
				strictEqualTypeSafe(bidReceipt.blockHash, finalizeReceipt.blockHash, `offset ${boundaryCase.offset.toString()}: competing transactions should share one block`)
				strictEqualTypeSafe(bidReceipt.status, boundaryCase.bidStatus, `offset ${boundaryCase.offset.toString()}: bid status should match the strict deadline`)
				strictEqualTypeSafe(finalizeReceipt.status, boundaryCase.finalizeStatus, `offset ${boundaryCase.offset.toString()}: finalize status should match the inclusive deadline`)
			} finally {
				await mockWindow.requestRaw({ method: 'anvil_setAutomine', params: [true] })
				await mockWindow.anvilRevert(boundarySnapshot)
			}
		}
	})

	test('finalize rejects before the auction starts or ends', async () => {
		const attacker = createTestClient(1)
		await assert.rejects(async () => await finalize(attacker, auctionAddress), /Only the auction owner can finalize/)
		assert.strictEqual(await isFinalized(client, auctionAddress), false, 'rejected unauthorized finalization must leave the auction unfinalized')

		await assert.rejects(async () => await finalize(client, auctionAddress), /Auction must be started before finalization/)

		const raiseCap = DEFAULT_ETH_RAISE_CAP * ATTOETH_PER_ETH
		await setupStandardAuction(client, auctionAddress)
		await submitBid(client, auctionAddress, tickForPrice(TRUTH_AUCTION_PRICE_PRECISION), raiseCap)

		await assert.rejects(async () => await finalize(client, auctionAddress), /Auction bidding period is still active/)
	})

	test('can start auction and make a single bid that finalizes', async () => {
		const raiseCap = DEFAULT_ETH_RAISE_CAP * ATTOETH_PER_ETH
		await setupStandardAuction(client, auctionAddress)

		const tick = tickForPrice(TRUTH_AUCTION_PRICE_PRECISION)
		const bidSize = raiseCap
		const startBalance = await submitBidAndVerifyLock(client, auctionAddress, tick, bidSize)
		strictEqual18Decimal(await getEthRaiseCapAttoEth(client, auctionAddress), bidSize, 'we bid the same as cap')

		const clearing = await computeClearing(client, auctionAddress)
		assertExpectedClearing(clearing, tick)
		const [previewEthToSend, previewRepPurchased] = await previewFinalization(client, auctionAddress)
		strictEqualTypeSafe(previewEthToSend, raiseCap, 'funded preview should return the ETH sent at finalization')
		strictEqualTypeSafe(previewRepPurchased, raiseCap, 'funded preview should return the REP purchased at finalization')

		await finalizeAndVerify(client, auctionAddress)

		const bids = [{ tick, bidSize, bidIndex: 0n }]
		await assertFairPayoutForUser(client, auctionAddress, client.account.address, bids, clearing.foundTick)

		const finalBalance = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(startBalance, finalBalance, 'did not get eth back')
	})

	test('multiple bids', async () => {
		const maxAttoRepBeingSold = DEFAULT_MAX_REP * ATTOETH_PER_ETH
		const startBalance = await getETHBalance(client, client.account.address)
		await setupStandardAuction(client, auctionAddress)

		const bids = [
			{ bidSize: maxAttoRepBeingSold / 5n, priceRepEth: TRUTH_AUCTION_PRICE_PRECISION / 4n },
			{ bidSize: maxAttoRepBeingSold / 5n, priceRepEth: TRUTH_AUCTION_PRICE_PRECISION / 2n },
			{ bidSize: maxAttoRepBeingSold / 5n, priceRepEth: TRUTH_AUCTION_PRICE_PRECISION },
			{ bidSize: maxAttoRepBeingSold / 5n, priceRepEth: TRUTH_AUCTION_PRICE_PRECISION * 2n },
			{ bidSize: maxAttoRepBeingSold / 5n, priceRepEth: TRUTH_AUCTION_PRICE_PRECISION * 3n },
			{ bidSize: maxAttoRepBeingSold / 5n, priceRepEth: TRUTH_AUCTION_PRICE_PRECISION * 4n },
		]

		for (const bid of bids) {
			const tick = tickForPrice(bid.priceRepEth)
			await submitBidAndVerifyLock(client, auctionAddress, tick, bid.bidSize)
		}

		const clearing = await computeClearing(client, auctionAddress)
		assertClearing(clearing, true)
		assertClearingTickInRange(clearing.foundTick)

		await finalizeAndVerify(client, auctionAddress)

		const fairPayoutBids = bids.map(bid => ({ tick: tickForPrice(bid.priceRepEth), bidSize: bid.bidSize, bidIndex: 0n }))

		await assertFairPayoutForUser(client, auctionAddress, client.account.address, fairPayoutBids, clearing.foundTick)

		await assertContractEmpty(client, auctionAddress)

		const finalBalance = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(startBalance, finalBalance, 'did not get eth back')
	})

	test('multiple users bids', async () => {
		const maxAttoRepBeingSold = DEFAULT_MAX_REP * ATTOETH_PER_ETH
		await setupStandardAuction(client, auctionAddress)
		const bids = [
			{ bidSize: (2n * maxAttoRepBeingSold) / 7n, tick: priceToClosestTick(TRUTH_AUCTION_PRICE_PRECISION / 4n), address: TEST_ADDRESSES[0], bidIndex: 0n },
			{ bidSize: (2n * maxAttoRepBeingSold) / 7n, tick: priceToClosestTick(TRUTH_AUCTION_PRICE_PRECISION / 4n), address: TEST_ADDRESSES[1], bidIndex: 1n },
			{ bidSize: (2n * maxAttoRepBeingSold) / 7n, tick: priceToClosestTick(TRUTH_AUCTION_PRICE_PRECISION), address: TEST_ADDRESSES[2], bidIndex: 0n },
			{ bidSize: (2n * maxAttoRepBeingSold) / 7n, tick: priceToClosestTick(TRUTH_AUCTION_PRICE_PRECISION), address: TEST_ADDRESSES[3], bidIndex: 1n },
			{ bidSize: (2n * maxAttoRepBeingSold) / 7n, tick: priceToClosestTick(TRUTH_AUCTION_PRICE_PRECISION * 4n), address: TEST_ADDRESSES[4], bidIndex: 0n },
			{ bidSize: (2n * maxAttoRepBeingSold) / 7n, tick: priceToClosestTick(TRUTH_AUCTION_PRICE_PRECISION * 4n), address: TEST_ADDRESSES[5], bidIndex: 1n },
		]

		for (const bid of bids) {
			const bidClient = createWriteClient(mockWindow, bid.address)
			await submitBid(bidClient, auctionAddress, bid.tick, bid.bidSize)
		}

		const clearing = await computeClearing(client, auctionAddress)
		const completelyFilling = bids.filter(x => x.tick > clearing.foundTick)
		const completelyFillingRep = completelyFilling.reduce((a, b) => a + (b.bidSize * TRUTH_AUCTION_PRICE_PRECISION) / tickToPrice(clearing.foundTick), 0n)
		assert.ok(completelyFillingRep < maxAttoRepBeingSold, 'selling too much rep with that tick')

		await finalizeAndVerify(client, auctionAddress)

		const bidsByUser = new Map<bigint, typeof bids>()
		for (const bid of bids) {
			const addr = bid.address
			if (!bidsByUser.has(addr)) bidsByUser.set(addr, [])
			const bidsForAddr = ensureDefined(bidsByUser.get(addr), `No bids array for address ${addr}`)
			bidsForAddr.push(bid)
		}

		let grandTotalFilled = 0n
		for (const [userAddress, userBids] of bidsByUser) {
			const fairPayoutBids = userBids.map(b => ({ tick: b.tick, bidSize: b.bidSize, bidIndex: b.bidIndex }))
			const result = await assertFairPayoutForUser(client, auctionAddress, addressString(userAddress), fairPayoutBids, clearing.foundTick)
			grandTotalFilled += result.totalFilledAttoRep
		}

		// Total filled REP across all users should not exceed the amount sold
		assert.ok(grandTotalFilled <= maxAttoRepBeingSold, 'total filled REP exceeds maxAttoRepBeingSold')
	})

	test('computeClearing selects the lower price tick when only lower-price cumulative demand exhausts supply', async () => {
		await setupStandardAuction(client, auctionAddress, 1_000n, 100n)

		const expensiveTick = tickAtOrAbovePrice(40n * TRUTH_AUCTION_PRICE_PRECISION)
		const cheapTick = tickAtOrAbovePrice(10n * TRUTH_AUCTION_PRICE_PRECISION)
		const expensiveBidAmount = 100n * ATTOETH_PER_ETH
		const cheapBidAmount = 1_000n * ATTOETH_PER_ETH

		await submitBid(client, auctionAddress, expensiveTick, expensiveBidAmount)
		await submitBid(client, auctionAddress, cheapTick, cheapBidAmount)

		const clearing = await computeClearing(client, auctionAddress)

		assertExpectedClearing(clearing, cheapTick)
	})

	test('winning bids receive their requested REP and clearing-tick bids refund excess ETH', async () => {
		await setupStandardAuction(client, auctionAddress)

		const alice = createTestClient(0)
		const bob = createTestClient(1)

		const aliceTick = tickForPrice(TRUTH_AUCTION_PRICE_PRECISION * 2n)
		const aliceEth = 190n * 10n ** 18n
		const bobTick = tickForPrice(TRUTH_AUCTION_PRICE_PRECISION * 4n)
		const bobEth = 20n * 10n ** 18n

		await submitBidAndVerifyLock(alice, auctionAddress, aliceTick, aliceEth)
		await submitBidAndVerifyLock(bob, auctionAddress, bobTick, bobEth)

		const clearingPre = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPre.hitCap, true, 'auction should have price')

		await finalizeAndVerify(client, auctionAddress)

		const clearingTick = await getClearingTick(client, auctionAddress)
		strictEqualTypeSafe(clearingTick, aliceTick, 'clearing tick should be alice tick')

		const aliceBids = [{ tick: aliceTick, bidSize: aliceEth, bidIndex: 0n }]
		const bobBids = [{ tick: bobTick, bidSize: bobEth, bidIndex: 0n }]

		const aliceResult = await assertFairPayoutForUser(client, auctionAddress, alice.account.address, aliceBids, clearingTick)
		const bobResult = await assertFairPayoutForUser(client, auctionAddress, bob.account.address, bobBids, clearingTick)

		const totalFilled = aliceResult.totalFilledAttoRep + bobResult.totalFilledAttoRep
		const maxRep = DEFAULT_MAX_REP * ATTOETH_PER_ETH
		assert.ok(totalFilled <= maxRep, 'total filled exceeds maxRep')
	})

	test('normal auction assigns cross-tick clearing-price dust independently of withdrawal order', async () => {
		const alice = createTestClient(1)
		const bob = createTestClient(2)
		const expensiveTick = 2n
		const clearingDustTick = 1n

		await startAuction(client, auctionAddress, 2n, 100n)
		await submitBid(alice, auctionAddress, expensiveTick, 1n)
		await submitBid(bob, auctionAddress, clearingDustTick, 1n)

		const clearing = await computeClearing(client, auctionAddress)
		assertClearing(clearing, true, clearingDustTick, 2n)

		await finalizeAndVerify(client, auctionAddress)

		const totalAttoRepPurchased = await getTotalRepPurchasedAttoRep(client, auctionAddress)
		strictEqualTypeSafe(totalAttoRepPurchased, 1n, 'aggregate auction accounting should purchase one attoREP')
		const settlementSnapshot = await mockWindow.anvilSnapshot()

		const aliceWithdrawal = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: expensiveTick, bidIndex: 0n }])
		strictEqualTypeSafe(aliceWithdrawal.totalFilledAttoRep, 0n, 'the higher-tick dust bid should round down at the start of the winning prefix')
		strictEqualTypeSafe(aliceWithdrawal.totalRefundAttoEth, 0n, 'winning dust-sized withdrawal should not refund ETH')
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: expensiveTick, bidIndex: 0n }])

		const bobWithdrawal = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: clearingDustTick, bidIndex: 0n }])
		strictEqualTypeSafe(bobWithdrawal.totalFilledAttoRep, 1n, 'the lower winning tick should receive the deterministic cross-tick rounding unit')
		strictEqualTypeSafe(bobWithdrawal.totalRefundAttoEth, 0n, 'winning dust-sized withdrawal should not refund ETH')
		strictEqualTypeSafe(aliceWithdrawal.totalFilledAttoRep + bobWithdrawal.totalFilledAttoRep, totalAttoRepPurchased, 'all finalized REP should be claimable across sequential withdrawals')

		await mockWindow.anvilRevert(settlementSnapshot)

		const bobFirstWithdrawal = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: clearingDustTick, bidIndex: 0n }])
		strictEqualTypeSafe(bobFirstWithdrawal.totalFilledAttoRep, bobWithdrawal.totalFilledAttoRep, 'Bob allocation should not depend on withdrawing before Alice')
		await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: clearingDustTick, bidIndex: 0n }])
		const aliceSecondWithdrawal = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: expensiveTick, bidIndex: 0n }])
		strictEqualTypeSafe(aliceSecondWithdrawal.totalFilledAttoRep, aliceWithdrawal.totalFilledAttoRep, 'Alice allocation should not depend on withdrawing after Bob')
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: expensiveTick, bidIndex: 0n }])
		strictEqualTypeSafe(aliceSecondWithdrawal.totalFilledAttoRep + bobFirstWithdrawal.totalFilledAttoRep, totalAttoRepPurchased, 'reverse-order withdrawals should reconcile to finalized REP')
	})

	test('multiple bids at same tick from same bidder (FIFO pro-rata)', async () => {
		const attoEthRaiseCap = 10n * 10n ** 18n
		const maxAttoRepBeingSold = 10n * 10n ** 18n
		const alice = createTestClient(0)

		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)
		const sameTick = 0n
		const bid1Amount = 7n * 10n ** 18n
		const bid2Amount = 7n * 10n ** 18n

		await submitBidAndVerifyLock(alice, auctionAddress, sameTick, bid1Amount)
		await submitBidAndVerifyLock(alice, auctionAddress, sameTick, bid2Amount)

		const raisecap = await getEthRaiseCapAttoEth(client, auctionAddress)
		strictEqual18Decimal(raisecap, attoEthRaiseCap, 'raisecap for eth is same')
		await finalizeAndVerify(client, auctionAddress)

		const aliceBids = [
			{ tick: sameTick, bidSize: bid1Amount, bidIndex: 0n },
			{ tick: sameTick, bidSize: bid2Amount, bidIndex: 1n },
		]

		await assertFairPayoutForUser(client, auctionAddress, alice.account.address, aliceBids, 0n, 10n)
	})

	test('combined refundLosingBids and withdrawBids for same user with mixed winning/losing bids', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 50n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)

		const losingTick = -20000n
		const clearingTickBid = 0n
		const winningTick = 10000n

		const losingEth = 2n * 10n ** 18n
		const mediumEth = 40n * 10n ** 18n
		const highEth = 150n * 10n ** 18n

		await submitBid(alice, auctionAddress, losingTick, losingEth)
		await submitBid(alice, auctionAddress, clearingTickBid, mediumEth)
		await submitBid(alice, auctionAddress, winningTick, highEth)

		const clearingPre = await computeClearing(client, auctionAddress)
		assert.ok(clearingPre.hitCap, 'price not found')

		const clearingTick = clearingPre.foundTick
		assert.strictEqual(clearingTick, winningTick, 'clearing tick expected to be winningTick')
		assert.ok(losingTick < clearingTick, 'losing tick should be below clearing')
		assert.ok(winningTick >= clearingTick, 'winning tick should be equal clearing')

		await refundLosingBids(alice, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

		// Compute expected attoEthRaised after refund (matches what finalize will use)
		const clearingAfterRefund = await computeClearing(client, auctionAddress)
		const expectedEthRaised = clearingAfterRefund.accumulatedBidAttoEth

		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await getEthRaisedAttoEth(client, auctionAddress), expectedEthRaised, 'raised amount mismatch')
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')

		const clearingPost = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPost.foundTick, clearingTick, 'clearing tick changed after refund')
		strictEqualTypeSafe(clearingPost.hitCap, true, 'price found after refund')

		const remainingBids = [
			{ tick: clearingTickBid, bidSize: mediumEth, bidIndex: 0n },
			{ tick: winningTick, bidSize: highEth, bidIndex: 0n },
		]

		await assertFairPayoutForUser(client, auctionAddress, alice.account.address, remainingBids, clearingTick)

		await assertContractEmpty(client, auctionAddress)
	})

	test('partial fill calculations ignore cleared earlier bids at the same tick', async () => {
		const raiseCap = 100n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 100n * ATTOETH_PER_ETH
		const sameTick = 0n
		const bidAmount = 60n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, raiseCap, maxAttoRepBeingSold)

		const alice = createTestClient(0)
		await submitBid(alice, auctionAddress, sameTick, bidAmount)
		await submitBid(alice, auctionAddress, sameTick, bidAmount)
		await submitBid(alice, auctionAddress, sameTick, bidAmount)

		const nodeBaseSlot = getAuctionNodeBaseSlot(1n)
		const bidDataSlot = getBidDataStartSlot(sameTick)
		const firstBidEthAmountSlot = formatStorageSlot(bidDataSlot + 1n)
		const nodeTotalEthSlot = formatStorageSlot(nodeBaseSlot + 1n)
		const nodeSubtreeEthSlot = formatStorageSlot(nodeBaseSlot + 2n)
		const activeTotalEth = 2n * bidAmount
		const refundedTreeStateDiff = buildRefundedTreeStateDiff(sameTick, 3n, 1n, bidAmount)

		await mockWindow.addStateOverrides({
			[auctionAddress]: {
				stateDiff: {
					[firstBidEthAmountSlot]: bidAmount << UINT128_BITS,
					[nodeTotalEthSlot]: activeTotalEth,
					[nodeSubtreeEthSlot]: activeTotalEth,
					...refundedTreeStateDiff,
				},
			},
		})

		await finalizeAndVerify(client, auctionAddress)

		const secondBidWithdrawal = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 1n }])
		const expectedSecondBidRep = bidAmount

		strictEqualTypeSafe(secondBidWithdrawal.totalFilledAttoRep, expectedSecondBidRep, 'the second active bid should receive its full fill after an earlier bid is cleared from the tick')
		strictEqualTypeSafe(secondBidWithdrawal.totalRefundAttoEth, 0n, 'the fully filled second active bid should not receive an ETH refund')
	})
})
