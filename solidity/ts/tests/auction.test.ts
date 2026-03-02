import { test, beforeEach, describe } from 'bun:test'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { contractExists, getETHBalance, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { Address } from 'viem'
import { computeClearing, deployDualCapBatchAuction, finalize, getClearingTick, getMinBidSize, getWithdrawRepAndEthAmount, isFinalized, refundLosingBids, startAuction, submitBid, withdrawBids } from '../testsuite/simulator/utils/contracts/auction.js'
import { approximatelyEqual, strictEqual18Decimal, strictEqualTypeSafe } from '../testsuite/simulator/utils/testUtils.js'
import { priceToClosestTick, tickToPrice } from '../testsuite/simulator/utils/tickMath.js'
import assert from 'assert'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar.js'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals.js'
import { getDeployments, getDualCapBatchAuctionAddress } from '../testsuite/simulator/utils/contracts/deployments.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { SimulationState } from '../testsuite/simulator/types/visualizerTypes.js'
import { copySimulationState } from '../testsuite/simulator/SimulationModeEthereumClientService.js'

describe('Auction', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient
	const PRICE_PRECISION = 1n * 10n ** 18n
	let auctionAddress: Address

	// Cache for simulation state to speed up test runs
	let cachedSimulationState: SimulationState | undefined = undefined

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
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments()))
		auctionAddress = getDualCapBatchAuctionAddress(client.account.address)
		assert.ok(await contractExists(client, auctionAddress), 'auction exists')
	})

	test('can start auction and make a single bid that finalizes', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const price = PRICE_PRECISION // 1:1
		const tick = priceToClosestTick(price) // 1:1
		const bidSize = maxRepBeingSold
		const startBalance = await getETHBalance(client, client.account.address)
		await submitBid(client, auctionAddress, tick, bidSize)
		const afterBidBalance = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(startBalance - bidSize, afterBidBalance, 'we lost eth')

		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.priceFound, true, 'Price was not found!')
		strictEqualTypeSafe(clearing.foundTick, tick, 'Tick was incorrect!')
		strictEqualTypeSafe(clearing.repAbove, 0n, 'repAbove was wrong')

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')
		const withdrawAmounts = await getWithdrawRepAndEthAmount(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		strictEqualTypeSafe(withdrawAmounts.totalFilledRep, maxRepBeingSold, 'rep should match total')
		strictEqualTypeSafe(withdrawAmounts.totalEthRefund, 0n, 'no refund')
		await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		const weShouldHaveAllTheEthAgain = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(startBalance, weShouldHaveAllTheEthAgain, 'we did not get eth back')
	})

	test('multiple bids', async () => {
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

		// Submit bids
		for (const bid of bids) {
			await submitBid(client, auctionAddress, priceToClosestTick(bid.priceRepEth), bid.bidSize)
		}

		// Compute clearing
		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.priceFound, true, 'Price was not found!')

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')

		const clearingPrice = tickToPrice(clearing.foundTick)

		// Assert clearing tick is within allowed range
		assert.ok(clearing.foundTick >= -524_288, 'Clearing tick below MIN_TICK')
		assert.ok(clearing.foundTick <= 524_288, 'Clearing tick above MAX_TICK')

		// Track cumulative REP and total ETH withdrawn
		let cumulativeRep = 0n
		let totalEthWithdrawn = 0n

		for (let i = 0; i < bids.length; i++) {
			const bid = bids[i]
			const tick = priceToClosestTick(bid.priceRepEth)

			// Check amounts from contract
			const amounts = await getWithdrawRepAndEthAmount(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
			const repDemand = bid.bidSize * PRICE_PRECISION / bid.priceRepEth

			if (tick < clearing.foundTick) {
				// losing bid: full refund, no REP
				assert.strictEqual(amounts.totalFilledRep, 0n, `Bid ${i} below clearing tick got REP`)
				assert.strictEqual(amounts.totalEthRefund, bid.bidSize, `Bid ${i} below clearing tick refund mismatch`)
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

			// Withdraw bid to trigger ETH transfer
			await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		}
		const totalEthDeposit = bids.reduce((a,b) => a + b.bidSize, 0n)
		const contractBalance = await getETHBalance(client, auctionAddress)
		strictEqual18Decimal(contractBalance, 0n, 'auction should be empty by now')
		// Final ETH balance should match actual ETH withdrawn
		const finalBalance = await getETHBalance(client, client.account.address)
		approximatelyEqual(finalBalance, startBalance + totalEthDeposit - totalEthWithdrawn, 100n, 'final ETH balance mismatch')

		// Extra cumulative REP assertion
		assert.ok(cumulativeRep <= maxRepBeingSold, 'Cumulative REP exceeds maxRepBeingSold')
	})

	test('multiple users bids', async () => {
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
			await submitBid(createWriteClient(mockWindow, bid.address, 0), auctionAddress, priceToClosestTick(bid.priceRepEth), bid.bidSize)
		}
		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.priceFound, true, 'Price was not found!')
		strictEqualTypeSafe(clearing.foundTick, -13864n, 'Tick was correct!')
		strictEqualTypeSafe(clearing.repAbove, 71428052530837060594n, 'repAbove was wrong ')

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')
		for (const bid of bids) {
			const tick = priceToClosestTick(bid.priceRepEth)
			const amounts = await getWithdrawRepAndEthAmount(client, auctionAddress, addressString(bid.address), [{ tick: tick, bidIndex: bid.bidIndex }])
			const repDemand = bid.bidSize * PRICE_PRECISION / bid.priceRepEth
			if (tick >= clearing.foundTick) {
				// winning bid
				if (bid.bidSize == amounts.totalEthRefund) {
					assert.equal(amounts.totalFilledRep, 0n, 'should be full refund')
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

	test('should allow withdrawing bids below clearing price', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const price1Tick = priceToClosestTick(1n * 10n ** 18n / 2n)
		const price2Tick = priceToClosestTick(1n * 10n ** 18n)

		const alice = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bob = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		const aliceEthBefore = await getETHBalance(client, client.account.address)
		await submitBid(alice, auctionAddress, price1Tick, ethRaiseCap)
		await submitBid(bob, auctionAddress, price2Tick, ethRaiseCap)

		// clearing will happen above price1
		const clearing = await computeClearing(alice, auctionAddress)
		assert.ok(clearing.foundTick > price1Tick, 'clearingPrice > price1')

		// refund bid below clearing
		assert.ok(aliceEthBefore !== await getETHBalance(client, client.account.address), 'alice should not have original eth amount here')
		await refundLosingBids(alice, auctionAddress, [{ tick: price1Tick, bidIndex: 0n }])
		const aliceEthAfter = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(aliceEthBefore, aliceEthAfter, 'did not get our eth back')
		const clearing2 = await computeClearing(alice, auctionAddress)
		assert.strictEqual(clearing2.foundTick, clearing.foundTick, 'foundTick does not match')
		assert.strictEqual(clearing2.priceFound, clearing.priceFound, 'priceFound does not match')
		assert.strictEqual(clearing2.repAbove, clearing.repAbove, 'repAbove does not match')

		await finalize(client, auctionAddress)
		const amounts = await getWithdrawRepAndEthAmount(client, auctionAddress, bob.account.address, [{ tick: price2Tick, bidIndex: 0n }])
		strictEqualTypeSafe(amounts.totalEthRefund, ethRaiseCap - maxRepBeingSold * PRICE_PRECISION / tickToPrice(clearing.foundTick), 'eth match') //1:1 price
		strictEqualTypeSafe(amounts.totalFilledRep, maxRepBeingSold, 'rep match')
		await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: price2Tick, bidIndex: 0n }])
	})

	test('should not allow withdrawing bids at or above clearing price', async () => {
		const ethRaiseCap = 10n * 10n ** 18n
		const maxRepBeingSold = 5n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const priceLow = PRICE_PRECISION
		const priceHigh = PRICE_PRECISION * 2n

		const alice = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bob = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await submitBid(alice, auctionAddress, priceToClosestTick(priceLow), 4n * 10n ** 18n)
		await submitBid(bob, auctionAddress, priceToClosestTick(priceHigh), 6n * 10n ** 18n)

		const clearing = await computeClearing(client, auctionAddress)
		assert.ok(clearing.priceFound, 'clearing not found')
		await assert.rejects(async () => { await refundLosingBids(bob, auctionAddress, [{ tick: priceToClosestTick(priceHigh), bidIndex: 0n }]) }, 'cannot withdraw binding bid')
	})

	test('should correctly handle underfunded auctions', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const price = PRICE_PRECISION
		const alice = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)

		await submitBid(alice, auctionAddress, priceToClosestTick(price), 1n * 10n ** 18n)

		await finalize(client, auctionAddress)

		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.priceFound, false, 'auction should be underfunded')
	})

	test('winning bids receive exactly their requested repAmount with correct eth refund', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const alice = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bob = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		// Alice: bid at lower tick (cheaper) that becomes clearing tick
		const aliceTick = priceToClosestTick(PRICE_PRECISION * 2n)
		const aliceEth = 30n * 10n ** 18n
		const alicePriceAtTick = tickToPrice(aliceTick)
		const aliceRepDemand = aliceEth * PRICE_PRECISION / alicePriceAtTick

		// Bob: bid at higher tick (more expensive) > clearing tick
		const bobTick = priceToClosestTick(PRICE_PRECISION * 4n)
		const bobEth = 20n * 10n ** 18n

		await submitBid(alice, auctionAddress, aliceTick, aliceEth)
		await submitBid(bob, auctionAddress, bobTick, bobEth)

		const clearing = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearing.priceFound, false, 'auction underfunded')

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')

		// Get the actual clearing tick set after finalization (underfunded -> lowest tick)
		const clearingTick = await getClearingTick(client, auctionAddress)
		strictEqualTypeSafe(clearingTick, aliceTick, 'clearing tick should be alice tick')

		const clearingPrice = tickToPrice(clearingTick)
		const bobExpectedFilled = bobEth * PRICE_PRECISION / clearingPrice

		// Alice: at clearing tick, full fill
		const aliceAmounts = await getWithdrawRepAndEthAmount(client, auctionAddress, alice.account.address, [{ tick: aliceTick, bidIndex: 0n }])
		strictEqualTypeSafe(aliceAmounts.totalFilledRep, aliceRepDemand, 'Alice full rep')
		const aliceUsedEth = aliceRepDemand * clearingPrice / PRICE_PRECISION
		strictEqualTypeSafe(aliceAmounts.totalEthRefund, aliceEth - aliceUsedEth, 'Alice eth refund')

		// Bob: tick > clearing, fully winning: uses all ETH to buy REP at clearing price (no refund)
		const bobAmounts = await getWithdrawRepAndEthAmount(client, auctionAddress, bob.account.address, [{ tick: bobTick, bidIndex: 0n }])
		strictEqualTypeSafe(bobAmounts.totalFilledRep, bobExpectedFilled, 'Bob filled rep')
		strictEqualTypeSafe(bobAmounts.totalEthRefund, 0n, 'Bob no refund')

		// Verify total filled REP does not exceed maxRepBeingSold and matches state
		const totalFilled = aliceAmounts.totalFilledRep + bobAmounts.totalFilledRep
		strictEqualTypeSafe(totalFilled <= maxRepBeingSold, true, 'total filled rep <= maxRepBeingSold')
	})

	test('multiple bids at same tick from same bidder (FIFO pro-rata)', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n
		const alice = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)

		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		// Same tick (0 = price 1:1)
		const sameTick = 0n
		const bid1Amount = 7n * 10n ** 18n
		const bid2Amount = 7n * 10n ** 18n

		await submitBid(alice, auctionAddress, sameTick, bid1Amount)
		await submitBid(alice, auctionAddress, sameTick, bid2Amount)

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')

		// Withdraw first bid (index 0): should be fully filled
		const amounts1 = await getWithdrawRepAndEthAmount(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 0n }])
		strictEqualTypeSafe(amounts1.totalFilledRep, bid1Amount, 'first bid full rep')
		strictEqualTypeSafe(amounts1.totalEthRefund, 0n, 'first bid no refund')

		// Withdraw second bid (index 1): partially filled, partial refund
		const amounts2 = await getWithdrawRepAndEthAmount(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 1n }])
		strictEqualTypeSafe(amounts2.totalFilledRep, 3n * 10n ** 18n, 'second bid partial rep')
		strictEqualTypeSafe(amounts2.totalEthRefund, 4n * 10n ** 18n, 'second bid partial refund')

		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 0n }])
		await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 1n }])
	})

	test('auction time limit prevents bids after expiration', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 10n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		// Advance time past auction end (AUCTION_TIME = 1 week = 604800 seconds)
		await mockWindow.advanceTime(604800n + 1n)

		// Attempting to submit a bid should fail with "Auction ended"
		const tick = priceToClosestTick(PRICE_PRECISION)
		const bidAmount = 1n * 10n ** 18n
		await assert.rejects(
			async () => await submitBid(client, auctionAddress, tick, bidAmount),
			'Auction ended'
		)
	})

	test('minimum bid size enforcement', async () => {
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

	test('both caps enforced: ETH cap binds and limits REP sold', async () => {
		const ethRaiseCap = 50n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		// Price = 2 ETH/REP => tick around that
		const price = 2n * 10n ** 18n
		const tick = priceToClosestTick(price)
		const bidAmount = 100n * 10n ** 18n

		await submitBid(client, auctionAddress, tick, bidAmount)

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did not finalize')

		// Get the actual clearing tick and price
		const clearingTick = await getClearingTick(client, auctionAddress)
		const clearingPrice = tickToPrice(clearingTick)

		// Compute expected filled REP based on actual clearing price: ethRaiseCap * PRICE_PRECISION / clearingPrice
		const expectedFilledRep = ethRaiseCap * PRICE_PRECISION / clearingPrice

		// Withdraw should give filledRep = expectedFilledRep, refund = ethRaiseCap
		const amounts = await getWithdrawRepAndEthAmount(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		strictEqualTypeSafe(amounts.totalFilledRep, expectedFilledRep, 'filled rep should match ETH cap')
		strictEqualTypeSafe(amounts.totalEthRefund, ethRaiseCap, 'total eth refund should equal ethRaiseCap')

		await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
	})
})
