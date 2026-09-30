import { encodeAbiParameters, isHex, keccak256, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { tickToPrice, TRUTH_AUCTION_MAX_TICK, TRUTH_AUCTION_MIN_TICK, TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import assert from '../../testSupport/simulator/utils/assert'
import { strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { formatStorageSlot, getIntMappingStorageSlot, getUintMappingStorageSlot } from '../../testSupport/storage'
import { priceToClosestTick } from '../../testSupport/truthAuctionTicks'

export const ATTOETH_PER_ETH = 10n ** 18n
export const AUCTION_TIME = 604800n
export const LOWEST_POSITIVE_PRICE_TICK = -414486n
export const DEFAULT_TOLERANCE = 1000n

export const DEFAULT_ETH_RAISE_CAP = 25n
export const DEFAULT_MAX_REP = 100n
export const MAX_ATTO_REP = 11_000_000n * ATTOETH_PER_ETH
const AUCTION_NODES_SLOT = 0n
const AUCTION_BIDS_AT_TICK_SLOT = 1n
const AUCTION_REFUNDED_BID_PREFIX_TREE_SLOT = 2n
const AUCTION_ROOT_SLOT = 3n
const AUCTION_NEXT_ID_SLOT = 4n
const AUCTION_MAX_REP_BEING_SOLD_SLOT = 5n
export const BID_STRUCT_SLOT_COUNT = 2n
export const UINT128_BITS = 128n
export const BID_CLAIMED_OFFSET_BITS = 160n
const NODE_STRUCT_SLOT_COUNT = 8n
export const MAX_DISTINCT_TICK_COUNT = TRUTH_AUCTION_MAX_TICK - TRUTH_AUCTION_MIN_TICK + 1n
export const FINALIZE_GAS_LIMIT = 20_000_000n

type ClearingResult = { hitCap: boolean; foundTick: bigint; accumulatedBidAttoEth: bigint }

/** Independent TypeScript model of the auction clearing walk over active bids, highest tick first. */
export function computeModeledClearing(bids: readonly { tick: bigint; amount: bigint }[], maxAttoRepBeingSold: bigint, attoEthRaiseCap: bigint): ClearingResult {
	const sorted = [...bids].sort((a, b) => {
		if (b.tick > a.tick) return 1
		if (b.tick < a.tick) return -1
		return 0
	})
	let accumulatedBidAttoEth = 0n
	let lastValidTick = 0n
	let lastValidEth = 0n
	const reservePrice = (attoEthRaiseCap * TRUTH_AUCTION_PRICE_PRECISION + maxAttoRepBeingSold - 1n) / maxAttoRepBeingSold
	for (const bid of sorted) {
		const price = tickToPrice(bid.tick)
		if (price < reservePrice) continue
		let ethToTake = price === 0n ? 0n : bid.amount

		if (accumulatedBidAttoEth > 0n) {
			const repricedRep = (accumulatedBidAttoEth * TRUTH_AUCTION_PRICE_PRECISION) / price
			if (repricedRep > maxAttoRepBeingSold) return { hitCap: true, foundTick: lastValidTick, accumulatedBidAttoEth: lastValidEth }
		}
		if (accumulatedBidAttoEth >= attoEthRaiseCap) return { hitCap: true, foundTick: lastValidTick, accumulatedBidAttoEth: lastValidEth }

		const remainingCap = attoEthRaiseCap - accumulatedBidAttoEth
		if (ethToTake > remainingCap) ethToTake = remainingCap
		const newAccumulatedEth = accumulatedBidAttoEth + ethToTake
		const totalAttoRep = price === 0n ? 0n : (newAccumulatedEth * TRUTH_AUCTION_PRICE_PRECISION) / price
		if (totalAttoRep >= maxAttoRepBeingSold) {
			const maxEthAtThisPrice = (maxAttoRepBeingSold * price) / TRUTH_AUCTION_PRICE_PRECISION
			let ethUsedAtClearing = maxEthAtThisPrice > accumulatedBidAttoEth ? maxEthAtThisPrice - accumulatedBidAttoEth : 0n
			if (ethUsedAtClearing > ethToTake) ethUsedAtClearing = ethToTake
			return { hitCap: true, foundTick: bid.tick, accumulatedBidAttoEth: accumulatedBidAttoEth + ethUsedAtClearing }
		}
		if (newAccumulatedEth >= attoEthRaiseCap) return { hitCap: true, foundTick: bid.tick, accumulatedBidAttoEth: newAccumulatedEth }

		accumulatedBidAttoEth = newAccumulatedEth
		lastValidTick = bid.tick
		lastValidEth = accumulatedBidAttoEth
	}
	return { hitCap: false, foundTick: lastValidTick, accumulatedBidAttoEth }
}

export const requireTransactionHash = (value: unknown): Hash => {
	if (typeof value !== 'string' || !isHex(value, { strict: true }) || value.length !== 66) throw new Error('Anvil returned an invalid transaction hash')
	return `0x${value.slice(2)}`
}

export function tickForPrice(price: bigint): bigint {
	return priceToClosestTick(price)
}

export function tickAtOrAbovePrice(price: bigint): bigint {
	const closestTick = tickForPrice(price)
	return tickToPrice(closestTick) >= price ? closestTick : closestTick + 1n
}

export function assertClearing(clearing: ClearingResult, expectedHitCap: boolean, expectedTick?: bigint, expectedAccumulatedAttoEth?: bigint) {
	strictEqualTypeSafe(clearing.hitCap, expectedHitCap, 'clearing.hitCap mismatch')
	if (expectedHitCap && expectedTick !== undefined) strictEqualTypeSafe(clearing.foundTick, expectedTick, 'clearing.foundTick mismatch')
	if (expectedAccumulatedAttoEth !== undefined) strictEqualTypeSafe(clearing.accumulatedBidAttoEth, expectedAccumulatedAttoEth, 'clearing.accumulatedBidAttoEth mismatch')
}

export function assertExpectedClearing(clearing: ClearingResult, expectedTick: bigint, expectedAccumulatedAttoEth?: bigint): void {
	assertClearing(clearing, true)
	if (clearing.hitCap) strictEqualTypeSafe(clearing.foundTick, expectedTick, 'clearing tick mismatch')
	if (expectedAccumulatedAttoEth !== undefined) strictEqualTypeSafe(clearing.accumulatedBidAttoEth, expectedAccumulatedAttoEth, 'accumulatedBidAttoEth mismatch')
}

export function assertWithdrawal(amounts: { totalFilledAttoRep: bigint; totalRefundAttoEth: bigint }, expectedFilledAttoRep: bigint, expectedRefund: bigint) {
	strictEqualTypeSafe(amounts.totalFilledAttoRep, expectedFilledAttoRep, 'filledRep mismatch')
	strictEqualTypeSafe(amounts.totalRefundAttoEth, expectedRefund, 'ethRefund mismatch')
}

export function computeClearingTickEthUsed(bidSize: bigint, activeCumulativeEthBeforeBid: bigint, ethFilledAtClearingAttoEth: bigint): bigint {
	const cumulativeEth = activeCumulativeEthBeforeBid + bidSize
	if (ethFilledAtClearingAttoEth <= activeCumulativeEthBeforeBid) return 0n
	if (ethFilledAtClearingAttoEth >= cumulativeEth) return bidSize
	return ethFilledAtClearingAttoEth - activeCumulativeEthBeforeBid
}

export function assertClearingTickInRange(tick: bigint): void {
	assert.ok(tick >= TRUTH_AUCTION_MIN_TICK && tick <= TRUTH_AUCTION_MAX_TICK, `clearing tick ${tick} outside [${TRUTH_AUCTION_MIN_TICK}, ${TRUTH_AUCTION_MAX_TICK}]`)
}

// ============ Storage layout helpers ============

/** Base storage slot of the AVL tree node `nodeId` in the auction `nodes` mapping. */
export const getAuctionNodeBaseSlot = (nodeId: bigint) => getUintMappingStorageSlot(nodeId, AUCTION_NODES_SLOT)

/** First data slot of the dynamic `bidsAtTick[tick]` array. */
export const getBidDataStartSlot = (tick: bigint) => BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }], [formatStorageSlot(getIntMappingStorageSlot(tick, AUCTION_BIDS_AT_TICK_SLOT))])))

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

/** Storage diff for the refunded-bid prefix Fenwick tree at `tick`, marking the first `refundedBidCount` equal-sized bids as refunded. */
export const buildRefundedTreeStateDiff = (tick: bigint, bidCount: bigint, refundedBidCount: bigint, bidAmount: bigint) => {
	const refundedTreeOuterSlot = formatStorageSlot(getIntMappingStorageSlot(tick, AUCTION_REFUNDED_BID_PREFIX_TREE_SLOT))
	const stateDiff: Record<string, bigint> = {}
	for (const [treeIndex, value] of buildFenwickTreeEntries(bidCount, refundedBidCount, bidAmount)) {
		const treeSlot = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [treeIndex, refundedTreeOuterSlot]))
		stateDiff[treeSlot] = value
	}
	return stateDiff
}

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

export const getMaxAvlHeightWithinNodeCap = (nodeCap: bigint): bigint => {
	let height = 0n
	while (getMinAvlNodesForHeight(height + 1n) <= nodeCap) {
		height++
	}
	return height
}

export const buildSyntheticWorstCaseFinalizeStateDiff = (height: bigint, bidAmount: bigint, maxAttoRepBeingSold: bigint = 1n, attoEthRaiseCap: bigint = height * bidAmount + bidAmount) => {
	const stateDiff: Record<string, bigint> = {
		[formatStorageSlot(AUCTION_ROOT_SLOT)]: 1n,
		[formatStorageSlot(AUCTION_NEXT_ID_SLOT)]: height + 1n,
		[formatStorageSlot(AUCTION_MAX_REP_BEING_SOLD_SLOT)]: maxAttoRepBeingSold | (attoEthRaiseCap << 88n),
	}

	for (let nodeId = 1n; nodeId <= height; nodeId++) {
		const remainingNodes = height - nodeId + 1n
		const nodeBaseSlot = getAuctionNodeBaseSlot(nodeId)
		const tick = nodeId - 1n
		const values = [tick, bidAmount, remainingNodes * bidAmount, 0n, nodeId === height ? 0n : nodeId + 1n, remainingNodes, remainingNodes * bidAmount, tick]

		strictEqualTypeSafe(BigInt(values.length), NODE_STRUCT_SLOT_COUNT, 'synthetic node slot count mismatch')
		for (let index = 0; index < values.length; index++) {
			stateDiff[formatStorageSlot(nodeBaseSlot + BigInt(index))] = values[index] ?? 0n
		}
	}

	return stateDiff
}
