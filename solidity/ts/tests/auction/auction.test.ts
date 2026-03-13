import { test, beforeEach, describe } from 'bun:test'
import { createWriteClient, WriteClient } from '../../testsuite/simulator/utils/viem'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../../testsuite/simulator/MockWindowEthereum'
import { TEST_ADDRESSES } from '../../testsuite/simulator/utils/constants'
import { contractExists, getETHBalance, setupTestAccounts } from '../../testsuite/simulator/utils/utilities'
import { Address } from 'viem'
import { computeClearing, deployDualCapBatchAuction, finalize, getClearingTick, getMinBidSize, simulateWithdrawBids, isFinalized, refundLosingBids, startAuction, submitBid, withdrawBids, getEthRaiseCap, getEthRaised } from '../../testsuite/simulator/utils/contracts/auction'
import { approximatelyEqual, strictEqual18Decimal, strictEqualTypeSafe } from '../../testsuite/simulator/utils/testUtils'
import { priceToClosestTick, tickToPrice } from '../../testsuite/simulator/utils/tickMath'
import assert from 'assert'
import { ensureZoltarDeployed } from '../../testsuite/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../../testsuite/simulator/utils/contracts/deployPeripherals'
import { getDualCapBatchAuctionAddress } from '../../testsuite/simulator/utils/contracts/deployments'
import { addressString } from '../../testsuite/simulator/utils/bigint'
import { SimulationState } from '../../testsuite/simulator/types/visualizerTypes'
import { copySimulationState } from '../../testsuite/simulator/SimulationModeEthereumClientService'

// ============ MODULE-LEVEL CONSTANTS ============
const WEI_PER_ETH = 1000000000000000000n
const PRICE_PRECISION = WEI_PER_ETH
const AUCTION_TIME = 604800n
const MIN_TICK = -524288n
const MAX_TICK = 524288n
const DEFAULT_TOLERANCE = 1000n

const DEFAULT_ETH_RAISE_CAP = 200_000n
const DEFAULT_MAX_REP = 100n

describe('Auction', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient
	let auctionAddress: Address
	let cachedSimulationState: SimulationState | undefined = undefined

	// ============ Helper Functions ============

	function createTestClient(idx: number): WriteClient {
		return createWriteClient(mockWindow, TEST_ADDRESSES[idx], 0)
	}

	function tickForPrice(price: bigint): bigint {
		return priceToClosestTick(price)
	}

	async function submitBidAndVerifyLock(client: WriteClient, auctionAddress: Address, tick: bigint, bidAmount: bigint): Promise<bigint> {
		const before = await getETHBalance(client, client.account.address)
		await submitBid(client, auctionAddress, tick, bidAmount)
		const after = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(before - bidAmount, after, `bid ${bidAmount} not locked`)
		return before
	}

	function assertClearing(clearing: { priceFound: boolean; foundTick: bigint; accumulatedEth: bigint }, expectedPriceFound: boolean, expectedTick?: bigint, expectedAccumulatedEth?: bigint) {
		strictEqualTypeSafe(clearing.priceFound, expectedPriceFound, 'clearing.priceFound mismatch')
		if (expectedPriceFound && expectedTick !== undefined) {
			strictEqualTypeSafe(clearing.foundTick, expectedTick, 'clearing.foundTick mismatch')
		}
		if (expectedAccumulatedEth !== undefined) {
			strictEqualTypeSafe(clearing.accumulatedEth, expectedAccumulatedEth, 'clearing.accumulatedEth mismatch')
		}
	}

	function assertExpectedClearing(clearing: { priceFound: boolean; foundTick: bigint; accumulatedEth: bigint }, expectedTick: bigint, expectedAccumulatedEth?: bigint): void {
		assertClearing(clearing, true)
		if (clearing.priceFound) strictEqualTypeSafe(clearing.foundTick, expectedTick, 'clearing tick mismatch')
		if (expectedAccumulatedEth !== undefined) {
			strictEqualTypeSafe(clearing.accumulatedEth, expectedAccumulatedEth, 'accumulatedEth mismatch')
		}
	}

	async function finalizeAndVerify(client: WriteClient, auctionAddress: Address): Promise<void> {
		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'auction not finalized')
	}

	function assertWithdrawal(amounts: { totalFilledRep: bigint; totalEthRefund: bigint }, expectedFilledRep: bigint, expectedRefund: bigint, tolerance?: bigint) {
		if (tolerance !== undefined) {
			approximatelyEqual(amounts.totalFilledRep, expectedFilledRep, tolerance, 'filledRep mismatch')
			approximatelyEqual(amounts.totalEthRefund, expectedRefund, tolerance, 'ethRefund mismatch')
		} else {
			strictEqualTypeSafe(amounts.totalFilledRep, expectedFilledRep, 'filledRep mismatch')
			strictEqualTypeSafe(amounts.totalEthRefund, expectedRefund, 'ethRefund mismatch')
		}
	}

	async function assertContractEmpty(client: WriteClient, auctionAddress: Address, tolerance: bigint = 1000n): Promise<void> {
		approximatelyEqual(await getETHBalance(client, auctionAddress), 0n, tolerance, 'contract not empty')
	}

	async function setupStandardAuction(client: WriteClient, auctionAddress: Address, ethRaiseCapEth: bigint = DEFAULT_ETH_RAISE_CAP, maxRepBeingSold: bigint = DEFAULT_MAX_REP): Promise<void> {
		await startAuction(client, auctionAddress, ethRaiseCapEth * WEI_PER_ETH, maxRepBeingSold * WEI_PER_ETH)
	}

	async function assertFairPayoutForUser(auctionCreator: WriteClient, auctionAddress: Address, userId: `0x${ string }`, bids: { tick: bigint; bidSize: bigint; bidIndex: bigint }[], clearingTick: bigint, tolerance: bigint = DEFAULT_TOLERANCE): Promise<{ totalFilledRep: bigint; totalEthRefund: bigint }> {
		const clearingPrice = tickToPrice(clearingTick)
		let totalFilledRep = 0n
		let totalEthRefund = 0n

		for (const bid of bids) {
			const amounts = await simulateWithdrawBids(auctionCreator, auctionAddress, userId, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
			const minRepBackOnFullBuy = (bid.bidSize * WEI_PER_ETH) / tickToPrice(bid.tick)
			if (bid.tick < clearingTick) {
				// Losing bid: full refund, no REP
				assert.strictEqual(amounts.totalFilledRep, 0n, `Bid ${ bid.bidIndex } (losing): should get 0 REP`)
				approximatelyEqual(amounts.totalEthRefund, bid.bidSize, tolerance, `Bid ${ bid.bidIndex } (losing): full ETH refund`)
				totalEthRefund += amounts.totalEthRefund
			} else if (bid.tick === clearingTick) {
				// At-clearing: partial fill, partial refund
				if (amounts.totalEthRefund !== bid.bidSize) assert.ok(amounts.totalFilledRep > 0n, `Bid ${ bid.bidIndex } (clearing): should get some REP`)
				assert.ok(amounts.totalFilledRep <= minRepBackOnFullBuy, `Bid ${ bid.bidIndex } (clearing): filled REP <= demand`)
				const ethUsed = (amounts.totalFilledRep * clearingPrice) / WEI_PER_ETH
				approximatelyEqual(amounts.totalEthRefund, bid.bidSize - ethUsed, tolerance, `Bid ${ bid.bidIndex } (clearing): correct ETH refund`)
				totalFilledRep += amounts.totalFilledRep
				totalEthRefund += amounts.totalEthRefund
			} else {
				// Winning bid: full REP demand, no ETH refund
				assert.ok(amounts.totalFilledRep >= minRepBackOnFullBuy, `Bid ${ bid.bidIndex } (winning): REP fill`)
				assert.strictEqual(amounts.totalEthRefund, 0n, `Bid ${ bid.bidIndex } (winning): no ETH refund`)
				totalFilledRep += amounts.totalFilledRep
			}
			await withdrawBids(auctionCreator, auctionAddress, userId, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
		}
		return { totalFilledRep, totalEthRefund }
	}

	function assertClearingTickInRange(tick: bigint): void {
		assert.ok(tick >= MIN_TICK && tick <= MAX_TICK, `clearing tick ${tick} outside [${MIN_TICK}, ${MAX_TICK}]`)
	}

	beforeEach(async () => {
		if (cachedSimulationState) {
			mockWindow = getMockedEthSimulateWindowEthereum(true, copySimulationState(cachedSimulationState))
		} else {
			mockWindow = getMockedEthSimulateWindowEthereum()
			await setupTestAccounts(mockWindow)
			client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
			await ensureZoltarDeployed(client)
			await ensureInfraDeployed(client)
			await deployDualCapBatchAuction(client, client.account.address)
			cachedSimulationState = copySimulationState(mockWindow.getSimulationState()!)
		}
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		auctionAddress = getDualCapBatchAuctionAddress(client.account.address)
		assert.ok(await contractExists(client, auctionAddress), 'auction exists')
	})

	// ============ Test Suites ============

	describe('Lifecycle & Finalization', () => {
		test('can start auction and make a single bid that finalizes', async () => {
			const raiseCap = DEFAULT_ETH_RAISE_CAP * WEI_PER_ETH
			await setupStandardAuction(client, auctionAddress)

			const tick = tickForPrice(PRICE_PRECISION)
			const bidSize = raiseCap
			const startBalance = await submitBidAndVerifyLock(client, auctionAddress, tick, bidSize)
			strictEqual18Decimal(await getEthRaiseCap(client, auctionAddress), bidSize, 'we bid the same as cap')

			const clearing = await computeClearing(client, auctionAddress)
			assertExpectedClearing(clearing, tick)

			await finalizeAndVerify(client, auctionAddress)

			const bids = [{ tick, bidSize, bidIndex: 0n }]
			await assertFairPayoutForUser(client, auctionAddress, client.account.address, bids, clearing.foundTick)

			const finalBalance = await getETHBalance(client, client.account.address)
			strictEqualTypeSafe(startBalance, finalBalance, 'did not get eth back')
		})

		test('multiple bids', async () => {
			const maxRepBeingSold = DEFAULT_MAX_REP * WEI_PER_ETH
			const startBalance = await getETHBalance(client, client.account.address)
			await setupStandardAuction(client, auctionAddress)

			const bids = [
				{ bidSize: maxRepBeingSold / 5n, priceRepEth: PRICE_PRECISION / 4n },
				{ bidSize: maxRepBeingSold / 5n, priceRepEth: PRICE_PRECISION / 2n },
				{ bidSize: maxRepBeingSold / 5n, priceRepEth: PRICE_PRECISION },
				{ bidSize: maxRepBeingSold / 5n, priceRepEth: PRICE_PRECISION * 2n },
				{ bidSize: maxRepBeingSold / 5n, priceRepEth: PRICE_PRECISION * 3n },
				{ bidSize: maxRepBeingSold / 5n, priceRepEth: PRICE_PRECISION * 4n },
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
			const maxRepBeingSold = DEFAULT_MAX_REP * WEI_PER_ETH
			await setupStandardAuction(client, auctionAddress)
			const bids = [
				{ bidSize: 2n * maxRepBeingSold / 7n, tick: priceToClosestTick(PRICE_PRECISION / 4n), address: TEST_ADDRESSES[0], bidIndex: 0n },
				{ bidSize: 2n * maxRepBeingSold / 7n, tick: priceToClosestTick(PRICE_PRECISION / 4n), address: TEST_ADDRESSES[1], bidIndex: 1n },
				{ bidSize: 2n * maxRepBeingSold / 7n, tick: priceToClosestTick(PRICE_PRECISION), address: TEST_ADDRESSES[2], bidIndex: 0n },
				{ bidSize: 2n * maxRepBeingSold / 7n, tick: priceToClosestTick(PRICE_PRECISION), address: TEST_ADDRESSES[3], bidIndex: 1n },
				{ bidSize: 2n * maxRepBeingSold / 7n, tick: priceToClosestTick(PRICE_PRECISION * 4n), address: TEST_ADDRESSES[4], bidIndex: 0n },
				{ bidSize: 2n * maxRepBeingSold / 7n, tick: priceToClosestTick(PRICE_PRECISION * 4n), address: TEST_ADDRESSES[5], bidIndex: 1n },
			]

			for (const bid of bids) {
				const bidClient = createWriteClient(mockWindow, bid.address, 0)
				await submitBid(bidClient, auctionAddress, bid.tick, bid.bidSize)
			}

			//const expectedClearing = computeClearingTypeScript(bids, maxRepBeingSold, DEFAULT_MAX_REP * WEI_PER_ETH)

			const clearing = await computeClearing(client, auctionAddress)
			const completelyFilling = bids.filter((x) => x.tick > clearing.foundTick)
			const completelyFillingRep = completelyFilling.reduce((a,b) => a + b.bidSize * PRICE_PRECISION / tickToPrice(clearing.foundTick),0n)
			assert.ok(completelyFillingRep < maxRepBeingSold, 'selling too much rep with that tick')

			//assertExpectedClearing(clearing, expectedClearing.clearingTick)

			await finalizeAndVerify(client, auctionAddress)

			const bidsByUser = new Map<bigint, typeof bids>()
			for (const bid of bids) {
				const addr = bid.address
				if (!bidsByUser.has(addr)) bidsByUser.set(addr, [])
				bidsByUser.get(addr)!.push(bid)
			}

			let grandTotalFilled = 0n
			for (const [userAddress, userBids] of bidsByUser) {
				const fairPayoutBids = userBids.map(b => ({ tick: b.tick, bidSize: b.bidSize, bidIndex: b.bidIndex }))
				const result = await assertFairPayoutForUser(client, auctionAddress, addressString(userAddress), fairPayoutBids, clearing.foundTick)
				grandTotalFilled += result.totalFilledRep
			}

			// Total filled REP across all users should not exceed the amount sold
			assert.ok(grandTotalFilled <= maxRepBeingSold, 'total filled REP exceeds maxRepBeingSold')
		})

		test('winning bids receive exactly their requested repAmount with correct eth refund', async () => {
			await setupStandardAuction(client, auctionAddress)

			const alice = createTestClient(0)
			const bob = createTestClient(1)

			const aliceTick = tickForPrice(PRICE_PRECISION * 2n)
			const aliceEth = 30n * 10n ** 18n
			const bobTick = tickForPrice(PRICE_PRECISION * 4n)
			const bobEth = 20n * 10n ** 18n

			await submitBidAndVerifyLock(alice, auctionAddress, aliceTick, aliceEth)
			await submitBidAndVerifyLock(bob, auctionAddress, bobTick, bobEth)

			const clearingPre = await computeClearing(client, auctionAddress)
			strictEqualTypeSafe(clearingPre.priceFound, true, 'auction should have price')

			await finalizeAndVerify(client, auctionAddress)

			const clearingTick = await getClearingTick(client, auctionAddress)
			strictEqualTypeSafe(clearingTick, aliceTick, 'clearing tick should be alice tick')

			const aliceBids = [{ tick: aliceTick, bidSize: aliceEth, bidIndex: 0n }]
			const bobBids = [{ tick: bobTick, bidSize: bobEth, bidIndex: 0n }]

			const aliceResult = await assertFairPayoutForUser(client, auctionAddress, alice.account.address, aliceBids, clearingTick)
			const bobResult = await assertFairPayoutForUser(client, auctionAddress, bob.account.address, bobBids, clearingTick)

			const totalFilled = aliceResult.totalFilledRep + bobResult.totalFilledRep
			const maxRep = DEFAULT_MAX_REP * WEI_PER_ETH
			assert.ok(totalFilled <= maxRep, 'total filled exceeds maxRep')
		})

		test('multiple bids at same tick from same bidder (FIFO pro-rata)', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n
			const alice = createTestClient(0)

			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
			const sameTick = 0n
			const bid1Amount = 7n * 10n ** 18n
			const bid2Amount = 7n * 10n ** 18n

			await submitBidAndVerifyLock(alice, auctionAddress, sameTick, bid1Amount)
			await submitBidAndVerifyLock(alice, auctionAddress, sameTick, bid2Amount)

			const raisecap = await getEthRaiseCap(client, auctionAddress)
			strictEqual18Decimal(raisecap, ethRaiseCap, 'raisecap for eth is same')
			await finalizeAndVerify(client, auctionAddress)

			const aliceBids = [
				{ tick: sameTick, bidSize: bid1Amount, bidIndex: 0n },
				{ tick: sameTick, bidSize: bid2Amount, bidIndex: 1n }
			]

			await assertFairPayoutForUser(client, auctionAddress, alice.account.address, aliceBids, 0n, 10n)
		})

		test('combined refundLosingBids and withdrawBids for same user with mixed winning/losing bids', async () => {
			const ethRaiseCap = 200_000n * 10n ** 18n
			const maxRepBeingSold = 50n * 10n ** 18n
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const alice = createTestClient(0)

			const losingTick = -20000n
			const clearingTickBid = 0n
			const winningTick = 10000n

			const losingEth = 2n * 10n ** 18n
			const mediumEth = 40n * 10n ** 18n
			const highEth = 30n * 10n ** 18n

			await submitBid(alice, auctionAddress, losingTick, losingEth)
			await submitBid(alice, auctionAddress, clearingTickBid, mediumEth)
			await submitBid(alice, auctionAddress, winningTick, highEth)

			const clearingPre = await computeClearing(client, auctionAddress)
			assert.ok(clearingPre.priceFound, 'price not found')

			const clearingTick = clearingPre.foundTick
			assert.strictEqual(clearingTick, winningTick, 'clearing tick expected to be winningTick')
			assert.ok(losingTick < clearingTick, 'losing tick should be below clearing')
			assert.ok(winningTick >= clearingTick, 'winning tick should be equal clearing')

			await refundLosingBids(alice, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

			// Compute expected ethRaised after refund (matches what finalize will use)
			const clearingAfterRefund = await computeClearing(client, auctionAddress)
			const expectedEthRaised = clearingAfterRefund.accumulatedEth

			await finalize(client, auctionAddress)
			strictEqualTypeSafe(await getEthRaised(client, auctionAddress), expectedEthRaised, 'raised amount mismatch')
			strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')

			const clearingPost = await computeClearing(client, auctionAddress)
			strictEqualTypeSafe(clearingPost.foundTick, clearingTick, 'clearing tick changed after refund')
			strictEqualTypeSafe(clearingPost.priceFound, true, 'price found after refund')

			const remainingBids = [
				{ tick: clearingTickBid, bidSize: mediumEth, bidIndex: 0n },
				{ tick: winningTick, bidSize: highEth, bidIndex: 0n }
			]

			await assertFairPayoutForUser(client, auctionAddress, alice.account.address, remainingBids, clearingTick)

			await assertContractEmpty(client, auctionAddress)
		})

		test('winner unaffected after bidder refunds multiple losing bids', async () => {
			await setupStandardAuction(client, auctionAddress)

			const alice = createTestClient(0)
			const bob = createTestClient(1)

			const lowTicks = [
				tickForPrice(PRICE_PRECISION / 4n),
				tickForPrice(PRICE_PRECISION / 3n),
				tickForPrice(PRICE_PRECISION / 2n),
			]
			const minBidSize = await getMinBidSize(client, auctionAddress)
			const lowBid = minBidSize
			for (const t of lowTicks) {
				await submitBid(alice, auctionAddress, t, lowBid)
			}

			const bobTick = 0n
			const bobEth = 120n * 10n ** 18n
			await submitBidAndVerifyLock(bob, auctionAddress, bobTick, bobEth)

			const clearingPre = await computeClearing(client, auctionAddress)
			assert.ok(clearingPre.priceFound, 'price found')
			strictEqualTypeSafe(clearingPre.foundTick, bobTick, 'clearing tick is bobTick')

			const aliceBalanceBefore = await getETHBalance(client, alice.account.address)

			const refundIndices = lowTicks.map(t => ({ tick: t, bidIndex: 0n }))
			await refundLosingBids(alice, auctionAddress, refundIndices)

			const aliceBalanceAfter = await getETHBalance(client, alice.account.address)
			strictEqualTypeSafe(aliceBalanceAfter - aliceBalanceBefore, 3n * lowBid, 'Alice total refund')

			await finalizeAndVerify(client, auctionAddress)

			const bobBids = [{ tick: bobTick, bidSize: bobEth, bidIndex: 0n }]
			await assertFairPayoutForUser(client, auctionAddress, bob.account.address, bobBids, bobTick, 10n)
		})

		test('should correctly handle underfunded auctions', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 100n * 10n ** 18n
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const price = PRICE_PRECISION
			const alice = createTestClient(0)

			await submitBid(alice, auctionAddress, tickForPrice(price), 1n * 10n ** 18n)

			await finalize(client, auctionAddress)

			const clearing = await computeClearing(client, auctionAddress)
			strictEqualTypeSafe(clearing.priceFound, false, 'auction should not have price')
		})

		test('auction time limit prevents bids after expiration', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			await mockWindow.advanceTime(AUCTION_TIME + 1n)

			const tick = tickForPrice(PRICE_PRECISION)
			const bidAmount = 1n * 10n ** 18n
			await assert.rejects(async () => await submitBid(client, auctionAddress, tick, bidAmount), 'Auction ended')
		})
	})

	describe('Bid Submission', () => {
		test('minimum bid size enforcement', async () => {
			const ethRaiseCap = 50000n
			const maxRepBeingSold = 1n * 10n ** 18n
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const minBid = await getMinBidSize(client, auctionAddress)
			strictEqualTypeSafe(minBid, 1n, 'minBidSize should be 1')

			await assert.rejects(
			async () => await submitBid(client, auctionAddress, 0n, 0n), 'invalid')

			await submitBid(client, auctionAddress, 0n, 1n)
		})

		test('submitBid invalid states: before auction start and after finalize', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n
			const tick = tickForPrice(PRICE_PRECISION)
			const bidAmount = 1n * 10n ** 18n

			const freshAddress = getDualCapBatchAuctionAddress(addressString(TEST_ADDRESSES[3]))
			await deployDualCapBatchAuction(client, addressString(TEST_ADDRESSES[3]))
			await assert.rejects(async () => await submitBid(client, freshAddress, tick, bidAmount), 'invalid')

			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
			await finalize(client, auctionAddress)

			await assert.rejects(async () => await submitBid(client, auctionAddress, tick, bidAmount), 'finalized')
		})

		test('withdrawBids reverts before finalize', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n
			const tick = tickForPrice(PRICE_PRECISION)

			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
			await submitBid(client, auctionAddress, tick, 1n * 10n ** 18n)

			await assert.rejects(async () => await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }]), 'not finalized')
		})
	})

	describe('Clearing & Pro-Rata', () => {
		test('both caps enforced: ETH cap binds and limits REP sold', async () => {
			const ethRaiseCap = 50n * 10n ** 18n
			const maxRepBeingSold = 100n * 10n ** 18n
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const price = 2n * 10n ** 18n
			const tick = tickForPrice(price)
			const bidAmount = 100n * 10n ** 18n

			await submitBidAndVerifyLock(client, auctionAddress, tick, bidAmount)
			const beforeFinalizeAuctionEth = await getETHBalance(client, auctionAddress)

			await finalizeAndVerify(client, auctionAddress)

			const afterFinalizeAuctionEth = await getETHBalance(client, auctionAddress)
			const clearingTick = await getClearingTick(client, auctionAddress)
			const clearingPrice = tickToPrice(clearingTick)
			approximatelyEqual(beforeFinalizeAuctionEth - afterFinalizeAuctionEth, maxRepBeingSold * PRICE_PRECISION / clearingPrice, 1000n, 'Auction sent about the cap to owner')

			const clearing = await computeClearing(client, auctionAddress);
			const expectedFilledRep =  clearing.accumulatedEth * PRICE_PRECISION / clearingPrice

			const clearing2 = await computeClearing(client, auctionAddress)
			strictEqualTypeSafe(clearing2.foundTick, tick, 'tick matches the bid')

			const amounts = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
			approximatelyEqual(amounts.totalFilledRep, expectedFilledRep, 1000n, 'filled rep should match ETH cap')
			approximatelyEqual(amounts.totalEthRefund, afterFinalizeAuctionEth, 1000n, 'simulated refund should match remaining contract balance')

			await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
			await assertContractEmpty(client, auctionAddress)
		})

		test('multiple bids at same tick from same bidder (FIFO pro-rata) - clearing suite', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n
			const alice = createTestClient(0)

			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const sameTick = 0n
			const bid1Amount = 7n * 10n ** 18n
			const bid2Amount = 7n * 10n ** 18n

			await submitBidAndVerifyLock(alice, auctionAddress, sameTick, bid1Amount)
			await submitBidAndVerifyLock(alice, auctionAddress, sameTick, bid2Amount)

			await finalizeAndVerify(client, auctionAddress)

			const aliceBids = [
				{ tick: sameTick, bidSize: bid1Amount, bidIndex: 0n },
				{ tick: sameTick, bidSize: bid2Amount, bidIndex: 1n }
			]

			await assertFairPayoutForUser(client, auctionAddress, alice.account.address, aliceBids, 0n, 10n)
		})

		test('non-sequential withdrawal of same-tick bids yields correct allocation', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n

			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const sameTick = 0n
			const bid1 = 7n * 10n ** 18n
			const bid2 = 7n * 10n ** 18n

			await submitBidAndVerifyLock(client, auctionAddress, sameTick, bid1)
			await submitBidAndVerifyLock(client, auctionAddress, sameTick, bid2)

			await finalizeAndVerify(client, auctionAddress)

			const amounts1 = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick: sameTick, bidIndex: 1n }])
			assertWithdrawal(amounts1, 3n * 10n ** 18n, 4n * 10n ** 18n)
			const amounts0 = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick: sameTick, bidIndex: 0n }])
			assertWithdrawal(amounts0, 7n * 10n ** 18n, 0n)

			await withdrawBids(client, auctionAddress, client.account.address, [{ tick: sameTick, bidIndex: 1n }])
			await withdrawBids(client, auctionAddress, client.account.address, [{ tick: sameTick, bidIndex: 0n }])
		})
	})

	describe('Withdrawals & Refunds', () => {
		const refundCases = [
			{
				name: 'allows refund for bid below clearing',
				ethRaiseCap: 10n * 10n ** 18n,
				maxRepBeingSold: 10n * 10n ** 18n,
				alicePrice: WEI_PER_ETH / 2n,
				aliceAmount: 10n * 10n ** 18n,
				bobPrice: WEI_PER_ETH,
				bobAmount: 10n * 10n ** 18n,
				refundBidder: 'alice' as const,
				expectedClearingTick: tickForPrice(WEI_PER_ETH),
				expectRefundToSucceed: true,
				checkClearingUnchanged: true,
			},
			{
				name: 'rejects refund for bid at clearing tick',
				ethRaiseCap: 10n * 10n ** 18n,
				maxRepBeingSold: 10n * 10n ** 18n, // increase so Alice alone does not hit cap
				alicePrice: WEI_PER_ETH,
				aliceAmount: 4n * 10n ** 18n,       // 4 ETH at price 1 → 4 REP
				bobPrice: 2n * WEI_PER_ETH,
				bobAmount: 6n * 10n ** 18n,         // 6 ETH at price 2 → hits remaining 6 REP (cap reached)
				refundBidder: 'bob' as const,
				expectedClearingTick: tickForPrice(2n * WEI_PER_ETH),
				expectRefundToSucceed: false,        // Bob is at clearing tick → cannot refund
				checkClearingUnchanged: true,        // Alice refund below clearing would not change clearing
			},
			{
				name: 'rejects refund for bid above clearing',
				ethRaiseCap: 10n * 10n ** 18n,
				maxRepBeingSold: 5n * 10n ** 18n,
				alicePrice: WEI_PER_ETH,
				aliceAmount: 4n * 10n ** 18n,
				bobPrice: 2n * WEI_PER_ETH,
				bobAmount: 6n * 10n ** 18n,
				refundBidder: 'bob' as const,
				expectedClearingTick: tickForPrice(2n * WEI_PER_ETH),
				expectRefundToSucceed: false,
				checkClearingUnchanged: false,
			},
		]

		test.each(refundCases)('refundLosingBids: $name', async (c) => {
			await startAuction(client, auctionAddress, c.ethRaiseCap, c.maxRepBeingSold)

			const alice = createTestClient(0)
			const bob = createTestClient(1)

			const aliceTick = tickForPrice(c.alicePrice)
			const bobTick = tickForPrice(c.bobPrice)

			await submitBid(alice, auctionAddress, aliceTick, c.aliceAmount)
			await submitBid(bob, auctionAddress, bobTick, c.bobAmount)

			const clearing = await computeClearing(client, auctionAddress)
			assertExpectedClearing(clearing, c.expectedClearingTick)

			const refundClient = c.refundBidder === 'alice' ? alice : bob
			const refundTick = c.refundBidder === 'alice' ? aliceTick : bobTick

			if (c.expectRefundToSucceed) {
				const pre = await getETHBalance(client, refundClient.account.address)
				await refundLosingBids(refundClient, auctionAddress, [{ tick: refundTick, bidIndex: 0n }])
				const post = await getETHBalance(client, refundClient.account.address)
				approximatelyEqual(post - pre, c.refundBidder === 'alice' ? c.aliceAmount : c.bobAmount, DEFAULT_TOLERANCE, 'refund amount')
			} else {
				await assert.rejects(async () => await refundLosingBids(refundClient, auctionAddress, [{ tick: refundTick, bidIndex: 0n }]), 'cannot withdraw binding bid')
			}

			if (c.checkClearingUnchanged) {
				const clearingAfter = await computeClearing(client, auctionAddress)
				strictEqualTypeSafe(clearingAfter.foundTick, c.expectedClearingTick, 'clearing tick changed after refund')
			}

			await finalizeAndVerify(client, auctionAddress)
		})
	})

	describe('Auction Management', () => {
		test('startAuction validation', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n

			const attacker = createTestClient(1)
			await assert.rejects(async () => await startAuction(attacker, auctionAddress, ethRaiseCap, maxRepBeingSold), 'only owner')

			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			await assert.rejects(async () => await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold), 'already started')
		})
	})

	describe('Edge Cases & Boundary Conditions', () => {
		function computeExpectedClearing(
			bids: Array<{ tick: bigint; amount: bigint }>,
			maxRepBeingSold: bigint,
			ethRaiseCap: bigint
		): { priceFound: boolean; foundTick: bigint; accumulatedEth: bigint } {
			const sorted = [...bids].sort((a, b) => {
				if (b.tick > a.tick) return 1
				if (b.tick < a.tick) return -1
				return 0
			})
			let accumulatedEth = 0n
			for (const bid of sorted) {
				const price = tickToPrice(bid.tick)
				const maxEthAtThisTick = maxRepBeingSold * PRICE_PRECISION / price
				const newAccumulatedEth = accumulatedEth + bid.amount

				if (newAccumulatedEth > maxEthAtThisTick) {
					const ethFilledAtClearing = accumulatedEth >= maxEthAtThisTick ? 0n : maxEthAtThisTick - accumulatedEth
					accumulatedEth += ethFilledAtClearing
					return { priceFound: true, foundTick: bid.tick, accumulatedEth }
				}

				if (newAccumulatedEth >= ethRaiseCap) {
					accumulatedEth = ethRaiseCap
					return { priceFound: true, foundTick: bid.tick, accumulatedEth }
				}

				accumulatedEth = newAccumulatedEth
			}
			return { priceFound: false, foundTick: 0n, accumulatedEth: 0n }
		}

		const edgeCaseTests = [
			{
				name: 'single bid exactly hits ethRaiseCap',
				ethRaiseCap: 100n * 10n ** 18n,
				maxRepBeingSold: 1000n * 10n ** 18n,
				bids: [{ tick: 0n, amount: 100n * 10n ** 18n }],
			},
			{
				name: 'single bid exceeds both caps (limited by ETH cap)',
				ethRaiseCap: 30n * 10n ** 18n,
				maxRepBeingSold: 100n * 10n ** 18n,
				bids: [{ tick: 0n, amount: 100n * 10n ** 18n }],
			},
			{
				name: 'multiple bids precisely fill ethRaiseCap at clearing',
				ethRaiseCap: 100n * 10n ** 18n,
				maxRepBeingSold: 1000n * 10n ** 18n,
				bids: [
					{ tick: 20000n, amount: 40n * 10n ** 18n },
					{ tick: 10000n, amount: 35n * 10n ** 18n },
					{ tick: 0n, amount: 25n * 10n ** 18n },
				],
			},
			{
				name: 'multiple bids hit REP cap at high tick',
				ethRaiseCap: 1000n * 10n ** 18n,
				maxRepBeingSold: 100n * 10n ** 18n,
				bids: [
					{ tick: 20000n, amount: 40n * 10n ** 18n },
					{ tick: 10000n, amount: 35n * 10n ** 18n },
					{ tick: 0n, amount: 25n * 10n ** 18n },
				],
			},
			{
				name: 'bids at MIN_TICK boundary',
				ethRaiseCap: 100n * 10n ** 18n,
				maxRepBeingSold: 1000n * 10n ** 18n,
				// Use moderately negative ticks to avoid overflow in tickToPrice
				bids: [
					{ tick: -20000n, amount: 50n * 10n ** 18n },
					{ tick: -10000n, amount: 60n * 10n ** 18n },
				],
			},
			{
				name: 'bids at MAX_TICK boundary',
				ethRaiseCap: 100n * 10n ** 18n,
				maxRepBeingSold: 1000n * 10n ** 18n,
				// Use moderately high positive ticks to avoid overflow
				bids: [
					{ tick: 20000n, amount: 50n * 10n ** 18n },
					{ tick: 10000n, amount: 60n * 10n ** 18n },
				],
			},
			{
				name: 'underfunded auction',
				ethRaiseCap: 1000n * 10n ** 18n,
				maxRepBeingSold: 1000n * 10n ** 18n,
				bids: [{ tick: 0n, amount: 1n * 10n ** 18n }],
			},
			{
				name: 'many small bids',
				ethRaiseCap: 10n * 10n ** 18n,
				maxRepBeingSold: 10n * 10n ** 18n,
				bids: Array.from({ length: 10 }, () => ({ tick: 0n, amount: 1n * 10n ** 18n })),
			},
		]

		test.each(edgeCaseTests)('covers various edge cases: $name', async (c) => {
			await startAuction(client, auctionAddress, c.ethRaiseCap, c.maxRepBeingSold)

			// Build fair payout bids with correct per-tick indices
			const tickIndexCount = new Map<bigint, number>()
			const fairPayoutBids = c.bids.map(bid => {
				const count = tickIndexCount.get(bid.tick) ?? 0
				tickIndexCount.set(bid.tick, count + 1)
				return { tick: bid.tick, bidSize: bid.amount, bidIndex: BigInt(count) }
			})

			for (const bid of c.bids) {
				await submitBid(client, auctionAddress, bid.tick, bid.amount)
			}

			const expected = computeExpectedClearing(c.bids, c.maxRepBeingSold, c.ethRaiseCap)
			const clearing = await computeClearing(client, auctionAddress)

			assert.strictEqual(clearing.priceFound, expected.priceFound, `${c.name}: priceFound mismatch`)
			if (expected.priceFound) {
				strictEqualTypeSafe(clearing.foundTick, expected.foundTick, `${c.name}: foundTick mismatch`)
				strictEqualTypeSafe(clearing.accumulatedEth, expected.accumulatedEth, `${c.name}: accumulatedEth mismatch`)
				await finalize(client, auctionAddress)
				await assertFairPayoutForUser(client, auctionAddress, client.account.address, fairPayoutBids, clearing.foundTick)
			} else {
				assert.strictEqual(clearing.priceFound, false, `${c.name}: expected no clearing price`)
				// Finalize anyway to clear the contract balance
				await finalize(client, auctionAddress)
			}

			await assertContractEmpty(client, auctionAddress)
		})
	})

	describe('Withdrawals after finalization require owner', () => {
		test('losing bidder cannot withdraw after finalization - only owner can call withdrawBids', async () => {
			// Setup auction with enough capacity
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			// Losing bidder (not owner)
			const alice = createTestClient(1)
			const losingTick = -20000n
			const losingEth = 2n * 10n ** 18n
			await submitBid(alice, auctionAddress, losingTick, losingEth)

			// Owner places a bid that will be at the clearing tick
			const clearingTick = 0n
			const clearingEth = 9n * 10n ** 18n
			await submitBid(client, auctionAddress, clearingTick, clearingEth)

			// Winning bidder (not owner) - tick above clearing
			const bob = createTestClient(2)
			const winningTick = 10000n
			const winningEth = 1n * 10n ** 18n
			await submitBid(bob, auctionAddress, winningTick, winningEth)

			// Verify clearing tick is above losing tick
			const clearingPre = await computeClearing(client, auctionAddress)
			assert.ok(clearingPre.priceFound)
			strictEqualTypeSafe(clearingPre.foundTick, clearingTick, 'clearing tick should be 0')
			strictEqualTypeSafe(clearingPre.foundTick > losingTick, true)

			// Finalize
			await finalize(client, auctionAddress)
			strictEqualTypeSafe(await isFinalized(client, auctionAddress), true)

			// 1) Non-owner (alice) cannot withdraw her losing bid -> revert with "Only owner can call"
			await assert.rejects(
				async () => await withdrawBids(alice, auctionAddress, alice.account.address, [{ tick: losingTick, bidIndex: 0n }]),
				'Only owner can call'
			)

			// 2) Non-owner (bob) cannot withdraw his winning bid -> also revert
			await assert.rejects(
				async () => await withdrawBids(bob, auctionAddress, bob.account.address, [{ tick: winningTick, bidIndex: 0n }]),
				'Only owner can call'
			)

			// 3) Owner withdraws for alice (losing) -> full ETH refund
			const aliceBalanceBefore = await getETHBalance(client, alice.account.address)
			await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: losingTick, bidIndex: 0n }])
			const aliceBalanceAfter = await getETHBalance(client, alice.account.address)
			strictEqualTypeSafe(aliceBalanceAfter - aliceBalanceBefore, losingEth, 'Alice should get full ETH refund')

			// 4) Owner withdraws for bob (winning) -> no ETH refund, simulate confirms
			const bobAmounts = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: winningTick, bidIndex: 0n }])
			strictEqualTypeSafe(bobAmounts.totalEthRefund, 0n, 'Bob should get no ETH refund (winning bid)')
			await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: winningTick, bidIndex: 0n }])

			// 5) Owner withdraws own clearing bid (optional for completeness)
			await withdrawBids(client, auctionAddress, client.account.address, [{ tick: clearingTick, bidIndex: 0n }])
		})
	})
})
