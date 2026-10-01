import { beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { tickToPrice, TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import assert from '../../testSupport/simulator/utils/assert'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { computeClearing, getClearingTick, refundLosingBids, simulateWithdrawBids, startAuction, submitBid, withdrawBids } from '../../testSupport/simulator/utils/contracts/auction'
import { approximatelyEqual, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { assertContractEmpty, getPendingEthRefund, submitBidAndVerifyLock, useAuctionFixture, withdrawPendingEthRefund } from './fixture'
import { assertExpectedClearing, assertWithdrawal, ATTOETH_PER_ETH, DEFAULT_TOLERANCE, tickForPrice } from './model'

describe('UniformPriceDualCapBatchAuction: Clearing, Withdrawals & Refunds', () => {
	const fixture = useAuctionFixture()
	const { createTestClient, finalizeAndVerify } = fixture
	let client: WriteClient
	let auctionAddress: Address

	beforeEach(() => {
		client = fixture.client
		auctionAddress = fixture.auctionAddress
	})

	describe('Clearing & Pro-Rata', () => {
		test('both caps enforced: ETH cap binds and limits REP sold', async () => {
			const attoEthRaiseCap = 50n * 10n ** 18n
			const maxAttoRepBeingSold = 100n * 10n ** 18n
			await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

			const price = 2n * 10n ** 18n
			const tick = tickForPrice(price)
			const bidAmount = 100n * 10n ** 18n

			await submitBidAndVerifyLock(client, auctionAddress, tick, bidAmount)
			const beforeFinalizeAuctionEth = await getETHBalance(client, auctionAddress)

			await finalizeAndVerify(client, auctionAddress)

			const afterFinalizeAuctionEth = await getETHBalance(client, auctionAddress)
			const clearingTick = await getClearingTick(client, auctionAddress)
			const clearingPrice = tickToPrice(clearingTick)
			approximatelyEqual(beforeFinalizeAuctionEth - afterFinalizeAuctionEth, attoEthRaiseCap, 1000n, 'Auction sent about the cap to owner')

			const clearing = await computeClearing(client, auctionAddress)
			const expectedFilledAttoRep = (clearing.accumulatedBidAttoEth * TRUTH_AUCTION_PRICE_PRECISION) / clearingPrice

			const clearing2 = await computeClearing(client, auctionAddress)
			strictEqualTypeSafe(clearing2.foundTick, tick, 'tick matches the bid')

			const amounts = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
			approximatelyEqual(amounts.totalFilledAttoRep, expectedFilledAttoRep, 1000n, 'filled rep should match ETH cap')
			approximatelyEqual(amounts.totalRefundAttoEth, afterFinalizeAuctionEth, 1000n, 'simulated refund should match remaining contract balance')

			await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
			await withdrawPendingEthRefund(client, auctionAddress)
			await assertContractEmpty(client, auctionAddress)
		})

		test('non-sequential withdrawal of same-tick bids yields correct allocation', async () => {
			const attoEthRaiseCap = 10n * 10n ** 18n
			const maxAttoRepBeingSold = 10n * 10n ** 18n

			await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

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
		type RefundTestCase = {
			name: string
			attoEthRaiseCap: bigint
			maxAttoRepBeingSold: bigint
			alicePrice: bigint
			aliceAmount: bigint
			bobPrice: bigint
			bobAmount: bigint
			refundBidder: 'alice' | 'bob'
			expectedClearingTick: bigint
			expectRefundToSucceed: boolean
			checkClearingUnchanged: boolean
		}
		const refundCases: RefundTestCase[] = [
			{
				name: 'allows refund for bid below clearing',
				attoEthRaiseCap: 10n * 10n ** 18n,
				maxAttoRepBeingSold: 10n * 10n ** 18n,
				alicePrice: ATTOETH_PER_ETH / 2n,
				aliceAmount: 10n * 10n ** 18n,
				bobPrice: ATTOETH_PER_ETH,
				bobAmount: 10n * 10n ** 18n,
				refundBidder: 'alice' as const,
				expectedClearingTick: tickForPrice(ATTOETH_PER_ETH),
				expectRefundToSucceed: true,
				checkClearingUnchanged: true,
			},
			{
				name: 'rejects refund for bid at clearing tick',
				attoEthRaiseCap: 10n * 10n ** 18n,
				maxAttoRepBeingSold: 10n * 10n ** 18n, // increase so Alice alone does not hit cap
				alicePrice: ATTOETH_PER_ETH,
				aliceAmount: 4n * 10n ** 18n, // 4 ETH at price 1 → 4 REP
				bobPrice: 2n * ATTOETH_PER_ETH,
				bobAmount: 12n * 10n ** 18n, // 12 ETH at price 2 → 6 REP, and repricing leaves Bob at the clearing tick
				refundBidder: 'bob' as const,
				expectedClearingTick: tickForPrice(2n * ATTOETH_PER_ETH),
				expectRefundToSucceed: false, // Bob is at clearing tick → cannot refund
				checkClearingUnchanged: true, // Alice refund below clearing would not change clearing
			},
			{
				name: 'rejects refund for bid above clearing',
				attoEthRaiseCap: 10n * 10n ** 18n,
				maxAttoRepBeingSold: 10n * 10n ** 18n,
				alicePrice: ATTOETH_PER_ETH,
				aliceAmount: 4n * 10n ** 18n,
				bobPrice: 2n * ATTOETH_PER_ETH,
				bobAmount: 6n * 10n ** 18n,
				refundBidder: 'bob' as const,
				expectedClearingTick: tickForPrice(ATTOETH_PER_ETH),
				expectRefundToSucceed: false,
				checkClearingUnchanged: false,
			},
		] as const

		test.each(refundCases)('refundLosingBids: $name', async (c: RefundTestCase) => {
			await startAuction(client, auctionAddress, c.attoEthRaiseCap, c.maxAttoRepBeingSold)

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
				const expectedRefund = c.refundBidder === 'alice' ? c.aliceAmount : c.bobAmount
				strictEqualTypeSafe(await getPendingEthRefund(client, auctionAddress, refundClient.account.address), expectedRefund, 'refund must be credited before withdrawal')
				await withdrawPendingEthRefund(refundClient, auctionAddress)
				const post = await getETHBalance(client, refundClient.account.address)
				approximatelyEqual(post - pre, expectedRefund, DEFAULT_TOLERANCE, 'refund amount')
			} else {
				await assert.rejects(async () => await refundLosingBids(refundClient, auctionAddress, [{ tick: refundTick, bidIndex: 0n }]), /Binding or winning bid cannot be refunded before finalization/)
			}

			if (c.checkClearingUnchanged) {
				const clearingAfter = await computeClearing(client, auctionAddress)
				strictEqualTypeSafe(clearingAfter.foundTick, c.expectedClearingTick, 'clearing tick changed after refund')
			}

			await finalizeAndVerify(client, auctionAddress)
		})
	})
})
