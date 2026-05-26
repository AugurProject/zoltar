import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { contractExists, getETHBalance, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { encodeAbiParameters, keccak256, type Address } from 'viem'
import {
	computeClearing,
	deployUniformPriceDualCapBatchAuction,
	finalize,
	activeTickCount,
	getActiveTickPage,
	getBidCountAtTick,
	getBidPageAtTick,
	getBidderBidCount,
	getBidderBidPage,
	getClearingTick,
	getMinBidSize,
	getTickCount,
	getTickSummary,
	getTickPage,
	getTotalRepPurchased,
	simulateWithdrawBids,
	isFinalized,
	refundLosingBids,
	startAuction,
	submitBid,
	withdrawBids,
	getEthRaiseCap,
	getEthRaised,
} from '../testsuite/simulator/utils/contracts/auction'
import { approximatelyEqual, ensureDefined, strictEqual18Decimal, strictEqualTypeSafe } from '../testsuite/simulator/utils/testUtils'
import { priceToClosestTick, tickToPrice } from '../testsuite/simulator/utils/tickMath'
import assert from 'assert'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { getUniformPriceDualCapBatchAuctionAddress } from '../testsuite/simulator/utils/contracts/deployments'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../types/contractArtifact'

// ============ MODULE-LEVEL CONSTANTS ============
const ATTOETH_PER_ETH = 10n ** 18n
const PRICE_PRECISION = ATTOETH_PER_ETH
const AUCTION_TIME = 604800n
const MIN_TICK = -524288n
const MAX_TICK = 524288n
const DEFAULT_TOLERANCE = 1000n

const DEFAULT_ETH_RAISE_CAP = 200_000n
const DEFAULT_MAX_REP = 100n
const AUCTION_NODES_SLOT = 0n
const AUCTION_BIDS_AT_TICK_SLOT = 1n
const AUCTION_REFUNDED_BID_PREFIX_TREE_SLOT = 2n
const AUCTION_ROOT_SLOT = 3n
const AUCTION_NEXT_ID_SLOT = 4n
const AUCTION_MAX_REP_BEING_SOLD_SLOT = 5n
const AUCTION_ETH_RAISE_CAP_SLOT = 6n
const BID_STRUCT_SLOT_COUNT = 4n
const NODE_STRUCT_SLOT_COUNT = 8n
const MAX_DISTINCT_TICK_COUNT = 1_048_577n
const FINALIZE_GAS_LIMIT = 20_000_000n

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Auction', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let auctionAddress: Address

	// ============ Helper Functions ============

	function createTestClient(idx: number): WriteClient {
		const address = ensureDefined(TEST_ADDRESSES[idx], `TEST_ADDRESSES[${idx}] is undefined`)
		return createWriteClient(mockWindow, address, 0)
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

	function assertClearing(clearing: { hitCap: boolean; foundTick: bigint; accumulatedEth: bigint }, expectedHitCap: boolean, expectedTick?: bigint, expectedAccumulatedEth?: bigint) {
		strictEqualTypeSafe(clearing.hitCap, expectedHitCap, 'clearing.hitCap mismatch')
		if (expectedHitCap && expectedTick !== undefined) strictEqualTypeSafe(clearing.foundTick, expectedTick, 'clearing.foundTick mismatch')
		if (expectedAccumulatedEth !== undefined) strictEqualTypeSafe(clearing.accumulatedEth, expectedAccumulatedEth, 'clearing.accumulatedEth mismatch')
	}

	function assertExpectedClearing(clearing: { hitCap: boolean; foundTick: bigint; accumulatedEth: bigint }, expectedTick: bigint, expectedAccumulatedEth?: bigint): void {
		assertClearing(clearing, true)
		if (clearing.hitCap) strictEqualTypeSafe(clearing.foundTick, expectedTick, 'clearing tick mismatch')
		if (expectedAccumulatedEth !== undefined) strictEqualTypeSafe(clearing.accumulatedEth, expectedAccumulatedEth, 'accumulatedEth mismatch')
	}

	async function finalizeAndVerify(client: WriteClient, auctionAddress: Address): Promise<void> {
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
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
		await startAuction(client, auctionAddress, ethRaiseCapEth * ATTOETH_PER_ETH, maxRepBeingSold * ATTOETH_PER_ETH)
	}

	async function assertFairPayoutForUser(auctionCreator: WriteClient, auctionAddress: Address, userId: Address, bids: { tick: bigint; bidSize: bigint; bidIndex: bigint }[], clearingTick: bigint, tolerance: bigint = DEFAULT_TOLERANCE): Promise<{ totalFilledRep: bigint; totalEthRefund: bigint }> {
		const clearingPrice = tickToPrice(clearingTick)
		let totalFilledRep = 0n
		let totalEthRefund = 0n

		for (const bid of bids) {
			const amounts = await simulateWithdrawBids(auctionCreator, auctionAddress, userId, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
			const bidPrice = tickToPrice(bid.tick)
			let minRepBackOnFullBuy: bigint
			if (bidPrice === 0n) {
				// Zero price means no REP can be bought; expect 0 filled REP
				minRepBackOnFullBuy = 0n
			} else {
				minRepBackOnFullBuy = (bid.bidSize * ATTOETH_PER_ETH) / bidPrice
			}

			if (bid.tick < clearingTick) {
				// Losing bid: full refund, no REP
				assert.strictEqual(amounts.totalFilledRep, 0n, `Bid ${bid.bidIndex} (losing): should get 0 REP`)
				approximatelyEqual(amounts.totalEthRefund, bid.bidSize, tolerance, `Bid ${bid.bidIndex} (losing): full ETH refund`)
				totalEthRefund += amounts.totalEthRefund
			} else if (bid.tick === clearingTick) {
				// At-clearing: partial fill, partial refund
				if (amounts.totalEthRefund !== bid.bidSize) assert.ok(amounts.totalFilledRep > 0n, `Bid ${bid.bidIndex} (clearing): should get some REP`)
				assert.ok(amounts.totalFilledRep <= minRepBackOnFullBuy, `Bid ${bid.bidIndex} (clearing): filled REP <= demand`)
				const ethUsed = (amounts.totalFilledRep * clearingPrice) / ATTOETH_PER_ETH
				approximatelyEqual(amounts.totalEthRefund, bid.bidSize - ethUsed, tolerance, `Bid ${bid.bidIndex} (clearing): correct ETH refund`)
				totalFilledRep += amounts.totalFilledRep
				totalEthRefund += amounts.totalEthRefund
			} else {
				// Winning bid: full REP demand, no ETH refund
				assert.ok(amounts.totalFilledRep >= minRepBackOnFullBuy, `Bid ${bid.bidIndex} (winning): REP fill`)
				assert.strictEqual(amounts.totalEthRefund, 0n, `Bid ${bid.bidIndex} (winning): no ETH refund`)
				totalFilledRep += amounts.totalFilledRep
			}
			await withdrawBids(auctionCreator, auctionAddress, userId, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
		}
		return { totalFilledRep, totalEthRefund }
	}

	function assertClearingTickInRange(tick: bigint): void {
		assert.ok(tick >= MIN_TICK && tick <= MAX_TICK, `clearing tick ${tick} outside [${MIN_TICK}, ${MAX_TICK}]`)
	}

	const buildFenwickTreeEntries = (bidCount: bigint, refundedBidCount: bigint, bidAmount: bigint) => {
		const entries = new Map<bigint, bigint>()
		const addAtIndex = (oneBasedIndex: bigint, amount: bigint) => {
			let treeIndex = oneBasedIndex
			while (treeIndex <= bidCount) {
				entries.set(treeIndex, (entries.get(treeIndex) ?? 0n) + amount)
				treeIndex += treeIndex & -treeIndex
			}
		}

		for (let refundedIndex = 1n; refundedIndex <= refundedBidCount; refundedIndex++) {
			addAtIndex(refundedIndex, bidAmount)
		}

		return entries
	}

	const estimateWithdrawGasWithManyRefundedPredecessors = async (bidCount: bigint, clientIndex: number) => {
		const ownerClient = createTestClient(clientIndex)
		await deployUniformPriceDualCapBatchAuction(client, ownerClient.account.address)
		const localAuctionAddress = getUniformPriceDualCapBatchAuctionAddress(ownerClient.account.address)
		const sameTick = 0n
		const bidAmount = 1n * ATTOETH_PER_ETH
		await startAuction(ownerClient, localAuctionAddress, 10n * bidAmount, bidAmount)

		for (let bidIndex = 0n; bidIndex < bidCount; bidIndex++) {
			await submitBid(ownerClient, localAuctionAddress, sameTick, bidAmount)
		}

		const bidArraySlot = keccak256(encodeAbiParameters([{ type: 'int256' }, { type: 'uint256' }], [sameTick, AUCTION_BIDS_AT_TICK_SLOT]))
		const bidDataStartSlot = BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }], [bidArraySlot])))
		const nodeBaseSlot = BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [1n, AUCTION_NODES_SLOT])))
		const refundedTreeOuterSlot = keccak256(encodeAbiParameters([{ type: 'int256' }, { type: 'uint256' }], [sameTick, AUCTION_REFUNDED_BID_PREFIX_TREE_SLOT]))
		const stateDiff: Record<string, bigint> = {
			[`0x${(nodeBaseSlot + 1n).toString(16)}`]: bidAmount,
			[`0x${(nodeBaseSlot + 2n).toString(16)}`]: bidAmount,
		}

		for (let bidIndex = 0n; bidIndex < bidCount - 1n; bidIndex++) {
			const claimedSlot = bidDataStartSlot + bidIndex * BID_STRUCT_SLOT_COUNT + 3n
			const ethAmountSlot = bidDataStartSlot + bidIndex * BID_STRUCT_SLOT_COUNT + 1n
			stateDiff[`0x${claimedSlot.toString(16)}`] = 1n
			stateDiff[`0x${ethAmountSlot.toString(16)}`] = 0n
		}

		for (const [treeIndex, value] of buildFenwickTreeEntries(bidCount, bidCount - 1n, bidAmount)) {
			const treeSlot = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [treeIndex, refundedTreeOuterSlot]))
			stateDiff[treeSlot] = value
		}

		await mockWindow.addStateOverrides({
			[localAuctionAddress]: {
				stateDiff,
			},
		})

		await finalizeAndVerify(ownerClient, localAuctionAddress)

		return await ownerClient.estimateContractGas({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'withdrawBids',
			address: localAuctionAddress,
			args: [ownerClient.account.address, [{ bidIndex: bidCount - 1n, tick: sameTick }]],
		})
	}

	const estimateFinalizeGasWithBidDistribution = async (bidCount: bigint, distinctTicks: boolean, clientIndex: number) => {
		const ownerClient = createTestClient(clientIndex)
		await deployUniformPriceDualCapBatchAuction(client, ownerClient.account.address)
		const localAuctionAddress = getUniformPriceDualCapBatchAuctionAddress(ownerClient.account.address)
		const bidAmount = 1n * ATTOETH_PER_ETH
		const totalBidAmount = bidCount * bidAmount
		await startAuction(ownerClient, localAuctionAddress, totalBidAmount + bidAmount, totalBidAmount + bidAmount)

		for (let bidIndex = 0n; bidIndex < bidCount; bidIndex++) {
			const tick = distinctTicks ? bidIndex : 0n
			await submitBid(ownerClient, localAuctionAddress, tick, bidAmount)
		}

		await mockWindow.advanceTime(AUCTION_TIME + 1n)

		return await ownerClient.estimateContractGas({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'finalize',
			address: localAuctionAddress,
			args: [],
		})
	}

	const formatStorageSlot = (slot: bigint) => `0x${slot.toString(16)}`

	const getMappingBaseSlot = (key: bigint, slot: bigint) => BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [key, slot])))

	const getMinAvlNodesForHeight = (height: bigint): bigint => {
		if (height === 0n) return 0n
		if (height === 1n) return 1n
		let previousPrevious = 0n
		let previous = 1n
		for (let currentHeight = 2n; currentHeight <= height; currentHeight++) {
			const current = 1n + previous + previousPrevious
			previousPrevious = previous
			previous = current
		}
		return previous
	}

	const getMaxAvlHeightWithinNodeCap = (nodeCap: bigint): bigint => {
		let height = 0n
		while (getMinAvlNodesForHeight(height + 1n) <= nodeCap) {
			height++
		}
		return height
	}

	const buildSyntheticWorstCaseFinalizeStateDiff = (height: bigint, bidAmount: bigint) => {
		const stateDiff: Record<string, bigint> = {
			[formatStorageSlot(AUCTION_ROOT_SLOT)]: 1n,
			[formatStorageSlot(AUCTION_NEXT_ID_SLOT)]: height + 1n,
			[formatStorageSlot(AUCTION_MAX_REP_BEING_SOLD_SLOT)]: 1n,
			[formatStorageSlot(AUCTION_ETH_RAISE_CAP_SLOT)]: height * bidAmount + bidAmount,
		}

		for (let nodeId = 1n; nodeId <= height; nodeId++) {
			const remainingNodes = height - nodeId + 1n
			const nodeBaseSlot = getMappingBaseSlot(nodeId, AUCTION_NODES_SLOT)
			const tick = nodeId - 1n
			const values = [tick, bidAmount, remainingNodes * bidAmount, 0n, nodeId === height ? 0n : nodeId + 1n, remainingNodes, remainingNodes * bidAmount, tick]

			strictEqualTypeSafe(BigInt(values.length), NODE_STRUCT_SLOT_COUNT, 'synthetic node slot count mismatch')
			for (let index = 0; index < values.length; index++) {
				stateDiff[formatStorageSlot(nodeBaseSlot + BigInt(index))] = values[index] ?? 0n
			}
		}

		return stateDiff
	}

	const estimateFinalizeGasForSyntheticWorstCaseDepth = async (height: bigint, clientIndex: number) => {
		const ownerClient = createTestClient(clientIndex)
		await deployUniformPriceDualCapBatchAuction(client, ownerClient.account.address)
		const localAuctionAddress = getUniformPriceDualCapBatchAuctionAddress(ownerClient.account.address)
		const bidAmount = 1n * ATTOETH_PER_ETH

		await mockWindow.addStateOverrides({
			[localAuctionAddress]: {
				balance: height * bidAmount,
				stateDiff: buildSyntheticWorstCaseFinalizeStateDiff(height, bidAmount),
			},
		})

		return await ownerClient.estimateContractGas({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'finalize',
			address: localAuctionAddress,
			args: [],
		})
	}

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		await setupTestAccounts(mockWindow)
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await deployUniformPriceDualCapBatchAuction(client, client.account.address)
		auctionAddress = getUniformPriceDualCapBatchAuctionAddress(client.account.address)
		assert.ok(await contractExists(client, auctionAddress), 'auction exists')
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
	})

	// ============ Test Suites ============

	describe('Lifecycle & Finalization', () => {
		test('can start auction and make a single bid that finalizes', async () => {
			const raiseCap = DEFAULT_ETH_RAISE_CAP * ATTOETH_PER_ETH
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
			const maxRepBeingSold = DEFAULT_MAX_REP * ATTOETH_PER_ETH
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
			const maxRepBeingSold = DEFAULT_MAX_REP * ATTOETH_PER_ETH
			await setupStandardAuction(client, auctionAddress)
			const bids = [
				{ bidSize: (2n * maxRepBeingSold) / 7n, tick: priceToClosestTick(PRICE_PRECISION / 4n), address: TEST_ADDRESSES[0], bidIndex: 0n },
				{ bidSize: (2n * maxRepBeingSold) / 7n, tick: priceToClosestTick(PRICE_PRECISION / 4n), address: TEST_ADDRESSES[1], bidIndex: 1n },
				{ bidSize: (2n * maxRepBeingSold) / 7n, tick: priceToClosestTick(PRICE_PRECISION), address: TEST_ADDRESSES[2], bidIndex: 0n },
				{ bidSize: (2n * maxRepBeingSold) / 7n, tick: priceToClosestTick(PRICE_PRECISION), address: TEST_ADDRESSES[3], bidIndex: 1n },
				{ bidSize: (2n * maxRepBeingSold) / 7n, tick: priceToClosestTick(PRICE_PRECISION * 4n), address: TEST_ADDRESSES[4], bidIndex: 0n },
				{ bidSize: (2n * maxRepBeingSold) / 7n, tick: priceToClosestTick(PRICE_PRECISION * 4n), address: TEST_ADDRESSES[5], bidIndex: 1n },
			]

			for (const bid of bids) {
				const bidClient = createWriteClient(mockWindow, bid.address, 0)
				await submitBid(bidClient, auctionAddress, bid.tick, bid.bidSize)
			}

			//const expectedClearing = computeClearingTypeScript(bids, maxRepBeingSold, DEFAULT_MAX_REP * ATTOETH_PER_ETH )

			const clearing = await computeClearing(client, auctionAddress)
			const completelyFilling = bids.filter(x => x.tick > clearing.foundTick)
			const completelyFillingRep = completelyFilling.reduce((a, b) => a + (b.bidSize * PRICE_PRECISION) / tickToPrice(clearing.foundTick), 0n)
			assert.ok(completelyFillingRep < maxRepBeingSold, 'selling too much rep with that tick')

			//assertExpectedClearing(clearing, expectedClearing.clearingTick)

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
				grandTotalFilled += result.totalFilledRep
			}

			// Total filled REP across all users should not exceed the amount sold
			assert.ok(grandTotalFilled <= maxRepBeingSold, 'total filled REP exceeds maxRepBeingSold')
		})

		test('computeClearing selects the lower price tick when only lower-price cumulative demand exhausts supply', async () => {
			await setupStandardAuction(client, auctionAddress, 1_000n, 100n)

			const expensiveTick = tickForPrice(4n * PRICE_PRECISION)
			const cheapTick = tickForPrice(PRICE_PRECISION)
			const bidAmount = 100n * ATTOETH_PER_ETH

			await submitBid(client, auctionAddress, expensiveTick, bidAmount)
			await submitBid(client, auctionAddress, cheapTick, bidAmount)

			const clearing = await computeClearing(client, auctionAddress)

			assertExpectedClearing(clearing, cheapTick, bidAmount)
		})

		test('winning bids receive their requested REP and clearing-tick bids refund excess ETH', async () => {
			await setupStandardAuction(client, auctionAddress)

			const alice = createTestClient(0)
			const bob = createTestClient(1)

			const aliceTick = tickForPrice(PRICE_PRECISION * 2n)
			const aliceEth = 190n * 10n ** 18n
			const bobTick = tickForPrice(PRICE_PRECISION * 4n)
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

			const totalFilled = aliceResult.totalFilledRep + bobResult.totalFilledRep
			const maxRep = DEFAULT_MAX_REP * ATTOETH_PER_ETH
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
				{ tick: sameTick, bidSize: bid2Amount, bidIndex: 1n },
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

			// Compute expected ethRaised after refund (matches what finalize will use)
			const clearingAfterRefund = await computeClearing(client, auctionAddress)
			const expectedEthRaised = clearingAfterRefund.accumulatedEth

			await finalize(client, auctionAddress)
			strictEqualTypeSafe(await getEthRaised(client, auctionAddress), expectedEthRaised, 'raised amount mismatch')
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
			const raiseCap = 1_000n * ATTOETH_PER_ETH
			const maxRepBeingSold = 100n * ATTOETH_PER_ETH
			const sameTick = 0n
			const bidAmount = 60n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, raiseCap, maxRepBeingSold)

			const alice = createTestClient(0)
			await submitBid(alice, auctionAddress, sameTick, bidAmount)
			await submitBid(alice, auctionAddress, sameTick, bidAmount)
			await submitBid(alice, auctionAddress, sameTick, bidAmount)

			const nodeBaseSlot = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [1n, AUCTION_NODES_SLOT]))
			const bidArraySlot = keccak256(encodeAbiParameters([{ type: 'int256' }, { type: 'uint256' }], [sameTick, AUCTION_BIDS_AT_TICK_SLOT]))
			const bidDataSlot = keccak256(encodeAbiParameters([{ type: 'bytes32' }], [bidArraySlot]))
			const refundedTreeOuterSlot = keccak256(encodeAbiParameters([{ type: 'int256' }, { type: 'uint256' }], [sameTick, AUCTION_REFUNDED_BID_PREFIX_TREE_SLOT]))
			const firstBidEthAmountSlot = `0x${(BigInt(bidDataSlot) + 1n).toString(16)}`
			const nodeTotalEthSlot = `0x${(BigInt(nodeBaseSlot) + 1n).toString(16)}`
			const nodeSubtreeEthSlot = `0x${(BigInt(nodeBaseSlot) + 2n).toString(16)}`
			const activeTotalEth = 2n * bidAmount
			const refundedTreeStateDiff: Record<string, bigint> = {}
			for (const [treeIndex, value] of buildFenwickTreeEntries(3n, 1n, bidAmount)) {
				const treeSlot = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [treeIndex, refundedTreeOuterSlot]))
				refundedTreeStateDiff[treeSlot] = value
			}

			await mockWindow.addStateOverrides({
				[auctionAddress]: {
					stateDiff: {
						[firstBidEthAmountSlot]: 0n,
						[nodeTotalEthSlot]: activeTotalEth,
						[nodeSubtreeEthSlot]: activeTotalEth,
						...refundedTreeStateDiff,
					},
				},
			})

			await finalizeAndVerify(client, auctionAddress)

			const secondBidWithdrawal = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: sameTick, bidIndex: 1n }])
			const expectedSecondBidRep = bidAmount

			strictEqualTypeSafe(secondBidWithdrawal.totalFilledRep, expectedSecondBidRep, 'the second active bid should receive its full fill after an earlier bid is cleared from the tick')
			strictEqualTypeSafe(secondBidWithdrawal.totalEthRefund, 0n, 'the fully filled second active bid should not receive an ETH refund')
		})

		test('withdraw gas for a same-tick bid with many refunded predecessors avoids linear growth', async () => {
			const gasWithSixteenBids = await estimateWithdrawGasWithManyRefundedPredecessors(16n, 1)
			const gasWithOneHundredTwentyEightBids = await estimateWithdrawGasWithManyRefundedPredecessors(128n, 2)

			assert.ok(gasWithOneHundredTwentyEightBids < gasWithSixteenBids * 4n, `withdraw gas should stay sublinear in the number of refunded same-tick predecessors: 16 bids=${gasWithSixteenBids.toString()}, 128 bids=${gasWithOneHundredTwentyEightBids.toString()}`)
		})

		test('finalize gas stays bounded when many bids land on the same tick', async () => {
			const gasWithSixteenBids = await estimateFinalizeGasWithBidDistribution(16n, false, 3)
			const gasWithOneHundredTwentyEightBids = await estimateFinalizeGasWithBidDistribution(128n, false, 4)

			assert.ok(gasWithOneHundredTwentyEightBids < gasWithSixteenBids * 2n, `finalize gas should track price levels rather than raw bid count when bids share a tick: 16 bids=${gasWithSixteenBids.toString()}, 128 bids=${gasWithOneHundredTwentyEightBids.toString()}`)
		})

		test('distinct-tick finalize gas stays close to same-tick finalize gas after subtree pruning', async () => {
			const gasWithThirtyTwoSameTickBids = await estimateFinalizeGasWithBidDistribution(32n, false, 5)
			const gasWithThirtyTwoDistinctTicks = await estimateFinalizeGasWithBidDistribution(32n, true, 6)

			assert.ok(gasWithThirtyTwoDistinctTicks < gasWithThirtyTwoSameTickBids * 2n, `distinct price levels should stay close to same-tick finalize gas after subtree pruning: same tick=${gasWithThirtyTwoSameTickBids.toString()}, distinct ticks=${gasWithThirtyTwoDistinctTicks.toString()}`)
		})

		test('finalize stays under 20 million gas on a synthetic max-depth clearing path for the full tick cap', async () => {
			const maxAvlHeightWithinTickCap = getMaxAvlHeightWithinNodeCap(MAX_DISTINCT_TICK_COUNT)
			strictEqualTypeSafe(maxAvlHeightWithinTickCap, 28n, 'unexpected AVL height bound for the tick cap')

			const finalizeGas = await estimateFinalizeGasForSyntheticWorstCaseDepth(maxAvlHeightWithinTickCap, 1)

			assert.ok(finalizeGas < FINALIZE_GAS_LIMIT, `finalize gas should stay below ${FINALIZE_GAS_LIMIT.toString()} for the synthetic max-depth clearing path: gas=${finalizeGas.toString()}, height=${maxAvlHeightWithinTickCap.toString()}`)
		})

		test('winner unaffected after bidder refunds multiple losing bids', async () => {
			await setupStandardAuction(client, auctionAddress)

			const alice = createTestClient(0)
			const bob = createTestClient(1)

			const lowTicks = [tickForPrice(PRICE_PRECISION / 4n), tickForPrice(PRICE_PRECISION / 3n), tickForPrice(PRICE_PRECISION / 2n)]
			const minBidSize = await getMinBidSize(client, auctionAddress)
			const lowBid = minBidSize
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
			strictEqualTypeSafe(clearing.hitCap, false, 'auction should not have price')
		})

		test('underfunded auction distributes all REP proportionally', async () => {
			const ethRaiseCap = 1000n * 10n ** 18n // large enough to not bind
			const maxRepBeingSold = 100n * 10n ** 18n // 100 REP
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const alice = createTestClient(0)
			const bob = createTestClient(1)

			const aliceEth = 4n * 10n ** 18n
			const bobEth = 6n * 10n ** 18n

			// Use prices that make the auction underfunded (hitCap false)
			const aliceTick = tickForPrice(2n * 10n ** 18n) // 2 ETH/REP
			const bobTick = tickForPrice(4n * 10n ** 18n) // 4 ETH/REP

			await submitBid(alice, auctionAddress, aliceTick, aliceEth)
			await submitBid(bob, auctionAddress, bobTick, bobEth)

			// Check clearing result before finalize to verify underfunded condition
			const clearingPre = await computeClearing(client, auctionAddress)
			strictEqualTypeSafe(clearingPre.hitCap, false, 'hitCap should be false (underfunded)')

			// Finalize the auction
			await finalize(client, auctionAddress)

			// Verify total REP purchased equals maxRepBeingSold (all rep sold)
			const totalRep = await getTotalRepPurchased(client, auctionAddress)
			strictEqualTypeSafe(totalRep, maxRepBeingSold, 'totalRepPurchased should equal maxRep')

			// Alice withdraws her proportional share
			const aliceBids = [{ tick: aliceTick, bidIndex: 0n }]
			const aliceResult = await simulateWithdrawBids(client, auctionAddress, alice.account.address, aliceBids)
			const expectedAliceRep = (aliceEth * maxRepBeingSold) / (aliceEth + bobEth) // 4/10 * 100 = 40
			strictEqualTypeSafe(aliceResult.totalFilledRep, expectedAliceRep, 'alice proportional REP')
			strictEqualTypeSafe(aliceResult.totalEthRefund, 0n, 'alice no ETH refund')

			// Bob withdraws his proportional share
			const bobBids = [{ tick: bobTick, bidIndex: 0n }]
			const bobResult = await simulateWithdrawBids(client, auctionAddress, bob.account.address, bobBids)
			const expectedBobRep = (bobEth * maxRepBeingSold) / (aliceEth + bobEth) // 6/10 * 100 = 60
			strictEqualTypeSafe(bobResult.totalFilledRep, expectedBobRep, 'bob proportional REP')
			strictEqualTypeSafe(bobResult.totalEthRefund, 0n, 'bob no ETH refund')

			// Contract should have no ETH balance after finalization
			await assertContractEmpty(client, auctionAddress)
		})

		test('underfunded auctions treat bids exactly at the threshold price as winners', async () => {
			const ethRaiseCap = 1_000n * 10n ** 18n
			const maxRepBeingSold = 100n * 10n ** 18n
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const alice = createTestClient(0)
			const thresholdPrice = PRICE_PRECISION / 2n
			const thresholdTick = tickForPrice(thresholdPrice)
			const aliceEth = (maxRepBeingSold * tickToPrice(thresholdTick)) / PRICE_PRECISION

			await submitBid(alice, auctionAddress, thresholdTick, aliceEth)
			await finalize(client, auctionAddress)

			const totalRep = await getTotalRepPurchased(client, auctionAddress)
			strictEqualTypeSafe(totalRep, maxRepBeingSold, 'all REP should clear when demand sits exactly at the underfunded threshold')

			const withdrawal = await simulateWithdrawBids(client, auctionAddress, alice.account.address, [{ tick: thresholdTick, bidIndex: 0n }])
			strictEqualTypeSafe(withdrawal.totalEthRefund, 0n, 'threshold-clearing winner should not receive an ETH refund')
			approximatelyEqual(withdrawal.totalFilledRep, maxRepBeingSold, DEFAULT_TOLERANCE, 'threshold-clearing winner should receive the full REP allocation')
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

			await assert.rejects(async () => await submitBid(client, auctionAddress, 0n, 0n), 'invalid')

			await submitBid(client, auctionAddress, 0n, 1n)
		})

		test('submitBid invalid states: before auction start and after finalize', async () => {
			const ethRaiseCap = 100n * 10n ** 18n
			const maxRepBeingSold = 10n * 10n ** 18n
			const tick = tickForPrice(PRICE_PRECISION)
			const bidAmount = 1n * 10n ** 18n

			const freshAddress = getUniformPriceDualCapBatchAuctionAddress(addressString(TEST_ADDRESSES[3]))
			await deployUniformPriceDualCapBatchAuction(client, addressString(TEST_ADDRESSES[3]))
			await assert.rejects(async () => await submitBid(client, freshAddress, tick, bidAmount), 'invalid')

			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
			await submitBid(client, auctionAddress, tick, ethRaiseCap)
			await mockWindow.advanceTime(AUCTION_TIME + 1n)
			await finalize(client, auctionAddress)
			strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'auction should be finalized before post-finalization assertions')

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

	describe('Enumeration Views', () => {
		test('getTickPage returns one historical tick per unique tick and tracks same-tick submission counts', async () => {
			const ethRaiseCap = 1_000n * ATTOETH_PER_ETH
			const maxRepBeingSold = 1_000n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const firstTick = 0n
			const secondTick = 10_000n
			const firstTickBidOne = 2n * ATTOETH_PER_ETH
			const firstTickBidTwo = 3n * ATTOETH_PER_ETH
			const secondTickBid = 5n * ATTOETH_PER_ETH

			await submitBid(client, auctionAddress, firstTick, firstTickBidOne)
			await submitBid(client, auctionAddress, firstTick, firstTickBidTwo)
			await submitBid(client, auctionAddress, secondTick, secondTickBid)

			strictEqualTypeSafe(await getTickCount(client, auctionAddress), 2n, 'unique tick count mismatch')

			const tickPage = await getTickPage(client, auctionAddress, 0n, 100n)
			assert.strictEqual(tickPage.length, 2, 'tick page length mismatch')

			const firstSummary = ensureDefined(tickPage[0], 'missing first tick summary')
			strictEqualTypeSafe(firstSummary.tick, firstTick, 'first historical tick mismatch')
			strictEqualTypeSafe(firstSummary.submissionCount, 2n, 'same-tick submission count mismatch')
			strictEqualTypeSafe(firstSummary.currentTotalEth, firstTickBidOne + firstTickBidTwo, 'same-tick active ETH mismatch')
			strictEqualTypeSafe(firstSummary.active, true, 'same-tick should stay active')

			const secondSummary = ensureDefined(tickPage[1], 'missing second tick summary')
			strictEqualTypeSafe(secondSummary.tick, secondTick, 'second historical tick mismatch')
			strictEqualTypeSafe(secondSummary.submissionCount, 1n, 'second tick submission count mismatch')
			strictEqualTypeSafe(secondSummary.currentTotalEth, secondTickBid, 'second tick active ETH mismatch')
			strictEqualTypeSafe(secondSummary.active, true, 'second tick should stay active')
		})

		test('a fully refunded tick remains enumerable with zero active ETH', async () => {
			const ethRaiseCap = 20n * ATTOETH_PER_ETH
			const maxRepBeingSold = 10n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const losingTick = -20_000n
			const winningTick = 0n
			const losingBid = 2n * ATTOETH_PER_ETH
			const winningBid = 12n * ATTOETH_PER_ETH

			await submitBid(client, auctionAddress, losingTick, losingBid)
			await submitBid(client, auctionAddress, winningTick, winningBid)
			await refundLosingBids(client, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

			const tickPage = await getTickPage(client, auctionAddress, 0n, 100n)
			const refundedSummary = tickPage.find(summary => summary.tick === losingTick)
			const activeSummary = tickPage.find(summary => summary.tick === winningTick)

			strictEqualTypeSafe(refundedSummary?.currentTotalEth, 0n, 'refunded-away tick should have zero active ETH')
			strictEqualTypeSafe(refundedSummary?.submissionCount, 1n, 'refunded-away tick should keep historical submission count')
			strictEqualTypeSafe(refundedSummary?.active, false, 'refunded-away tick should be inactive')
			strictEqualTypeSafe(activeSummary?.active, true, 'winning tick should remain active')
		})

		test('active tick pages stay sorted by descending tick and exclude refunded-away historical levels', async () => {
			const ethRaiseCap = 20n * ATTOETH_PER_ETH
			const maxRepBeingSold = 10n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const lowTick = -20_000n
			const middleTick = 0n
			const highTick = 20_000n

			await submitBid(client, auctionAddress, lowTick, 2n * ATTOETH_PER_ETH)
			await submitBid(client, auctionAddress, middleTick, 4n * ATTOETH_PER_ETH)
			await submitBid(client, auctionAddress, highTick, 6n * ATTOETH_PER_ETH)
			await refundLosingBids(client, auctionAddress, [{ tick: lowTick, bidIndex: 0n }])

			strictEqualTypeSafe(await activeTickCount(client, auctionAddress), 2n, 'active tick count mismatch after refund')
			assert.deepStrictEqual(
				(await getActiveTickPage(client, auctionAddress, 0n, 100n)).map(summary => summary.tick),
				[highTick, middleTick],
			)
		})

		test('getTickSummary returns historical summaries even after a tick is fully refunded away', async () => {
			const ethRaiseCap = 20n * ATTOETH_PER_ETH
			const maxRepBeingSold = 10n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const losingTick = -20_000n
			const winningTick = 0n

			await submitBid(client, auctionAddress, losingTick, 2n * ATTOETH_PER_ETH)
			await submitBid(client, auctionAddress, winningTick, 12n * ATTOETH_PER_ETH)
			await refundLosingBids(client, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

			const summary = await getTickSummary(client, auctionAddress, losingTick)
			strictEqualTypeSafe(summary.tick, losingTick, 'historical tick mismatch')
			strictEqualTypeSafe(summary.currentTotalEth, 0n, 'historical tick should have zero active ETH')
			strictEqualTypeSafe(summary.submissionCount, 1n, 'historical tick should retain submission count')
			strictEqualTypeSafe(summary.active, false, 'historical tick should be inactive')
		})

		test('getBidPageAtTick returns bid indices, cumulative ETH, and refund state while preserving refunded bid amounts', async () => {
			const ethRaiseCap = 20n * ATTOETH_PER_ETH
			const maxRepBeingSold = 10n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const losingTick = -20_000n
			const winningTick = 0n
			const firstLosingBid = 2n * ATTOETH_PER_ETH
			const secondLosingBid = 3n * ATTOETH_PER_ETH
			const winningBid = 12n * ATTOETH_PER_ETH

			await submitBid(client, auctionAddress, losingTick, firstLosingBid)
			await submitBid(client, auctionAddress, losingTick, secondLosingBid)
			await submitBid(client, auctionAddress, winningTick, winningBid)
			await refundLosingBids(client, auctionAddress, [{ tick: losingTick, bidIndex: 1n }])

			strictEqualTypeSafe(await getBidCountAtTick(client, auctionAddress, losingTick), 2n, 'historical bid count mismatch')

			const losingBidPage = await getBidPageAtTick(client, auctionAddress, losingTick, 0n, 100n)
			assert.strictEqual(losingBidPage.length, 2, 'same-tick bid page length mismatch')

			const firstBidView = ensureDefined(losingBidPage[0], 'missing first losing bid view')
			strictEqualTypeSafe(firstBidView.bidIndex, 0n, 'first bid index mismatch')
			strictEqualTypeSafe(firstBidView.ethAmount, firstLosingBid, 'first bid amount mismatch')
			strictEqualTypeSafe(firstBidView.cumulativeEth, firstLosingBid, 'first cumulative ETH mismatch')
			strictEqualTypeSafe(firstBidView.claimed, false, 'first bid should remain unclaimed')
			strictEqualTypeSafe(firstBidView.refunded, false, 'first bid should not be marked refunded')

			const secondBidView = ensureDefined(losingBidPage[1], 'missing second losing bid view')
			strictEqualTypeSafe(secondBidView.bidIndex, 1n, 'second bid index mismatch')
			strictEqualTypeSafe(secondBidView.ethAmount, secondLosingBid, 'refunded bid should retain original amount')
			strictEqualTypeSafe(secondBidView.cumulativeEth, firstLosingBid + secondLosingBid, 'second cumulative ETH mismatch')
			strictEqualTypeSafe(secondBidView.claimed, true, 'refunded bid should be marked claimed')
			strictEqualTypeSafe(secondBidView.refunded, true, 'refunded bid should be marked refunded')
		})

		test('bid views expose active cumulative ETH before each bid after same-tick predecessor refunds', async () => {
			const ethRaiseCap = 20n * ATTOETH_PER_ETH
			const maxRepBeingSold = 10n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const losingTick = -20_000n
			const winningTick = 0n
			const firstLosingBid = 2n * ATTOETH_PER_ETH
			const secondLosingBid = 3n * ATTOETH_PER_ETH
			const winningBid = 12n * ATTOETH_PER_ETH

			await submitBid(client, auctionAddress, losingTick, firstLosingBid)
			await submitBid(client, auctionAddress, losingTick, secondLosingBid)
			await submitBid(client, auctionAddress, winningTick, winningBid)
			await refundLosingBids(client, auctionAddress, [{ tick: losingTick, bidIndex: 0n }])

			const losingBidPage = await getBidPageAtTick(client, auctionAddress, losingTick, 0n, 100n)
			const firstBidView = ensureDefined(losingBidPage[0], 'missing first losing bid view after refund')
			const secondBidView = ensureDefined(losingBidPage[1], 'missing second losing bid view after refund')

			strictEqualTypeSafe(firstBidView.activeCumulativeEthBeforeBid, 0n, 'refunded first bid should have zero active predecessor ETH')
			strictEqualTypeSafe(secondBidView.activeCumulativeEthBeforeBid, 0n, 'second bid should not count refunded predecessors ahead of it')
			strictEqualTypeSafe(secondBidView.refunded, false, 'second bid should remain active after predecessor refund')
		})

		test('getBidderBidPage returns bidder bids in submission order across ticks', async () => {
			const ethRaiseCap = 1_000n * ATTOETH_PER_ETH
			const maxRepBeingSold = 1_000n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const alice = createTestClient(0)
			const bob = createTestClient(1)
			const firstTick = -10_000n
			const secondTick = 10_000n

			await submitBid(alice, auctionAddress, firstTick, 2n * ATTOETH_PER_ETH)
			await submitBid(bob, auctionAddress, firstTick, 1n * ATTOETH_PER_ETH)
			await submitBid(alice, auctionAddress, secondTick, 3n * ATTOETH_PER_ETH)
			await submitBid(alice, auctionAddress, firstTick, 4n * ATTOETH_PER_ETH)

			strictEqualTypeSafe(await getBidderBidCount(client, auctionAddress, alice.account.address), 3n, 'alice bidder bid count mismatch')

			const aliceBidPage = await getBidderBidPage(client, auctionAddress, alice.account.address, 0n, 100n)
			assert.strictEqual(aliceBidPage.length, 3, 'alice bid page length mismatch')
			assert.deepStrictEqual(
				aliceBidPage.map(bid => ({ tick: bid.tick, bidIndex: bid.bidIndex })),
				[
					{ tick: firstTick, bidIndex: 0n },
					{ tick: secondTick, bidIndex: 0n },
					{ tick: firstTick, bidIndex: 2n },
				],
			)
		})

		test('post-finalization withdrawals mark bids claimed without marking them refunded', async () => {
			const ethRaiseCap = 20n * ATTOETH_PER_ETH
			const maxRepBeingSold = 10n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const winningTick = 0n
			const winningBid = 12n * ATTOETH_PER_ETH
			await submitBid(client, auctionAddress, winningTick, winningBid)

			await finalizeAndVerify(client, auctionAddress)
			await withdrawBids(client, auctionAddress, client.account.address, [{ tick: winningTick, bidIndex: 0n }])

			const winningBidPage = await getBidPageAtTick(client, auctionAddress, winningTick, 0n, 100n)
			const winningBidView = ensureDefined(winningBidPage[0], 'missing winning bid view')
			strictEqualTypeSafe(winningBidView.claimed, true, 'withdrawn bid should be claimed')
			strictEqualTypeSafe(winningBidView.refunded, false, 'withdrawn bid should not be marked refunded')
		})

		test('enumeration views handle empty pages and allow oversized limits', async () => {
			const ethRaiseCap = 20n * ATTOETH_PER_ETH
			const maxRepBeingSold = 10n * ATTOETH_PER_ETH
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			const tick = 0n
			await submitBid(client, auctionAddress, tick, 2n * ATTOETH_PER_ETH)

			assert.strictEqual((await getTickPage(client, auctionAddress, 5n, 10n)).length, 0, 'tick page should be empty past the end')
			assert.strictEqual((await getTickPage(client, auctionAddress, 0n, 0n)).length, 0, 'tick page should be empty for zero limit')
			assert.strictEqual((await getActiveTickPage(client, auctionAddress, 5n, 10n)).length, 0, 'active tick page should be empty past the end')
			assert.strictEqual((await getActiveTickPage(client, auctionAddress, 0n, 0n)).length, 0, 'active tick page should be empty for zero limit')
			assert.strictEqual((await getBidPageAtTick(client, auctionAddress, tick, 5n, 10n)).length, 0, 'tick bid page should be empty past the end')
			assert.strictEqual((await getBidPageAtTick(client, auctionAddress, tick, 0n, 0n)).length, 0, 'tick bid page should be empty for zero limit')
			assert.strictEqual((await getBidderBidPage(client, auctionAddress, client.account.address, 5n, 10n)).length, 0, 'bidder bid page should be empty past the end')
			assert.strictEqual((await getBidderBidPage(client, auctionAddress, client.account.address, 0n, 0n)).length, 0, 'bidder bid page should be empty for zero limit')
			assert.strictEqual((await getTickPage(client, auctionAddress, 0n, 101n)).length, 1, 'tick page should allow limits above prior caps')
			assert.strictEqual((await getActiveTickPage(client, auctionAddress, 0n, 101n)).length, 1, 'active tick page should allow limits above prior caps')
			assert.strictEqual((await getBidPageAtTick(client, auctionAddress, tick, 0n, 101n)).length, 1, 'tick bid page should allow limits above prior caps')
			assert.strictEqual((await getBidderBidPage(client, auctionAddress, client.account.address, 0n, 101n)).length, 1, 'bidder bid page should allow limits above prior caps')
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
			approximatelyEqual(beforeFinalizeAuctionEth - afterFinalizeAuctionEth, ethRaiseCap, 1000n, 'Auction sent about the cap to owner')

			const clearing = await computeClearing(client, auctionAddress)
			const expectedFilledRep = (clearing.accumulatedEth * PRICE_PRECISION) / clearingPrice

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
				{ tick: sameTick, bidSize: bid2Amount, bidIndex: 1n },
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
		type RefundTestCase = {
			name: string
			ethRaiseCap: bigint
			maxRepBeingSold: bigint
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
				ethRaiseCap: 10n * 10n ** 18n,
				maxRepBeingSold: 10n * 10n ** 18n,
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
				ethRaiseCap: 10n * 10n ** 18n,
				maxRepBeingSold: 10n * 10n ** 18n, // increase so Alice alone does not hit cap
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
				ethRaiseCap: 10n * 10n ** 18n,
				maxRepBeingSold: 5n * 10n ** 18n,
				alicePrice: ATTOETH_PER_ETH,
				aliceAmount: 4n * 10n ** 18n,
				bobPrice: 2n * ATTOETH_PER_ETH,
				bobAmount: 6n * 10n ** 18n,
				refundBidder: 'bob' as const,
				expectedClearingTick: tickForPrice(2n * ATTOETH_PER_ETH),
				expectRefundToSucceed: false,
				checkClearingUnchanged: false,
			},
		] as const

		test.each(refundCases)('refundLosingBids: $name', async (c: RefundTestCase) => {
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
		function computeExpectedClearing(bids: Array<{ tick: bigint; amount: bigint }>, maxRepBeingSold: bigint, ethRaiseCap: bigint): { hitCap: boolean; foundTick: bigint; accumulatedEth: bigint } {
			const sorted = [...bids].sort((a, b) => {
				if (b.tick > a.tick) return 1
				if (b.tick < a.tick) return -1
				return 0
			})
			let accumulatedEth = 0n
			let lastValidTick = 0n
			let lastValidEth = 0n
			for (const bid of sorted) {
				const price = tickToPrice(bid.tick)
				let ethToTake = bid.amount
				if (price === 0n) ethToTake = 0n

				if (accumulatedEth > 0n) {
					const repricedRep = (accumulatedEth * PRICE_PRECISION) / price
					if (repricedRep > maxRepBeingSold) return { hitCap: true, foundTick: lastValidTick, accumulatedEth: lastValidEth }
				}

				if (accumulatedEth >= ethRaiseCap) return { hitCap: true, foundTick: lastValidTick, accumulatedEth: lastValidEth }

				const remainingCap = ethRaiseCap - accumulatedEth
				if (ethToTake > remainingCap) ethToTake = remainingCap
				const newAccumulatedEth = accumulatedEth + ethToTake
				const totalRep = price === 0n ? 0n : (newAccumulatedEth * PRICE_PRECISION) / price

				if (totalRep >= maxRepBeingSold) {
					const maxEthAtThisPrice = (maxRepBeingSold * price) / PRICE_PRECISION
					let ethUsedAtClearing = 0n
					if (maxEthAtThisPrice > accumulatedEth) ethUsedAtClearing = maxEthAtThisPrice - accumulatedEth
					if (ethUsedAtClearing > ethToTake) ethUsedAtClearing = ethToTake
					return { hitCap: true, foundTick: bid.tick, accumulatedEth: accumulatedEth + ethUsedAtClearing }
				}

				if (newAccumulatedEth >= ethRaiseCap) return { hitCap: true, foundTick: bid.tick, accumulatedEth: newAccumulatedEth }

				accumulatedEth = newAccumulatedEth
				lastValidTick = bid.tick
				lastValidEth = accumulatedEth
			}
			return { hitCap: false, foundTick: 0n, accumulatedEth: 0n }
		}

		type EdgeCaseTest = {
			name: string
			ethRaiseCap: bigint
			maxRepBeingSold: bigint
			bids: Array<{ tick: bigint; amount: bigint }>
		}
		const edgeCaseTests: EdgeCaseTest[] = [
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
		] as const

		test.each(edgeCaseTests)('covers various edge cases: $name', async (c: EdgeCaseTest) => {
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

			assert.strictEqual(clearing.hitCap, expected.hitCap, `${c.name}: hitCap mismatch`)
			if (expected.hitCap) {
				strictEqualTypeSafe(clearing.foundTick, expected.foundTick, `${c.name}: foundTick mismatch`)
				strictEqualTypeSafe(clearing.accumulatedEth, expected.accumulatedEth, `${c.name}: accumulatedEth mismatch`)
				await finalize(client, auctionAddress)
				await assertFairPayoutForUser(client, auctionAddress, client.account.address, fairPayoutBids, clearing.foundTick)
			} else {
				assert.strictEqual(clearing.hitCap, false, `${c.name}: expected no clearing price`)
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
			assert.ok(clearingPre.hitCap)
			strictEqualTypeSafe(clearingPre.foundTick, clearingTick, 'clearing tick should be 0')
			strictEqualTypeSafe(clearingPre.foundTick > losingTick, true)

			// Finalize
			await mockWindow.advanceTime(AUCTION_TIME + 1n)
			await finalize(client, auctionAddress)
			strictEqualTypeSafe(await isFinalized(client, auctionAddress), true)

			// 1) Non-owner (alice) cannot withdraw her losing bid -> revert with "Only owner can call"
			await assert.rejects(async () => await withdrawBids(alice, auctionAddress, alice.account.address, [{ tick: losingTick, bidIndex: 0n }]), 'Only owner can call')

			// 2) Non-owner (bob) cannot withdraw his winning bid -> also revert
			await assert.rejects(async () => await withdrawBids(bob, auctionAddress, bob.account.address, [{ tick: winningTick, bidIndex: 0n }]), 'Only owner can call')

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
		test('withdrawBids should succeed with zero clearing price (extreme negative tick)', async () => {
			// Setup: high cap to avoid hitting it, tiny maxRepBeingSold so rep target not reached
			const ethRaiseCap = 1000n * ATTOETH_PER_ETH
			const maxRepBeingSold = 1n // 1 wei REP
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			// Use a tick where tickToPrice returns 0 (very negative). -450000 yields price 0
			const zeroPriceTick = -450000n
			const bidAmount = 1n * ATTOETH_PER_ETH // 1 ETH

			await submitBidAndVerifyLock(client, auctionAddress, zeroPriceTick, bidAmount)

			// Finalize: should succeed
			await mockWindow.advanceTime(AUCTION_TIME + 1n)
			await finalizeAndVerify(client, auctionAddress)

			// Regression test: withdraw should succeed without reverting even when the
			// clearing price is zero.
			const amounts = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick: zeroPriceTick, bidIndex: 0n }])
			assert.strictEqual(amounts.totalFilledRep, 1n, 'zero-price clearing bids should receive the full underfunded REP allocation')
			assert.strictEqual(amounts.totalEthRefund, 0n, 'zero-price clearing winners should not receive an ETH refund')

			// Actual withdrawBids should also succeed
			await withdrawBids(client, auctionAddress, client.account.address, [{ tick: zeroPriceTick, bidIndex: 0n }])
			await assertContractEmpty(client, auctionAddress)
		})

		test('computeClearing should not revert with zero-price bid', async () => {
			const ethRaiseCap = 1000n * ATTOETH_PER_ETH
			const maxRepBeingSold = 1n // 1 wei REP
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)
			const zeroPriceTick = -450000n
			await submitBid(client, auctionAddress, zeroPriceTick, 1n * ATTOETH_PER_ETH)
			// Should not revert due to division by zero
			const result = await computeClearing(client, auctionAddress)
			// With zero price, no rep can be sold, so hitCap should be false
			assert.strictEqual(result.hitCap, false, 'no clearing price when all bids have zero price')
		})

		test('zero-price bids (non-clearing) should get full refund', async () => {
			const ethRaiseCap = 100n * ATTOETH_PER_ETH
			// Set target low enough that 1 ETH at tick 0 exceeds it
			const maxRepBeingSold = ATTOETH_PER_ETH / 2n // 0.5 ETH worth of REP
			await startAuction(client, auctionAddress, ethRaiseCap, maxRepBeingSold)

			// Zero-price tick (very negative)
			const zeroPriceTick = -450000n
			const zeroPriceBidAmount = 1n * ATTOETH_PER_ETH
			await submitBid(client, auctionAddress, zeroPriceTick, zeroPriceBidAmount)

			// Winning bid with enough ETH to meet/exceed rep target
			const winningTick = 0n
			const winningAmount = 1n * ATTOETH_PER_ETH // yields 1 REP wei at price 1, > 0.5 target
			await submitBid(client, auctionAddress, winningTick, winningAmount)

			await finalizeAndVerify(client, auctionAddress)

			const clearingTick = await getClearingTick(client, auctionAddress)
			// Clearing tick should be the winning bid's tick (0), not the zero-price tick
			assert.strictEqual(clearingTick, winningTick, 'clearing tick should be winning tick')

			// Zero-price bid is below clearing tick, so it's a losing bid: full refund, no REP
			const amounts = await simulateWithdrawBids(client, auctionAddress, client.account.address, [{ tick: zeroPriceTick, bidIndex: 0n }])
			assert.strictEqual(amounts.totalFilledRep, 0n, 'zero-price bid: no REP filled')
			assert.strictEqual(amounts.totalEthRefund, zeroPriceBidAmount, 'zero-price bid: full ETH refund')

			await withdrawBids(client, auctionAddress, client.account.address, [{ tick: zeroPriceTick, bidIndex: 0n }])
		})
	})
})
