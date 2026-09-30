import { beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { tickToPrice, TRUTH_AUCTION_MAX_TICK, TRUTH_AUCTION_MIN_TICK, TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { deployUniformPriceDualCapBatchAuction, finalize, getBidCountAtTick, getMinBidSizeAttoEth, getTickCount, isFinalized, startAuction, submitBid, withdrawBids } from '../../testSupport/simulator/utils/contracts/auction'
import { getUniformPriceDualCapBatchAuctionAddress } from '../../testSupport/simulator/utils/contracts/deployments'
import { strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { assertContractEmpty, setupStandardAuction, useAuctionFixture } from './fixture'
import { ATTOETH_PER_ETH, AUCTION_TIME, LOWEST_POSITIVE_PRICE_TICK, tickForPrice } from './model'

describe('UniformPriceDualCapBatchAuction: Bid Submission', () => {
	const fixture = useAuctionFixture()
	const { decodeAuctionEvents, finalizeAndVerify } = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let auctionAddress: Address

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		auctionAddress = fixture.auctionAddress
	})

	test('BidSubmitted exposes stable same-tick indices and cumulative ETH', async () => {
		await setupStandardAuction(client, auctionAddress)
		const sameTick = 0n
		const firstAmount = 2n * ATTOETH_PER_ETH
		const secondAmount = 3n * ATTOETH_PER_ETH

		const firstHash = await submitBid(client, auctionAddress, sameTick, firstAmount)
		const secondHash = await submitBid(client, auctionAddress, sameTick, secondAmount)
		const firstLog = (await decodeAuctionEvents(firstHash)).find(log => log.eventName === 'BidSubmitted')
		const secondLog = (await decodeAuctionEvents(secondHash)).find(log => log.eventName === 'BidSubmitted')
		if (firstLog === undefined || secondLog === undefined) throw new Error('missing BidSubmitted log')

		assert.strictEqual(firstLog.args.bidder, client.account.address)
		assert.strictEqual(firstLog.args.tick, sameTick)
		assert.strictEqual(firstLog.args.bidIndex, 0n)
		assert.strictEqual(firstLog.args.bidAmountAttoEth, firstAmount)
		assert.strictEqual(firstLog.args.cumulativeBidAtTickAttoEth, firstAmount)
		assert.strictEqual(secondLog.args.bidIndex, 1n)
		assert.strictEqual(secondLog.args.cumulativeBidAtTickAttoEth, firstAmount + secondAmount)
	})

	test('BidSettled expands same-tick FIFO settlement per bid', async () => {
		const sameTick = 0n
		const bidAmount = 7n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, 10n * ATTOETH_PER_ETH, 10n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, sameTick, bidAmount)
		await submitBid(client, auctionAddress, sameTick, bidAmount)
		await finalizeAndVerify(client, auctionAddress)

		const withdrawalHash = await withdrawBids(client, auctionAddress, client.account.address, [
			{ tick: sameTick, bidIndex: 0n },
			{ tick: sameTick, bidIndex: 1n },
		])
		const settlementLogs = (await decodeAuctionEvents(withdrawalHash)).filter(log => log.eventName === 'BidSettled')
		assert.strictEqual(settlementLogs.length, 2)
		const firstSettlement = settlementLogs[0]
		const secondSettlement = settlementLogs[1]
		if (firstSettlement?.eventName !== 'BidSettled' || secondSettlement?.eventName !== 'BidSettled') {
			throw new Error('missing per-bid settlement log')
		}
		assert.strictEqual(firstSettlement.args.bidIndex, 0n)
		assert.strictEqual(firstSettlement.args.bidUsedAttoEth, bidAmount)
		assert.strictEqual(firstSettlement.args.attoRepFilled, bidAmount)
		assert.strictEqual(firstSettlement.args.refundAttoEth, 0n)
		assert.strictEqual(firstSettlement.args.status, 0n)
		assert.strictEqual(secondSettlement.args.bidIndex, 1n)
		assert.strictEqual(secondSettlement.args.bidUsedAttoEth, 3n * ATTOETH_PER_ETH)
		assert.strictEqual(secondSettlement.args.attoRepFilled, 3n * ATTOETH_PER_ETH)
		assert.strictEqual(secondSettlement.args.refundAttoEth, 4n * ATTOETH_PER_ETH)
		assert.strictEqual(secondSettlement.args.status, 1n)
	})

	test('minimum bid size enforcement', async () => {
		const attoEthRaiseCap = 50000n
		const maxAttoRepBeingSold = 1n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		const minBid = await getMinBidSizeAttoEth(client, auctionAddress)
		strictEqualTypeSafe(minBid, 1n, 'minBidSizeAttoEth should be 1')

		await assert.rejects(async () => await submitBid(client, auctionAddress, 0n, 0n), /Auction bid is smaller than the minimum bid size/)

		await submitBid(client, auctionAddress, 0n, 1n)
	})

	test('submitBid accepts the lowest positive-price tick and maximum tick', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 10n * 10n ** 18n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		assert.strictEqual(tickToPrice(LOWEST_POSITIVE_PRICE_TICK - 1n), 0n, 'test setup should sit just above the zero-price boundary')
		assert.strictEqual(tickToPrice(LOWEST_POSITIVE_PRICE_TICK), 1n, 'test setup should use the lowest positive-price tick')

		await submitBid(client, auctionAddress, LOWEST_POSITIVE_PRICE_TICK, 1n * 10n ** 18n)
		await submitBid(client, auctionAddress, TRUTH_AUCTION_MAX_TICK, 1n * 10n ** 18n)

		strictEqualTypeSafe(await getBidCountAtTick(client, auctionAddress, LOWEST_POSITIVE_PRICE_TICK), 1n, 'lowest positive-price tick bid count')
		strictEqualTypeSafe(await getBidCountAtTick(client, auctionAddress, TRUTH_AUCTION_MAX_TICK), 1n, 'maximum tick bid count')
	})

	test('submitBid rejects ticks outside the supported range without locking ETH', async () => {
		await setupStandardAuction(client, auctionAddress)
		const minBid = await getMinBidSizeAttoEth(client, auctionAddress)

		await assert.rejects(async () => await submitBid(client, auctionAddress, TRUTH_AUCTION_MAX_TICK + 1n, minBid), /Auction tick is outside the supported price range/)
		await assert.rejects(async () => await submitBid(client, auctionAddress, TRUTH_AUCTION_MIN_TICK - 1n, minBid), /Auction tick is outside the supported price range/)

		assert.strictEqual(await getETHBalance(client, auctionAddress), 0n, 'rejected out-of-range bids must not lock ETH')
		assert.strictEqual(await getTickCount(client, auctionAddress), 0n, 'rejected out-of-range bids must not create tick history')
	})

	test('submitBid rejects zero-price ticks', async () => {
		const attoEthRaiseCap = 1000n * ATTOETH_PER_ETH
		const maxAttoRepBeingSold = 1n
		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)
		const zeroPriceTick = LOWEST_POSITIVE_PRICE_TICK - 1n
		const bidAmount = 1n * ATTOETH_PER_ETH

		assert.strictEqual(tickToPrice(zeroPriceTick), 0n, 'test setup should use a zero-price tick')
		await assert.rejects(async () => await submitBid(client, auctionAddress, zeroPriceTick, bidAmount), /Auction tick price rounds down to zero/)
		await assert.rejects(async () => await submitBid(client, auctionAddress, TRUTH_AUCTION_MIN_TICK, bidAmount), /Auction tick price rounds down to zero/)
		await assertContractEmpty(client, auctionAddress)
	})

	test('submitBid invalid states: before auction start and after finalize', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 10n * 10n ** 18n
		const tick = tickForPrice(TRUTH_AUCTION_PRICE_PRECISION)
		const bidAmount = 1n * 10n ** 18n

		const freshAddress = getUniformPriceDualCapBatchAuctionAddress(addressString(TEST_ADDRESSES[3]))
		await deployUniformPriceDualCapBatchAuction(client, addressString(TEST_ADDRESSES[3]))
		await assert.rejects(async () => await submitBid(client, freshAddress, tick, bidAmount), /Auction must be started before accepting bids/)

		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)
		await submitBid(client, auctionAddress, tick, attoEthRaiseCap)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'auction should be finalized before post-finalization assertions')

		await assert.rejects(async () => await submitBid(client, auctionAddress, tick, bidAmount), /Auction has already been finalized/)
	})

	test('withdrawBids reverts before finalize', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 10n * 10n ** 18n
		const tick = tickForPrice(TRUTH_AUCTION_PRICE_PRECISION)

		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)
		await submitBid(client, auctionAddress, tick, 1n * 10n ** 18n)

		await assert.rejects(async () => await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }]), /Auction must be finalized before withdrawing bids/)
	})
})
