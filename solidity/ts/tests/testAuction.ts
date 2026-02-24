import test, { beforeEach, describe } from 'node:test'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { PROXY_DEPLOYER_ADDRESS, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { contractExists, getETHBalance, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { Address, getCreate2Address, numberToBytes } from 'viem'
import { computeClearing, finalize, isFinalized, setOwner, startAuction, submitBid, withdrawBids } from '../testsuite/simulator/utils/contracts/auction.js'
import { strictEqualTypeSafe } from '../testsuite/simulator/utils/testUtils.js'
import { priceToClosestTick } from '../testsuite/simulator/utils/tickMath.js'
import assert from 'assert'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar.js'
import { ensureInfraDeployed, getDualCapBatchAuctionByteCode } from '../testsuite/simulator/utils/contracts/deployPeripherals.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'

describe('Auction', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient
	const PRICE_PRECISION = 1n * 10n ** 18n
	let auctionAddress: Address

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		//mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments(genesisUniverse, marketId, securityMultiplier)))
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: getDualCapBatchAuctionByteCode() })
		auctionAddress = getCreate2Address({ bytecode: getDualCapBatchAuctionByteCode(), from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) })
		assert.ok(await contractExists(client, auctionAddress), 'auction exists')
		await setOwner(client, auctionAddress, addressString(TEST_ADDRESSES[0]))
	})

	test('can start auction and make a single bid that finalizes', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const price = PRICE_PRECISION // 1:1
		const tick = priceToClosestTick(price) // 1:1
		const bidSize = ethRaiseCap
		const currentBalance = await getETHBalance(client, client.account.address)
		await submitBid(client, auctionAddress, tick, bidSize)
		const afterBidBalance = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(currentBalance - bidSize, afterBidBalance, 'we lost eth');

		[priceFound, foundTick, repAbove, ethAbove] = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(priceFound, true, 'Price was not found!')
		strictEqualTypeSafe(foundTick, tick, 'Price was not found!')
		strictEqualTypeSafe(ethAbove, ethRaiseCap, 'qty was not above')
		strictEqualTypeSafe(repAbove, maxRepBeingSold, 'funds was not above')

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did no finalize')

		const amount = await getWithdrawRepAmount(client, ethRaiseCap, maxRepBeingSold)
		strictEqualTypeSafe(amount.filledQuantity, maxRepBeingSold, 'claim amount should match total')
		strictEqualTypeSafe(amount.cost, ethRaiseCap, 'claim amount should match total')
		await withdrawRep(bidSize, price)
	})

	test('multiple bids', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
		const bids = [
			{ bidSize: ethRaiseCap / 5n, price: PRICE_PRECISION / 4n },
			{ bidSize: ethRaiseCap / 5n, price: PRICE_PRECISION / 2n },
			{ bidSize: ethRaiseCap / 5n, price: PRICE_PRECISION },
			{ bidSize: ethRaiseCap / 5n, price: PRICE_PRECISION * 2n },
			{ bidSize: ethRaiseCap / 5n, price: PRICE_PRECISION * 3n },
			{ bidSize: ethRaiseCap / 5n, price: PRICE_PRECISION * 4n },
		]
		for (const bid of bids) {
			await submitBid(client, auctionAddress, priceToClosestTick(bid.price), bid.bidSize)
		}

		[priceFound, foundTick, repAbove, ethAbove] = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(priceFound, true, 'Price was not found!')
		strictEqualTypeSafe(foundTick, tick, 'Price was not found!')
		strictEqualTypeSafe(ethAbove, ethRaiseCap, 'qty was not above')
		strictEqualTypeSafe(repAbove, maxRepBeingSold, 'funds was not above')

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did no finalize')
		for (const _bid of bids) {
			const amount = await getWithdrawRepAmount(client, [0, 1, 2, 3, 4, 5, 6])
			strictEqualTypeSafe(amount.filledQuantity, maxRepBeingSold, 'claim amount should match total')
			strictEqualTypeSafe(amount.cost, ethRaiseCap, 'claim amount should match total')
			await withdrawRep(client, [0, 1, 2, 3, 4, 5, 6])
			await withdrawEth(client, [0, 1, 2, 3, 4, 5, 6])
		}
	})
	test('multiple users bids', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
		const bids = [
			{ bidSize: 2n * ethRaiseCap / 7n, price: PRICE_PRECISION / 4n, client: createWriteClient(mockWindow, TEST_ADDRESSES[0], 0) },
			{ bidSize: 2n * ethRaiseCap / 7n, price: PRICE_PRECISION / 4n, client: createWriteClient(mockWindow, TEST_ADDRESSES[1], 0) },
			{ bidSize: 2n * ethRaiseCap / 7n, price: PRICE_PRECISION, client: createWriteClient(mockWindow, TEST_ADDRESSES[2], 0) },
			{ bidSize: 2n * ethRaiseCap / 7n, price: PRICE_PRECISION, client: createWriteClient(mockWindow, TEST_ADDRESSES[3], 0) },
			{ bidSize: 2n * ethRaiseCap / 7n, price: PRICE_PRECISION * 4n, client: createWriteClient(mockWindow, TEST_ADDRESSES[4], 0) },
			{ bidSize: 2n * ethRaiseCap / 7n, price: PRICE_PRECISION * 4n, client: createWriteClient(mockWindow, TEST_ADDRESSES[5], 0) },
		]
		for (const bid of bids) {
			await submitBid(bid.client, auctionAddress, priceToClosestTick(bid.price), bid.bidSize)
		}
		[priceFound, foundTick, repAbove, ethAbove] = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(priceFound, true, 'Price was not found!')
		strictEqualTypeSafe(foundTick, tick, 'Price was not found!')
		strictEqualTypeSafe(ethAbove, ethRaiseCap, 'qty was not above')
		strictEqualTypeSafe(repAbove, maxRepBeingSold, 'funds was not above')

		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'Did no finalize')
		for (const bid of bids) {
			const amount = await getWithdrawRepAmount(bid.client, ethRaiseCap / 5n, bid.bidSize * PRICE_PRECISION/ bid.price)
			strictEqualTypeSafe(amount.filledQuantity, maxRepBeingSold, 'claim amount should match total')
			strictEqualTypeSafe(amount.cost, ethRaiseCap, 'claim amount should match total')
			await withdrawRep(client, [0])
			await withdrawEth(client, [0])
		}
	})
	test('should allow withdrawing bids below clearing price', async () => {
		const ethRaiseCap = 200_000n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const price1 = 1n * 10n ** 18n
		const price2 = 2n * 10n ** 18n

		const alice = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bob = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		const aliceEthBefore = await getETHBalance(client, client.account.address)
		await submitBid(alice, auctionAddress, priceToClosestTick(price1), 4n * 10n ** 18n)
		await submitBid(bob, auctionAddress, priceToClosestTick(price2), 6n * 10n ** 18n)

		// clearing will happen above price1
		const [priceFound, clearingPriceTick, repAbove, ethAbove] = await computeClearing(alice, auctionAddress)
		const clearingPrice = priceToClosestTick(clearingPriceTick)
		assert.ok(clearingPrice > price1, 'clearingPrice > price1')

		// withdraw bid below clearing
		await withdrawBids(alice, auctionAddress, alice.account.address, priceToClosestTick(price1), [0])
		const aliceEthAfter = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(aliceEthBefore, aliceEthAfter, 'funds was not above')
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

		const [priceFound, clearingTick] = await computeClearing(client, auctionAddress)
		assert.ok(priceFound, 'clearing not found')

		await finalize(client, auctionAddress)

		await assert.rejects(async () => { await withdrawBids(bob, auctionAddress, bob.account.address, clearingTick, [0]) }, 'cannot withdraw binding bid')
	})

	test('should correctly handle underfunded auctions', async () => {
		const ethRaiseCap = 100n * 10n ** 18n
		const maxRepBeingSold = 100n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const price = PRICE_PRECISION
		const alice = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)

		await submitBid(alice, auctionAddress, priceToClosestTick(price), 1n * 10n ** 18n)

		await finalize(client, auctionAddress)

		const [priceFound] = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(priceFound, false, 'auction should be underfunded')
	})

	test('should handle partial fills at clearing price', async () => {
		const ethRaiseCap = 10n * 10n ** 18n
		const maxRepBeingSold = 5n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const priceLow = PRICE_PRECISION
		const priceClearing = PRICE_PRECISION * 2n
		const priceHigh = PRICE_PRECISION * 3n

		const alice = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bob = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const carol = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)

		await submitBid(alice, auctionAddress, priceToClosestTick(priceLow), 2n * 10n ** 18n)
		await submitBid(bob, auctionAddress, priceToClosestTick(priceClearing), 6n * 10n ** 18n)
		await submitBid(carol, auctionAddress, priceToClosestTick(priceClearing), 4n * 10n ** 18n)
		await submitBid(alice, auctionAddress, priceToClosestTick(priceHigh), 2n * 10n ** 18n)

		await finalize(client, auctionAddress)

		const [priceFound, clearingTick, repAbove] = await computeClearing(client, auctionAddress)
		assert.ok(priceFound, 'clearing not found')
		strictEqualTypeSafe(clearingTick, priceToClosestTick(priceClearing), 'wrong clearing price')
		assert.ok(repAbove > 0n, 'no partial fill')

		await withdrawRep(client, auctionAddress, bob.account.address, clearingTick, [0])
		await withdrawRep(client, auctionAddress, carol.account.address, clearingTick, [0])

		const aliceBalanceBefore = await getETHBalance(client, alice.account.address)
		await withdrawBids(alice, auctionAddress, alice.account.address, priceToClosestTick(priceLow), [0])
		const aliceBalanceAfter = await getETHBalance(client, alice.account.address)
		assert.ok(aliceBalanceAfter > aliceBalanceBefore, 'no refund for below clearing')

		await assert.rejects(async () => { await withdrawBids(alice, auctionAddress, alice.account.address, priceToClosestTick(priceHigh), [0]) }, 'cannot withdraw binding bid')
	})
	test('should correctly calculate ETH refund for partially filled bids', async () => {
		const ethRaiseCap = 10n * 10n ** 18n
		const maxRepBeingSold = 5n * 10n ** 18n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const priceClearing = PRICE_PRECISION * 2n
		const bob = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const carol = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)

		await submitBid(bob, auctionAddress, priceToClosestTick(priceClearing), 6n * 10n ** 18n)
		await submitBid(carol, auctionAddress, priceToClosestTick(priceClearing), 4n * 10n ** 18n)

		await finalize(client, auctionAddress)

		const bobBalanceBefore = await getETHBalance(client, bob.account.address)
		const carolBalanceBefore = await getETHBalance(client, carol.account.address)

		await withdrawRep(client, auctionAddress, bob.account.address, priceToClosestTick(priceClearing), [0])
		await withdrawRep(client, auctionAddress, carol.account.address, priceToClosestTick(priceClearing), [0])

		const bobBalanceAfter = await getETHBalance(client, bob.account.address)
		const carolBalanceAfter = await getETHBalance(client, carol.account.address)

		assert.ok(bobBalanceAfter > bobBalanceBefore, 'no refund for bob')
		assert.ok(carolBalanceAfter > carolBalanceBefore, 'no refund for carol')
	})


	test('should partially fill at clearing tick', async () => {
		const ethRaiseCap = 1000n
		const maxRepBeingSold = 100n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const bidder1 = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bidder2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await submitBid(bidder1, auctionAddress, 10n, 200n)
		await submitBid(bidder2, auctionAddress, 20n, 300n)

		await finalize(client, auctionAddress)

		const [, clearingTick] = await computeClearing(client, auctionAddress)
		strictEqualTypeSafe(clearingTick, 20n, 'wrong clearing tick')

		await withdrawRep(client, auctionAddress, bidder2.account.address, 20n, [0])
	})

	test('should allow withdrawal below clearing tick only', async () => {
		const ethRaiseCap = 1000n
		const maxRepBeingSold = 100n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const bidder1 = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bidder2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await submitBid(bidder1, auctionAddress, 10n, 200n)
		await submitBid(bidder2, auctionAddress, 20n, 300n)

		await assert.rejects(async () => { await withdrawBids(bidder2, auctionAddress, bidder2.account.address, 20n, [0]) })

		await finalize(client, auctionAddress)

		await withdrawBids(bidder1, auctionAddress, bidder1.account.address, 10n, [0])
	})

	test('should handle duplicate bids at same tick correctly', async () => {
		const ethRaiseCap = 1000n
		const maxRepBeingSold = 100n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const bidder1 = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bidder2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		const tick = 50n
		await submitBid(bidder1, auctionAddress, tick, 100n)
		await submitBid(bidder2, auctionAddress, tick, 200n)

		const bids = await getBidsAtTick(client, auctionAddress, tick)
		strictEqualTypeSafe(bids.length, 2, 'should have two bids')
		assert.ok(bids[1].cumulativeRep > bids[0].cumulativeRep, 'cumulative rep not increasing')
	})


	test('should recompute clearing correctly after withdrawal', async () => {
		const ethRaiseCap = 1000n
		const maxRepBeingSold = 100n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const bidder1 = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bidder2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const bidder3 = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)

		await submitBid(bidder1, auctionAddress, 10n, 300n)
		await submitBid(bidder2, auctionAddress, 20n, 400n)
		await submitBid(bidder3, auctionAddress, 30n, 500n)

		await withdrawBids(bidder1, auctionAddress, bidder1.account.address, 10n, [0])

		const [, newTick] = await computeClearing(client, auctionAddress)
		assert.ok(newTick >= 20n, 'clearing did not move correctly')
	})

	test('should handle extreme tick values without overflow', async () => {
		const ethRaiseCap = 10n ** 24n
		const maxRepBeingSold = 10n ** 6n
		await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

		const bidder1 = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const bidder2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await submitBid(bidder1, auctionAddress, 524288n, 1n * 10n ** 18n)
		await submitBid(bidder2, auctionAddress, -524288n, 1n * 10n ** 18n)

		await finalize(client, auctionAddress)

		const [, clearingTick] = await computeClearing(client, auctionAddress)
		assert.ok(clearingTick <= 524288n && clearingTick >= -524288n, 'tick overflow')
	})


	// add test that auction raises too much in the same tick
	// add test where auction is underfunded
	// add test where the auction is needing to buy only very tiny amounts
	// add test where rep/eth amounts are in very different scale

	/*
	// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/DualCapBatchAuction.sol";

contract DualCapBatchAuctionTest is Test {
	DualCapBatchAuction auction;

	address owner = address(1);
	address bidderA = address(2);
	address bidderB = address(3);
	address tinyLoser = address(4);

	function setUp() public {
		vm.deal(owner, 100 ether);
		vm.deal(bidderA, 100 ether);
		vm.deal(bidderB, 100 ether);
		vm.deal(tinyLoser, 100 ether);

		vm.prank(owner);
		auction = new DualCapBatchAuction();

		vm.prank(owner);
		auction.startAuction(10 ether, 10 ether);
	}

	function test_TinyLosingBidBreaksClearingEquality() public {
		// High price bid
		vm.prank(bidderA);
		auction.submitBid{ value: 8 ether }(1000);

		// Slightly lower price bid
		vm.prank(bidderB);
		auction.submitBid{ value: 2 ether }(900);

		// Now ETH cap exactly reached
		(bool priceFoundBefore, int256 foundTickBefore,,) = auction.computeClearing();
		assertTrue(priceFoundBefore);

		// Add tiny losing bid below clearing
		vm.prank(tinyLoser);
		auction.submitBid{ value: 1 wei }(800);

		// Ensure it's below clearing
		assertLt(800, foundTickBefore);

		// Now removing the tiny bid can make clearing disappear
		// because accumulated totals fall slightly below ETH cap

		vm.prank(tinyLoser);

		vm.expectRevert("clearing changed");
		auction.refundLosingBid(800, 0);
	}
}
	*/
})
