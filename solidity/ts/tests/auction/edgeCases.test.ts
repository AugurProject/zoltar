import { beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { tickToPrice } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import assert from '../../testSupport/simulator/utils/assert'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { computeClearing, finalize, getBidCountAtTick, getTotalRepPurchasedAttoRep, isFinalized, simulateWithdrawBids, startAuction, submitBid, withdrawBids } from '../../testSupport/simulator/utils/contracts/auction'
import { strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { assertContractEmpty, getPendingEthRefund, submitBidAndVerifyLock, useAuctionFixture, withdrawPendingEthRefund } from './fixture'
import { ATTOETH_PER_ETH, AUCTION_TIME, computeModeledClearing, LOWEST_POSITIVE_PRICE_TICK, MAX_ATTO_REP } from './model'

describe('UniformPriceDualCapBatchAuction: Edge Cases & Boundaries', () => {
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

	describe('Edge Cases & Boundary Conditions', () => {
		type EdgeCaseTest = {
			name: string
			attoEthRaiseCap: bigint
			maxAttoRepBeingSold: bigint
			bids: Array<{ tick: bigint; amount: bigint }>
		}
		const edgeCaseTests: EdgeCaseTest[] = [
			{
				name: 'single bid exactly hits attoEthRaiseCap',
				attoEthRaiseCap: 100n * 10n ** 18n,
				maxAttoRepBeingSold: 1000n * 10n ** 18n,
				bids: [{ tick: 0n, amount: 100n * 10n ** 18n }],
			},
			{
				name: 'single bid exceeds both caps (limited by ETH cap)',
				attoEthRaiseCap: 30n * 10n ** 18n,
				maxAttoRepBeingSold: 100n * 10n ** 18n,
				bids: [{ tick: 0n, amount: 100n * 10n ** 18n }],
			},
			{
				name: 'multiple bids precisely fill attoEthRaiseCap at clearing',
				attoEthRaiseCap: 100n * 10n ** 18n,
				maxAttoRepBeingSold: 1000n * 10n ** 18n,
				bids: [
					{ tick: 20000n, amount: 40n * 10n ** 18n },
					{ tick: 10000n, amount: 35n * 10n ** 18n },
					{ tick: 0n, amount: 25n * 10n ** 18n },
				],
			},
			{
				name: 'multiple bids hit REP cap at high tick',
				attoEthRaiseCap: 1000n * 10n ** 18n,
				maxAttoRepBeingSold: 100n * 10n ** 18n,
				bids: [
					{ tick: 20000n, amount: 40n * 10n ** 18n },
					{ tick: 10000n, amount: 35n * 10n ** 18n },
					{ tick: 0n, amount: 25n * 10n ** 18n },
				],
			},
			{
				name: 'bids at MIN_TICK boundary',
				attoEthRaiseCap: 100n * 10n ** 18n,
				maxAttoRepBeingSold: 1000n * 10n ** 18n,
				// Use moderately negative ticks to avoid overflow in tickToPrice
				bids: [
					{ tick: -20000n, amount: 50n * 10n ** 18n },
					{ tick: -10000n, amount: 60n * 10n ** 18n },
				],
			},
			{
				name: 'bids at MAX_TICK boundary',
				attoEthRaiseCap: 100n * 10n ** 18n,
				maxAttoRepBeingSold: 1000n * 10n ** 18n,
				// Use moderately high positive ticks to avoid overflow
				bids: [
					{ tick: 20000n, amount: 50n * 10n ** 18n },
					{ tick: 10000n, amount: 60n * 10n ** 18n },
				],
			},
			{
				name: 'underfunded auction',
				attoEthRaiseCap: 1000n * 10n ** 18n,
				maxAttoRepBeingSold: 1000n * 10n ** 18n,
				bids: [{ tick: 0n, amount: 1n * 10n ** 18n }],
			},
			{
				name: 'many small bids',
				attoEthRaiseCap: 10n * 10n ** 18n,
				maxAttoRepBeingSold: 10n * 10n ** 18n,
				bids: Array.from({ length: 10 }, () => ({ tick: 0n, amount: 1n * 10n ** 18n })),
			},
		] as const

		test.each(edgeCaseTests)('covers various edge cases: $name', async (c: EdgeCaseTest) => {
			await startAuction(client, auctionAddress, c.attoEthRaiseCap, c.maxAttoRepBeingSold)

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

			const expected = computeModeledClearing(c.bids, c.maxAttoRepBeingSold, c.attoEthRaiseCap)
			const clearing = await computeClearing(client, auctionAddress)

			assert.strictEqual(clearing.hitCap, expected.hitCap, `${c.name}: hitCap mismatch`)
			if (expected.hitCap) {
				strictEqualTypeSafe(clearing.foundTick, expected.foundTick, `${c.name}: foundTick mismatch`)
				strictEqualTypeSafe(clearing.accumulatedBidAttoEth, expected.accumulatedBidAttoEth, `${c.name}: accumulatedBidAttoEth mismatch`)
				await mockWindow.advanceTime(AUCTION_TIME + 1n)
				await finalize(client, auctionAddress)
				await assertFairPayoutForUser(client, auctionAddress, client.account.address, fairPayoutBids, clearing.foundTick)
			} else {
				assert.strictEqual(clearing.hitCap, false, `${c.name}: expected no clearing price`)
				// Finalize and settle every bid. Below-reserve bids remain fully refundable.
				await mockWindow.advanceTime(AUCTION_TIME + 1n)
				await finalize(client, auctionAddress)
				for (const bid of fairPayoutBids) {
					await withdrawBids(client, auctionAddress, client.account.address, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
				}
				await withdrawPendingEthRefund(client, auctionAddress)
			}

			await assertContractEmpty(client, auctionAddress)
		})
	})

	describe('Withdrawals after finalization require owner', () => {
		test('losing bidder cannot withdraw after finalization - only owner can call withdrawBids', async () => {
			// Setup auction with enough capacity
			const attoEthRaiseCap = 10n * 10n ** 18n
			const maxAttoRepBeingSold = 10n * 10n ** 18n
			await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

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
			const winningAttoEth = 1n * 10n ** 18n
			await submitBid(bob, auctionAddress, winningTick, winningAttoEth)

			// Verify clearing tick is above losing tick
			const clearingPre = await computeClearing(client, auctionAddress)
			assert.ok(clearingPre.hitCap)
			strictEqualTypeSafe(clearingPre.foundTick, clearingTick, 'clearing tick should be 0')
			strictEqualTypeSafe(clearingPre.foundTick > losingTick, true)

			// Finalize
			await mockWindow.advanceTime(AUCTION_TIME + 1n)
			await finalize(client, auctionAddress)
			strictEqualTypeSafe(await isFinalized(client, auctionAddress), true)

			// 1) Non-owner (alice) cannot withdraw her losing bid -> revert with "Only owner can call"
			await assert.rejects(async () => await withdrawBids(alice, auctionAddress, alice.account.address, [{ tick: losingTick, bidIndex: 0n }]), /Only the auction owner can withdraw bids on behalf of bidders/)

			// 2) Non-owner (bob) cannot withdraw his winning bid -> also revert
			await assert.rejects(async () => await withdrawBids(bob, auctionAddress, bob.account.address, [{ tick: winningTick, bidIndex: 0n }]), /Only the auction owner can withdraw bids on behalf of bidders/)

			// 3) Owner withdraws for alice (losing) -> full ETH refund
			const aliceBalanceBefore = await getETHBalance(client, alice.account.address)
			await withdrawBids(client, auctionAddress, alice.account.address, [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingEthRefund(client, auctionAddress, alice.account.address), losingEth, 'owner settlement should credit Alice')
			await withdrawPendingEthRefund(alice, auctionAddress)
			const aliceBalanceAfter = await getETHBalance(client, alice.account.address)
			strictEqualTypeSafe(aliceBalanceAfter - aliceBalanceBefore, losingEth, 'Alice should get full ETH refund')

			// 4) Owner withdraws for bob (winning) -> no ETH refund, simulate confirms
			const bobAmounts = await simulateWithdrawBids(client, auctionAddress, bob.account.address, [{ tick: winningTick, bidIndex: 0n }])
			strictEqualTypeSafe(bobAmounts.totalRefundAttoEth, 0n, 'Bob should get no ETH refund (winning bid)')
			await withdrawBids(client, auctionAddress, bob.account.address, [{ tick: winningTick, bidIndex: 0n }])

			// 5) Owner withdraws own clearing bid (optional for completeness)
			await withdrawBids(client, auctionAddress, client.account.address, [{ tick: clearingTick, bidIndex: 0n }])
		})
	})

	describe('Zero-price bid boundary', () => {
		test('underfunded auction rejects a zero-price bid and refunds a lowest-positive bid below reserve', async () => {
			const attoEthRaiseCap = 1000n * ATTOETH_PER_ETH
			const maxAttoRepBeingSold = MAX_ATTO_REP
			await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)
			const zeroPriceTick = LOWEST_POSITIVE_PRICE_TICK - 1n
			const lowPositiveTick = LOWEST_POSITIVE_PRICE_TICK
			const bidAmount = 1n * ATTOETH_PER_ETH

			assert.strictEqual(tickToPrice(zeroPriceTick), 0n, 'test setup should use a zero-price tick')
			await assert.rejects(async () => await submitBid(client, auctionAddress, zeroPriceTick, bidAmount), /Auction tick price rounds down to zero/)
			await submitBidAndVerifyLock(client, auctionAddress, lowPositiveTick, bidAmount)
			strictEqualTypeSafe(await getBidCountAtTick(client, auctionAddress, zeroPriceTick), 0n, 'rejected zero-price bid count')
			strictEqualTypeSafe(await getBidCountAtTick(client, auctionAddress, lowPositiveTick), 1n, 'lowest positive-price bid count')

			const clearing = await computeClearing(client, auctionAddress)
			assert.strictEqual(clearing.hitCap, false, 'lowest positive-price bid should leave this setup underfunded')

			await finalizeAndVerify(client, auctionAddress)
			const expectedRepPurchased = 0n
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, auctionAddress), expectedRepPurchased, 'lowest positive-price demand below reserve should not purchase REP')
			const amounts = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick: lowPositiveTick, bidIndex: 0n }])
			assert.strictEqual(amounts.totalFilledAttoRep, expectedRepPurchased, 'lowest positive-price bidder should receive no REP below reserve')
			assert.strictEqual(amounts.totalRefundAttoEth, bidAmount, 'lowest positive-price bidder should receive a full refund below reserve')
			await withdrawBids(client, auctionAddress, client.account.address, [{ tick: lowPositiveTick, bidIndex: 0n }])
			await withdrawPendingEthRefund(client, auctionAddress)
			await assertContractEmpty(client, auctionAddress)
		})
	})
})
