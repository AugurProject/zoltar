import { test, beforeEach, describe } from 'bun:test'
import { createWriteClient, WriteClient } from '../../testsuite/simulator/utils/viem'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../../testsuite/simulator/MockWindowEthereum'
import { TEST_ADDRESSES } from '../../testsuite/simulator/utils/constants'
import { contractExists, getETHBalance, setupTestAccounts } from '../../testsuite/simulator/utils/utilities'
import { Address } from 'viem'
import { computeClearing, deployDualCapBatchAuction, finalize, getClearingTick, getMinBidSize, simulateWithdrawBids, isFinalized, refundLosingBids, startAuction, submitBid, withdrawBids } from '../../testsuite/simulator/utils/contracts/auction'
import { approximatelyEqual, strictEqualTypeSafe } from '../../testsuite/simulator/utils/testUtils'
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
const PRICE_PRECISION = WEI_PER_ETH // alias for clarity with existing code
const AUCTION_TIME = 604800n // 1 week in seconds
const MIN_TICK = -524288n
const MAX_TICK = 524288n
const DEFAULT_TOLERANCE = 1000n
const ZERO = 0n

// Standard test scenarios
const DEFAULT_ETH_RAISE_CAP = 200_000n
const DEFAULT_MAX_REP = 100n

describe('Auction', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient
	let auctionAddress: Address

	// Cache for simulation state to speed up test runs
	let cachedSimulationState: SimulationState | undefined = undefined

	// ============ Helper Functions ============

	// Create a test client for a specific TEST_ADDRESSES index
	function createTestClient(idx: number): WriteClient {
		return createWriteClient(mockWindow, TEST_ADDRESSES[idx], 0)
	}

	// Convert price to tick (shorthand)
	function tickForPrice(price: bigint): bigint {
		return priceToClosestTick(price)
	}

	// Submit a bid and verify the correct ETH amount was locked
	async function submitBidAndVerifyLock(
		client: WriteClient,
		auctionAddress: Address,
		tick: bigint,
		bidAmount: bigint
	): Promise<bigint> {
		const before = await getETHBalance(client, client.account.address)
		await submitBid(client, auctionAddress, tick, bidAmount)
		const after = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(before - bidAmount, after, `bid ${bidAmount} not locked`)
		return before
	}

	// Verify clearing state matches expectations
	function assertClearing(
		clearing: { priceFound: boolean; foundTick: bigint; repAbove: bigint },
		expectedPriceFound: boolean,
		expectedTick?: bigint,
		expectedRepAbove?: bigint
	) {
		strictEqualTypeSafe(clearing.priceFound, expectedPriceFound, 'clearing.priceFound mismatch')
		if (expectedPriceFound && expectedTick !== undefined) {
			strictEqualTypeSafe(clearing.foundTick, expectedTick, 'clearing.foundTick mismatch')
		}
		if (expectedRepAbove !== undefined) {
			strictEqualTypeSafe(clearing.repAbove, expectedRepAbove, 'clearing.repAbove mismatch')
		}
	}

	// Assert clearing matches expected values (convenience wrapper)
	function assertExpectedClearing(
		clearing: { priceFound: boolean; foundTick: bigint; repAbove: bigint },
		expectedTick: bigint,
		expectedRepAbove?: bigint
	): void {
		assertClearing(clearing, true)
		strictEqualTypeSafe(clearing.foundTick, expectedTick, 'clearing tick mismatch')
		if (expectedRepAbove !== undefined) {
			strictEqualTypeSafe(clearing.repAbove, expectedRepAbove, 'repAbove mismatch')
		}
	}

	// Finalize auction and verify it's finalized
	async function finalizeAndVerify(client: WriteClient, auctionAddress: Address): Promise<void> {
		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'auction not finalized')
	}

	// Verify withdrawal simulation results
	function assertWithdrawal(
		amounts: { totalFilledRep: bigint; totalEthRefund: bigint },
		expectedFilledRep: bigint,
		expectedRefund: bigint,
		tolerance?: bigint
	) {
		if (tolerance !== undefined) {
			approximatelyEqual(amounts.totalFilledRep, expectedFilledRep, tolerance, 'filledRep mismatch')
			approximatelyEqual(amounts.totalEthRefund, expectedRefund, tolerance, 'ethRefund mismatch')
		} else {
			strictEqualTypeSafe(amounts.totalFilledRep, expectedFilledRep, 'filledRep mismatch')
			strictEqualTypeSafe(amounts.totalEthRefund, expectedRefund, 'ethRefund mismatch')
		}
	}

	// Verify contract balance is approximately zero
	async function assertContractEmpty(client: WriteClient, auctionAddress: Address, tolerance: bigint = 1000n): Promise<void> {
		const balance = await getETHBalance(client, auctionAddress)
		approximatelyEqual(balance, 0n, tolerance, 'contract not empty')
	}

	// Setup auction with standard parameters (defaults: 200k ETH raise cap, 100 REP sold)
	async function setupStandardAuction(
		client: WriteClient,
		auctionAddress: Address,
		ethRaiseCapEth: bigint = DEFAULT_ETH_RAISE_CAP,
		maxRepEth: bigint = DEFAULT_MAX_REP
	): Promise<void> {
		await startAuction(
			client,
			auctionAddress,
			ethRaiseCapEth * WEI_PER_ETH,
			maxRepEth * WEI_PER_ETH
		)
	}

	/**
	 * Verifies that a user's bids were paid out fairly after auction finalization.
	 * A fair payout means:
	 * - Losing bids (tick < clearing): full ETH refund, 0 REP
	 * - Winning bids (tick > clearing): full REP demand, 0 ETH refund
	 * - At-clearing bids: partial fill pro-rata, remainder refund
	 */
	async function assertFairPayoutForUser(
		client: WriteClient,
		auctionAddress: Address,
		userId: `0x${string}`,
		bids: { tick: bigint; bidSize: bigint; bidIndex: bigint }[],
		clearingTick: bigint,
		tolerance: bigint = DEFAULT_TOLERANCE
	): Promise<void> {
		const clearingPrice = tickToPrice(clearingTick)

		for (const bid of bids) {
			const amounts: { totalFilledRep: bigint; totalEthRefund: bigint } = await simulateWithdrawBids(
				client,
				auctionAddress,
				userId,
				[{ tick: bid.tick, bidIndex: bid.bidIndex }]
			)

			const pricePerRep = tickToPrice(bid.tick)
			const repDemand = pricePerRep > 0n ? (bid.bidSize * WEI_PER_ETH) / pricePerRep : ZERO

			if (bid.tick < clearingTick) {
				// Losing bid: full refund, no REP
				assert.strictEqual(amounts.totalFilledRep, 0n, `Bid ${bid.bidIndex} (losing): should get 0 REP`)
				approximatelyEqual(amounts.totalEthRefund, bid.bidSize, tolerance, `Bid ${bid.bidIndex} (losing): full ETH refund`)
			} else if (bid.tick === clearingTick) {
				// At-clearing: partial fill, partial refund
				assert.ok(amounts.totalFilledRep > 0n, `Bid ${bid.bidIndex} (clearing): should get some REP`)
				assert.ok(amounts.totalFilledRep <= repDemand, `Bid ${bid.bidIndex} (clearing): filled REP <= demand`)
				approximatelyEqual(amounts.totalFilledRep, repDemand, tolerance * 10n, `Bid ${bid.bidIndex} (clearing): REP fill approx demand`)

				const ethUsed = (amounts.totalFilledRep * clearingPrice) / WEI_PER_ETH
				approximatelyEqual(amounts.totalEthRefund, bid.bidSize - ethUsed, tolerance, `Bid ${bid.bidIndex} (clearing): correct ETH refund`)
			} else {
				// Winning bid: full REP demand, no ETH refund
				approximatelyEqual(amounts.totalFilledRep, repDemand, tolerance, `Bid ${bid.bidIndex} (winning): REP fill`)
				assert.strictEqual(amounts.totalEthRefund, 0n, `Bid ${bid.bidIndex} (winning): no ETH refund`)
			}

			await withdrawBids(client, auctionAddress, userId, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
		}
	}

	/**
	 * Calculate expected clearing tick from bids
	 */
	function calculateExpectedClearingFromBids(
		bids: { bidSize: bigint; priceRepEth: bigint }[],
		maxRepSold: bigint
	): { tick: bigint; totalRepDemand: bigint } {
		// Sort by price descending
		const sorted = [...bids].sort((a, b) => Number(b.priceRepEth - a.priceRepEth))
		let cumulativeRep = 0n
		let i = 0

		while (i < sorted.length && cumulativeRep < maxRepSold) {
			const bid = sorted[i]
			const repAtPrice = (bid.bidSize * WEI_PER_ETH) / bid.priceRepEth
			if (cumulativeRep + repAtPrice > maxRepSold) {
				// This tick becomes the clearing tick (partial fill)
				break
			}
			cumulativeRep += repAtPrice
			i++
		}

		return {
			tick: i < sorted.length ? tickForPrice(sorted[i].priceRepEth) : ZERO,
			totalRepDemand: cumulativeRep
		}
	}

	/**
	 * Assert clearing tick is within valid bounds
	 */
	function assertClearingTickInRange(tick: bigint): void {
		assert.ok(tick >= MIN_TICK && tick <= MAX_TICK, `clearing tick ${tick} outside [${MIN_TICK}, ${MAX_TICK}]`)
	}

	beforeEach(async () => {
		if (cachedSimulationState) {
			// Restore from cache (deep copy to avoid mutations)
			mockWindow = getMockedEthSimulateWindowEthereum(true, copySimulationState(cachedSimulationState))
		} else {
			// Fresh setup - run full initialization
			mockWindow = getMockedEthSimulateWindowEthereum()
			await setupTestAccounts(mockWindow)
			client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
			await ensureZoltarDeployed(client)
			await ensureInfraDeployed(client)
			await deployDualCapBatchAuction(client, client.account.address)
			// Cache the state after first full setup (deep copy)
			cachedSimulationState = copySimulationState(mockWindow.getSimulationState()!)
		}
		// Always create a fresh client for the current mockWindow
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		//mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments()))
		auctionAddress = getDualCapBatchAuctionAddress(client.account.address)
		assert.ok(await contractExists(client, auctionAddress), 'auction exists')
	})

	test.concurrent('can start auction and make a single bid that finalizes', async () => {
		const maxRepBeingSold = DEFAULT_MAX_REP * WEI_PER_ETH
		await setupStandardAuction(client, auctionAddress)

		const tick = tickForPrice(PRICE_PRECISION)
		const bidSize = maxRepBeingSold
		const startBalance = await submitBidAndVerifyLock(client, auctionAddress, tick, bidSize)

		const clearing = await computeClearing(client, auctionAddress)
		assertExpectedClearing(clearing, tick)

		await finalizeAndVerify(client, auctionAddress)

		// Use assertFairPayoutForUser for single bid
		const bids = [{ tick, bidSize, bidIndex: 0n }]
		await assertFairPayoutForUser(
			client,
			auctionAddress,
			client.account.address,
			bids,
			clearing.foundTick
		)

		// Verify final balance: should be startBalance minus net ETH spent (≈ maxRepBeingSold for 1:1 price)
		const finalBalance = await getETHBalance(client, client.account.address)
		approximatelyEqual(startBalance - finalBalance, maxRepBeingSold, DEFAULT_TOLERANCE, 'net ETH spent should equal REP bought')
	})

	test.concurrent('multiple bids', async () => {
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

		// Submit bids and verify lock
		for (const bid of bids) {
			const tick = tickForPrice(bid.priceRepEth)
			await submitBidAndVerifyLock(client, auctionAddress, tick, bid.bidSize)
		}

		// Compute clearing
		const clearing = await computeClearing(client, auctionAddress)
		assertClearing(clearing, true) // price must be found
		assertClearingTickInRange(clearing.foundTick)

		await finalizeAndVerify(client, auctionAddress)

		// Convert bids to format expected by assertFairPayoutForUser
		const fairPayoutBids = bids.map(bid => ({
			tick: tickForPrice(bid.priceRepEth),
			bidSize: bid.bidSize,
			bidIndex: 0n // single bid per tick, so index is 0
		}))

		// Verify fair payout for all bids
		await assertFairPayoutForUser(
			client,
			auctionAddress,
			client.account.address,
			fairPayoutBids,
			clearing.foundTick
		)

		// Verify contract empty
		await assertContractEmpty(client, auctionAddress)

		// Net ETH spent should approximately equal REP bought (with tolerance for rounding)
		const finalBalance = await getETHBalance(client, client.account.address)
		approximatelyEqual(startBalance - finalBalance, maxRepBeingSold, DEFAULT_TOLERANCE * 10n, 'net ETH spent should approx equal REP bought')
	})

	test.concurrent('multiple users bids', async () => {
		const maxRepBeingSold = DEFAULT_MAX_REP * WEI_PER_ETH
		await setupStandardAuction(client, auctionAddress)
		const bids = [
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION / 4n, address: TEST_ADDRESSES[0], bidIndex: 0n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION / 4n, address: TEST_ADDRESSES[1], bidIndex: 1n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION, address: TEST_ADDRESSES[2], bidIndex: 0n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION, address: TEST_ADDRESSES[3], bidIndex: 1n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION * 4n, address: TEST_ADDRESSES[4], bidIndex: 0n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION * 4n, address: TEST_ADDRESSES[5], bidIndex: 1n },
		]

		// Submit bids from different users
		for (const bid of bids) {
			const bidClient = createWriteClient(mockWindow, bid.address, 0)
			const tick = tickForPrice(bid.priceRepEth)
			await submitBid(bidClient, auctionAddress, tick, bid.bidSize)
		}

		// Calculate expected clearing dynamically
		const expectedClearing = calculateExpectedClearingFromBids(
			bids.map(b => ({ bidSize: b.bidSize, priceRepEth: b.priceRepEth })),
			maxRepBeingSold
		)

		const clearing = await computeClearing(client, auctionAddress)
		assertExpectedClearing(clearing, expectedClearing.tick)

		await finalizeAndVerify(client, auctionAddress)

		// Group bids by user address (bigint)
		const bidsByUser = new Map<bigint, typeof bids>()
		for (const bid of bids) {
			const addr = bid.address
			if (!bidsByUser.has(addr)) {
				bidsByUser.set(addr, [])
			}
			bidsByUser.get(addr)!.push(bid)
		}

		// Verify fair payout for each user
		for (const [userAddress, userBids] of bidsByUser) {
			const userClient = createWriteClient(mockWindow, userAddress, 0)
			const fairPayoutBids = userBids.map(b => ({
				tick: tickForPrice(b.priceRepEth),
				bidSize: b.bidSize,
				bidIndex: b.bidIndex
			}))

			await assertFairPayoutForUser(
				userClient,
				auctionAddress,
				addressString(userAddress),
				fairPayoutBids,
				clearing.foundTick
			)
		}
	})

	test.concurrent('should allow withdrawing bids below clearing price', async () => {
		const ethRaiseCap = DEFAULT_ETH_RAISE_CAP * WEI_PER_ETH
		const maxRepBeingSold = DEFAULT_MAX_REP * WEI_PER_ETH
		await setupStandardAuction(client, auctionAddress)

		const price1Tick = tickForPrice(1n * 10n ** 18n / 2n)
		const price2Tick = tickForPrice(1n * 10n ** 18n)

		const alice = createTestClient(0)
		const bob = createTestClient(1)

		const aliceStartBalance = await getETHBalance(client, alice.account.address)
		await submitBid(alice, auctionAddress, price1Tick, ethRaiseCap)
		await submitBid(bob, auctionAddress, price2Tick, ethRaiseCap)

		// clearing will happen above price1
		const clearing = await computeClearing(alice, auctionAddress)
		assert.ok(clearing.foundTick > price1Tick, 'clearingPrice > price1')

		// refund bid below clearing
		assert.ok(aliceStartBalance !== await getETHBalance(client, alice.account.address), 'alice should not have original eth amount here')
		await refundLosingBids(alice, auctionAddress, [{ tick: price1Tick, bidIndex: 0n }])
		const aliceEthAfter = await getETHBalance(client, alice.account.address)
		strictEqualTypeSafe(aliceStartBalance, aliceEthAfter, 'did not get our eth back')

		const clearing2 = await computeClearing(alice, auctionAddress)
		assert.strictEqual(clearing2.foundTick, clearing.foundTick, 'foundTick does not match')
		assert.strictEqual(clearing2.priceFound, clearing.priceFound, 'priceFound does not match')
		assert.strictEqual(clearing2.repAbove, clearing.repAbove, 'repAbove does not match')

		await finalizeAndVerify(client, auctionAddress)

		const amounts = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: price2Tick, bidIndex: 0n }])
		const expectedRefund = ethRaiseCap - maxRepBeingSold * PRICE_PRECISION / tickToPrice(clearing.foundTick)
		assertWithdrawal(amounts, maxRepBeingSold, expectedRefund) // 1:1 price
		await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: price2Tick, bidIndex: 0n }])
	})

	test.concurrent('should not allow withdrawing bids at or above clearing price', async () => {
		const ethRaiseCap = 10n * 10n ** 18n
		const maxRepBeingSold = 5n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const priceLow = PRICE_PRECISION
		const priceHigh = PRICE_PRECISION * 2n

		const alice = createTestClient(0)
		const bob = createTestClient(1)

		await submitBid(alice, auctionAddress, tickForPrice(priceLow), 4n * 10n ** 18n)
		await submitBid(bob, auctionAddress, tickForPrice(priceHigh), 6n * 10n ** 18n)

		const clearing = await computeClearing(client, auctionAddress)
		assert.ok(clearing.priceFound, 'clearing not found')
		await assert.rejects(async () => { await refundLosingBids(bob, auctionAddress, [{ tick: tickForPrice(priceHigh), bidIndex: 0n }]) }, 'cannot withdraw binding bid')
	})

	test.concurrent('should correctly handle underfunded auctions', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const price = PRICE_PRECISION
		const alice = createTestClient(0)

		await submitBid(alice, auctionAddress, tickForPrice(price), 1n * 10n ** 18n)

		await finalize(client, auctionAddress)

		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.priceFound, false, 'auction should be underfunded')
	})

	test.concurrent('winning bids receive exactly their requested repAmount with correct eth refund', async () => {
		await setupStandardAuction(client, auctionAddress)

		const alice = createTestClient(0)
		const bob = createTestClient(1)

		// Alice: bid at lower tick (cheaper) that becomes clearing tick
		const aliceTick = tickForPrice(PRICE_PRECISION * 2n)
		const aliceEth = 30n * 10n ** 18n

		// Bob: bid at higher tick (more expensive) > clearing tick
		const bobTick = tickForPrice(PRICE_PRECISION * 4n)
		const bobEth = 20n * 10n ** 18n

		await submitBidAndVerifyLock(alice, auctionAddress, aliceTick, aliceEth)
		await submitBidAndVerifyLock(bob, auctionAddress, bobTick, bobEth)

		const clearingPre = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPre.priceFound, false, 'auction underfunded')

		await finalizeAndVerify(client, auctionAddress)

		// Get the actual clearing tick set after finalization (underfunded -> lowest tick)
		const clearingTick = await getClearingTick(client, auctionAddress)
		strictEqualTypeSafe(clearingTick, aliceTick, 'clearing tick should be alice tick')

		// Define bids for Alice and Bob
		const aliceBids = [{ tick: aliceTick, bidSize: aliceEth, bidIndex: 0n }]
		const bobBids = [{ tick: bobTick, bidSize: bobEth, bidIndex: 0n }]

		// Verify fair payout for both users
		await assertFairPayoutForUser(alice, auctionAddress, alice.account.address, aliceBids, clearingTick)
		await assertFairPayoutForUser(bob, auctionAddress, bob.account.address, bobBids, clearingTick)
	})

	test.concurrent('multiple bids at same tick from same bidder (FIFO pro-rata)', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n
		const alice = createTestClient(0)

		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		// Same tick (0 = price 1:1)
		const sameTick = 0n
		const bid1Amount = 7n * 10n ** 18n
		const bid2Amount = 7n * 10n ** 18n

		await submitBidAndVerifyLock(alice, auctionAddress, sameTick, bid1Amount)
		await submitBidAndVerifyLock(alice, auctionAddress, sameTick, bid2Amount)

		await finalizeAndVerify(client, auctionAddress)

		// Verify fair payout for both bids using the helper
		const aliceBids = [
			{ tick: sameTick, bidSize: bid1Amount, bidIndex: 0n },
			{ tick: sameTick, bidSize: bid2Amount, bidIndex: 1n }
		]

		await assertFairPayoutForUser(
			alice,
			auctionAddress,
			alice.account.address,
			aliceBids,
			0n,  // clearing tick is 0
			10n  // tolerance for partial fill rounding
		)
	})

	test.concurrent('auction time limit prevents bids after expiration', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		// Advance time past auction end
		await mockWindow.advanceTime(AUCTION_TIME + 1n)

		// Attempting to submit a bid should fail with "Auction ended"
		const tick = tickForPrice(PRICE_PRECISION)
		const bidAmount = 1n * 10n ** 18n
		await assert.rejects(
			async () => await submitBid(client, auctionAddress, tick, bidAmount),
			'Auction ended'
		)
	})

	test.concurrent('minimum bid size enforcement', async () => {
		// Small ethRaiseCap to get minBidSize = 1
		const ethRaiseCap = 50000n
		const maxRepBeingSold = 1n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const minBid = await getMinBidSize(client, auctionAddress)
		strictEqualTypeSafe(minBid, 1n, 'minBidSize should be 1')

		// Bid of 0 should fail
		await assert.rejects(
			async () => await submitBid(client, auctionAddress, 0n, 0n),
			'invalid'
		)

		// Bid of 1 should succeed
		await submitBid(client, auctionAddress, 0n, 1n)
	})

	test.concurrent('both caps enforced: ETH cap binds and limits REP sold', async () => {
		const ethRaiseCap = 50n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		// Price = 2 ETH/REP => tick around that
		const price = 2n * 10n ** 18n
		const tick = tickForPrice(price)
		const bidAmount = 100n * 10n ** 18n

		await submitBidAndVerifyLock(client, auctionAddress, tick, bidAmount)
		const beforeFinalizeAuctionEth = await getETHBalance(client, auctionAddress)

		await finalizeAndVerify(client, auctionAddress)

		const afterFinalizeAuctionEth = await getETHBalance(client, auctionAddress)
		// Owner should receive ethRaiseCap (or a value close due to rounding)
		approximatelyEqual(beforeFinalizeAuctionEth - afterFinalizeAuctionEth, ethRaiseCap, 1000n, 'Auction sent about the cap to owner')

		// Get the actual clearing tick and price
		const clearingTick = await getClearingTick(client, auctionAddress)
		const clearingPrice = tickToPrice(clearingTick)

		// Compute expected filled REP based on actual clearing price: ethRaiseCap * PRICE_PRECISION / clearingPrice
		const expectedFilledRep = ethRaiseCap * PRICE_PRECISION / clearingPrice

		const clearing2 = await computeClearing(client, auctionAddress)
		// The clearing tick should match the bid tick
		strictEqualTypeSafe(clearing2.foundTick, tick, 'tick matches the bid')

		// Withdraw should give filledRep ~ expectedFilledRep, refund ~ remaining ETH
		const amounts = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		approximatelyEqual(amounts.totalFilledRep, expectedFilledRep, 1000n, 'filled rep should match ETH cap')
		// The contract should have sent approximately ethRaiseCap to owner, leaving ~ bidAmount - ethRaiseCap
		approximatelyEqual(afterFinalizeAuctionEth, bidAmount - ethRaiseCap, 1000n, 'contract balance after finalize should be ~ bidAmount - ethRaiseCap')
		// The simulated refund should equal that remaining balance
		approximatelyEqual(amounts.totalEthRefund, afterFinalizeAuctionEth, 1000n, 'simulated refund should match remaining contract balance')

		await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		await assertContractEmpty(client, auctionAddress)
	})

	test.concurrent('startAuction validation', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n

		// Non-owner cannot start
		const attacker = createTestClient(1)
		await assert.rejects(async () => await startAuction(attacker, auctionAddress, ethRaiseCap, maxRepBeingSold), 'only owner')

		// Owner can start
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		// Cannot start twice
		await assert.rejects(async () => await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold), 'already started')
	})

	test.concurrent('submitBid invalid states: before auction start and after finalize', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n
		const tick = tickForPrice(PRICE_PRECISION)
		const bidAmount = 1n * 10n ** 18n

		// Cannot submit before auction starts (fresh contract)
		const freshAddress = getDualCapBatchAuctionAddress(addressString(TEST_ADDRESSES[3]))
		await deployDualCapBatchAuction(client, addressString(TEST_ADDRESSES[3]))
		await assert.rejects(
			async () => await submitBid(client, freshAddress, tick, bidAmount),
			'invalid'
		)

		// Start auction then finalize without bids
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
		await finalize(client, auctionAddress)

		// Cannot submit after finalize
		await assert.rejects(
			async () => await submitBid(client, auctionAddress, tick, bidAmount),
			'finalized'
		)
	})

	test.concurrent('withdrawBids reverts before finalize', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n
		const tick = tickForPrice(PRICE_PRECISION)

		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
		await submitBid(client, auctionAddress, tick, 1n * 10n ** 18n)

		// Cannot withdraw before finalize
		await assert.rejects(
			async () => await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }]),
			'not finalized'
		)
	})

	test.concurrent('non-sequential withdrawal of same-tick bids yields correct allocation', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n

		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const sameTick = 0n
		const bid1 = 7n * 10n ** 18n
		const bid2 = 7n * 10n ** 18n

		await submitBidAndVerifyLock(client, auctionAddress, sameTick, bid1)
		await submitBidAndVerifyLock(client, auctionAddress, sameTick, bid2)

		await finalizeAndVerify(client, auctionAddress)

		// Withdraw in reverse order: index 1 then index 0
		const amounts1 = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick: sameTick, bidIndex: 1n }])
		assertWithdrawal(amounts1, 3n * 10n ** 18n, 4n * 10n ** 18n)
		const amounts0 = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick: sameTick, bidIndex: 0n }])
		assertWithdrawal(amounts0, 7n * 10n ** 18n, 0n)

		await withdrawBids(client, auctionAddress, client.account.address, [{ tick: sameTick, bidIndex: 1n }])
		await withdrawBids(client, auctionAddress, client.account.address, [{ tick: sameTick, bidIndex: 0n }])
	})

	test.concurrent('combined refundLosingBids and withdrawBids for same user with mixed winning/losing bids', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 50n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const alice = createTestClient(0)

		// Ticks: losing (below clearing), at-clearing, winning (above clearing)
		const losingTick = -20000n
		const clearingTickBid = 0n
		const winningTick = 10000n

		const losingEth = 2n * 10n ** 18n
		const mediumEth = 40n * 10n ** 18n
		const highEth = 30n * 10n ** 18n

		await submitBid(alice, auctionAddress, losingTick, losingEth)
		await submitBid(alice, auctionAddress, clearingTickBid, mediumEth)
		await submitBid(alice, auctionAddress, winningTick, highEth)

		// Compute clearing - should find a price with clearing tick at 0
		const clearingPre = await computeClearing(client, auctionAddress)
		assert.ok(clearingPre.priceFound, 'price not found - bids should exceed maxRepBeingSold')

		const clearingTick = clearingPre.foundTick
		// Verify expected clearing tick
		assert.strictEqual(clearingTick, clearingTickBid, 'clearing tick expected to be 0')
		assert.ok(losingTick < clearingTick, 'losing tick should be below clearing')
		assert.ok(winningTick > clearingTick, 'winning tick should be above clearing')

		// Before finalize: refund the losing bid (since it's below clearing)
		await refundLosingBids(alice, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

		// Finalize
		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')

		// After finalize: verify clearing tick unchanged
		const clearingPost = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingPost.foundTick, clearingTick, 'clearing tick changed after refund')
		strictEqualTypeSafe(clearingPost.priceFound, true, 'price found after refund')

		// Verify fair payout for remaining bids (clearing tick and winning tick)
		const remainingBids = [
			{ tick: clearingTickBid, bidSize: mediumEth, bidIndex: 0n },
			{ tick: winningTick, bidSize: highEth, bidIndex: 0n }
		]

		await assertFairPayoutForUser(
			alice,
			auctionAddress,
			alice.account.address,
			remainingBids,
			clearingTick
		)

		// Check contract empty
		await assertContractEmpty(client, auctionAddress)
	})

	test.concurrent('winner unaffected after bidder refunds multiple losing bids', async () => {
		await setupStandardAuction(client, auctionAddress)

		const alice = createTestClient(0)
		const bob = createTestClient(1)

		// Alice: three losing bids at ticks below 0 (prices < 1e18)
		const lowTicks = [
			tickForPrice(PRICE_PRECISION / 4n),
			tickForPrice(PRICE_PRECISION / 3n),
			tickForPrice(PRICE_PRECISION / 2n),
		]
		// Use minBidSize to satisfy bid size requirement
		const minBidSize = await getMinBidSize(client, auctionAddress)
		const lowBid = minBidSize
		for (const t of lowTicks) {
			await submitBid(alice, auctionAddress, t, lowBid)
		}

		// Bob: winning bid at tick 0 with enough ETH to exceed maxRep
		const bobTick = 0n
		const bobEth = 120n * 10n ** 18n
		await submitBidAndVerifyLock(bob, auctionAddress, bobTick, bobEth)

		// Verify clearing tick is bobTick
		const clearingPre = await computeClearing(client, auctionAddress)
		assert.ok(clearingPre.priceFound, 'price found')
		strictEqualTypeSafe(clearingPre.foundTick, bobTick, 'clearing tick is bobTick')

		// Record Alice balance before refund
		const aliceBalanceBefore = await getETHBalance(client, alice.account.address)

		// Refund all Alice's losing bids (each tick has a single bid => bidIndex 0)
		const refundIndices = lowTicks.map(t => ({ tick: t, bidIndex: 0n }))
		await refundLosingBids(alice, auctionAddress, refundIndices)

		// Alice should get total refund = 3 * lowBid
		const aliceBalanceAfter = await getETHBalance(client, alice.account.address)
		strictEqualTypeSafe(aliceBalanceAfter - aliceBalanceBefore, 3n * lowBid, 'Alice total refund')

		// Finalize and verify Bob using fair payout helper
		await finalizeAndVerify(client, auctionAddress)

		const bobBids = [{ tick: bobTick, bidSize: bobEth, bidIndex: 0n }]
		await assertFairPayoutForUser(
			bob,
			auctionAddress,
			bob.account.address,
			bobBids,
			bobTick,
			10n  // tolerance
		)
	})
})