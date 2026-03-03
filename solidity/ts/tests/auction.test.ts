import { test, beforeEach, describe } from 'bun:test'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { contractExists, getETHBalance, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { Address } from 'viem'
import { computeClearing, deployDualCapBatchAuction, finalize, getClearingTick, getMinBidSize, simulateWithdrawBids, isFinalized, refundLosingBids, startAuction, submitBid, withdrawBids } from '../testsuite/simulator/utils/contracts/auction.js'
import { approximatelyEqual, aproximatelyEqual18Decimal, strictEqualTypeSafe } from '../testsuite/simulator/utils/testUtils.js'
import { priceToClosestTick, tickToPrice } from '../testsuite/simulator/utils/tickMath.js'
import assert from 'assert'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar.js'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals.js'
import { getDualCapBatchAuctionAddress } from '../testsuite/simulator/utils/contracts/deployments.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import { SimulationState } from '../testsuite/simulator/types/visualizerTypes.js'
import { copySimulationState } from '../testsuite/simulator/SimulationModeEthereumClientService.js'

describe('Auction', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient
	const PRICE_PRECISION = 1n * 10n ** 18n
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
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const tick = tickForPrice(PRICE_PRECISION)
		const bidSize = maxRepBeingSold
		const startBalance = await submitBidAndVerifyLock(client, auctionAddress, tick, bidSize)

		const clearing = await computeClearing(client, auctionAddress)
		assertClearing(clearing, true, tick, 0n)

		await finalizeAndVerify(client, auctionAddress)

		const withdrawAmounts = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		assertWithdrawal(withdrawAmounts, maxRepBeingSold, 0n)

		await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])

		const finalBalance = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(startBalance, finalBalance, 'did not get eth back')
	})

	test.concurrent('multiple bids', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		const startBalance = await getETHBalance(client, client.account.address)

		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

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

		await finalizeAndVerify(client, auctionAddress)

		const clearingPrice = tickToPrice(clearing.foundTick)

		// Assert clearing tick is within allowed range
		assert.ok(clearing.foundTick >= -524_288, 'Clearing tick below MIN_TICK')
		assert.ok(clearing.foundTick <= 524_288, 'Clearing tick above MAX_TICK')

		// Track cumulative REP and total ETH withdrawn
		let cumulativeRep = 0n
		let totalEthWithdrawn = 0n

		for (let i = 0; i < bids.length; i++) {
			const bid = bids[i]
			const tick = tickForPrice(bid.priceRepEth)

			// Check amounts from contract
			const amounts = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
			const repDemand = bid.bidSize * PRICE_PRECISION / bid.priceRepEth

			if (tick < clearing.foundTick) {
				// losing bid: full refund, no REP
				assertWithdrawal(amounts, 0n, bid.bidSize)
				totalEthWithdrawn += amounts.totalEthRefund
			} else if (tick === clearing.foundTick) {
				// partially filled at clearing tick
				const filledRep = amounts.totalFilledRep
				cumulativeRep += filledRep

				assert.ok(filledRep <= repDemand, `Bid ${i} at clearing tick filled too much REP`)
				assert.ok(amounts.totalEthRefund <= bid.bidSize, `Bid ${i} at clearing tick refund too high`)

				const ethUsed = filledRep * clearingPrice / PRICE_PRECISION
				totalEthWithdrawn += ethUsed + amounts.totalEthRefund
			} else {
				// fully winning bid above clearing tick
				cumulativeRep += repDemand

				assert.strictEqual(amounts.totalEthRefund, 0n, `Bid ${i} above clearing tick refund not zero`)
				assert.ok(amounts.totalFilledRep >= repDemand, `Bid ${i} above clearing tick filled less than demanded REP`)

				const ethUsed = amounts.totalFilledRep * clearingPrice / PRICE_PRECISION
				totalEthWithdrawn += ethUsed
			}

			await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		}

		const totalEthDeposit = bids.reduce((a, b) => a + b.bidSize, 0n)
		await assertContractEmpty(client, auctionAddress)

		// Final ETH balance should match actual ETH withdrawn
		const finalBalance = await getETHBalance(client, client.account.address)
		approximatelyEqual(finalBalance, startBalance + totalEthDeposit - totalEthWithdrawn, 100n, 'final ETH balance mismatch')

		// Extra cumulative REP assertion
		assert.ok(cumulativeRep <= maxRepBeingSold, 'Cumulative REP exceeds maxRepBeingSold')
	})

	test.concurrent('multiple users bids', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
		const bids = [
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION / 4n, address: TEST_ADDRESSES[0], bidIndex: 0n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION / 4n, address: TEST_ADDRESSES[1], bidIndex: 1n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION, address: TEST_ADDRESSES[2], bidIndex: 0n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION, address: TEST_ADDRESSES[3], bidIndex: 1n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION * 4n, address: TEST_ADDRESSES[4], bidIndex: 0n },
			{ bidSize: 2n * maxRepBeingSold / 7n, priceRepEth: PRICE_PRECISION * 4n, address: TEST_ADDRESSES[5], bidIndex: 1n },
		]
		for (const bid of bids) {
			const bidClient = createWriteClient(mockWindow, bid.address, 0)
			const tick = tickForPrice(bid.priceRepEth)
			await submitBid(bidClient, auctionAddress, tick, bid.bidSize)
		}
		const clearing = await computeClearing(client, auctionAddress)
		assertClearing(clearing, true, -13864n, 71428052530837060594n)

		await finalizeAndVerify(client, auctionAddress)

		for (const bid of bids) {
			const tick = tickForPrice(bid.priceRepEth)
			const amounts = await simulateWithdrawBids(client, auctionAddress, addressString(bid.address), [{ tick: tick, bidIndex: bid.bidIndex }])
			const repDemand = bid.bidSize * PRICE_PRECISION / bid.priceRepEth
			if (tick >= clearing.foundTick) {
				// winning bid
				if (bid.bidSize == amounts.totalEthRefund) {
					assert.strictEqual(amounts.totalFilledRep, 0n, 'should be full refund')
				} else {
					const realizedPrice = amounts.totalFilledRep * PRICE_PRECISION / (bid.bidSize - amounts.totalEthRefund)
					assert.ok(realizedPrice >= bid.priceRepEth, 'got worse realized price')
					if (tick > clearing.foundTick) {
						assert.ok(repDemand <= amounts.totalFilledRep, 'got less rep back than needed')
					}
				}
			} else {
				assert.strictEqual(amounts.totalEthRefund, bid.bidSize, 'got full refund')
			}
			await withdrawBids(client, auctionAddress, addressString(bid.address), [{ tick, bidIndex: bid.bidIndex }])
		}
	})

	test.concurrent('should allow withdrawing bids below clearing price', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

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
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const alice = createTestClient(0)
		const bob = createTestClient(1)

		// Alice: bid at lower tick (cheaper) that becomes clearing tick
		const aliceTick = tickForPrice(PRICE_PRECISION * 2n)
		const aliceEth = 30n * 10n ** 18n
		const alicePriceAtTick = tickToPrice(aliceTick)
		const aliceRepDemand = aliceEth * PRICE_PRECISION / alicePriceAtTick

		// Bob: bid at higher tick (more expensive) > clearing tick
		const bobTick = tickForPrice(PRICE_PRECISION * 4n)
		const bobEth = 20n * 10n ** 18n

		await submitBidAndVerifyLock(alice, auctionAddress, aliceTick, aliceEth)
		await submitBidAndVerifyLock(bob, auctionAddress, bobTick, bobEth)

		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.priceFound, false, 'auction underfunded')

		await finalizeAndVerify(client, auctionAddress)

		// Get the actual clearing tick set after finalization (underfunded -> lowest tick)
		const clearingTick = await getClearingTick(client, auctionAddress)
		strictEqualTypeSafe(clearingTick, aliceTick, 'clearing tick should be alice tick')

		const clearingPrice = tickToPrice(clearingTick)
		const bobExpectedFilled = bobEth * PRICE_PRECISION / clearingPrice

		// Alice: at clearing tick, full fill
		const aliceAmounts = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: aliceTick, bidIndex: 0n }])
		aproximatelyEqual18Decimal(aliceAmounts.totalFilledRep, aliceRepDemand, 5n, 'Alice full rep')
		const aliceUsedEth = aliceRepDemand * clearingPrice / PRICE_PRECISION
		aproximatelyEqual18Decimal(aliceAmounts.totalEthRefund, aliceEth - aliceUsedEth, 10n, 'Alice eth refund')

		// Bob: tick > clearing, fully winning: uses all ETH to buy REP at clearing price (no refund)
		const bobAmounts = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: bobTick, bidIndex: 0n }])
		strictEqualTypeSafe(bobAmounts.totalFilledRep, bobExpectedFilled, 'Bob filled rep')
		strictEqualTypeSafe(bobAmounts.totalEthRefund, 0n, 'Bob no refund')

		// Verify total filled REP does not exceed maxRepBeingSold and matches state
		const totalFilled = aliceAmounts.totalFilledRep + bobAmounts.totalFilledRep
		strictEqualTypeSafe(totalFilled <= maxRepBeingSold, true, 'total filled rep <= maxRepBeingSold')
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

		// Withdraw first bid (index 0): should be fully filled
		const amounts1 = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 0n }])
		assertWithdrawal(amounts1, bid1Amount, 0n)

		// Withdraw second bid (index 1): partially filled, partial refund
		const amounts2 = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 1n }])
		assertWithdrawal(amounts2, 3n * 10n ** 18n, 4n * 10n ** 18n)

		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 0n }])
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 1n }])
	})

	test.concurrent('auction time limit prevents bids after expiration', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		// Advance time past auction end (AUCTION_TIME = 1 week = 604800 seconds)
		await mockWindow.advanceTime(604800n + 1n)

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

		// Withdraw remaining bids
		const clearingAmounts = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: clearingTickBid, bidIndex: 0n }])
		const winningAmounts = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: winningTick, bidIndex: 0n }])

		// Compute clearing price
		const clearingPrice = tickToPrice(clearingTick)

		// Clearing tick: partially filled; filled rep <= mediumEth * PRICE_PRECISION / clearingPrice
		const clearingMaxRep = mediumEth * PRICE_PRECISION / clearingPrice // = mediumEth since clearingPrice=1e18
		assert.ok(clearingAmounts.totalFilledRep > 0n && clearingAmounts.totalFilledRep <= clearingMaxRep, 'clearing tick partial fill')
		// Eth refund = mediumEth - (filledRep * clearingPrice / PRICE_PRECISION)
		const ethUsed = clearingAmounts.totalFilledRep * clearingPrice / PRICE_PRECISION
		assert.ok(clearingAmounts.totalEthRefund == mediumEth - ethUsed, 'clearing tick refund calculation')

		// Winning tick: fully winning, rep based on clearing price, no refund
		const winningExpectedRep = highEth * PRICE_PRECISION / clearingPrice // = highEth since clearingPrice=1e18
		approximatelyEqual(winningAmounts.totalFilledRep, winningExpectedRep, 1000n, 'winning tick full rep')
		strictEqualTypeSafe(winningAmounts.totalEthRefund, 0n, 'winning tick no refund')

		// Execute withdrawals
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: clearingTickBid, bidIndex: 0n }])
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: winningTick, bidIndex: 0n }])

		// Check contract empty
		const contractBalance = await getETHBalance(client, auctionAddress)
		approximatelyEqual(contractBalance, 0n, 1000n, 'contract should be empty after all withdrawals')
	})

	test.concurrent('winner unaffected after bidder refunds multiple losing bids', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

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

		// Finalize and verify Bob
		await finalizeAndVerify(client, auctionAddress)

		// Bob should receive exactly maxRepBeingSold and refund of bobEth - maxRep
		const bobAmounts = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: bobTick, bidIndex: 0n }])
		strictEqualTypeSafe(bobAmounts.totalFilledRep, maxRepBeingSold, 'Bob gets full maxRep')
		strictEqualTypeSafe(bobAmounts.totalEthRefund, bobEth - maxRepBeingSold, 'Bob refund')

		await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: bobTick, bidIndex: 0n }])
	})
})