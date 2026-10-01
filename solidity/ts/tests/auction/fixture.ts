import { beforeAll, beforeEach } from 'bun:test'
import { decodeEventLog, encodeDeployData, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { tickToPrice } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import assert from '../../testSupport/simulator/utils/assert'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { computeClearing, deployUniformPriceDualCapBatchAuction, finalize, getBidPageAtTick, isFinalized, simulateWithdrawBids, startAuction, submitBid, withdrawBids } from '../../testSupport/simulator/utils/contracts/auction'
import { ensureInfraDeployed } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getUniformPriceDualCapBatchAuctionAddress } from '../../testSupport/simulator/utils/contracts/deployments'
import { ensureZoltarDeployed } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approximatelyEqual, ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { contractExists, getETHBalance, setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { formatStorageSlot } from '../../testSupport/storage'
import { statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction, test_statoblast_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact } from '../../types/contractArtifact'
import { ATTOETH_PER_ETH, AUCTION_TIME, BID_CLAIMED_OFFSET_BITS, BID_STRUCT_SLOT_COUNT, buildRefundedTreeStateDiff, buildSyntheticWorstCaseFinalizeStateDiff, computeClearingTickEthUsed, DEFAULT_ETH_RAISE_CAP, DEFAULT_MAX_REP, DEFAULT_TOLERANCE, getAuctionNodeBaseSlot, getBidDataStartSlot, UINT128_BITS } from './model'

const auctionAbi = statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi

// ============ Chain helpers that only need a client ============

export async function submitBidAndVerifyLock(client: WriteClient, auctionAddress: Address, tick: bigint, bidAmount: bigint): Promise<bigint> {
	const before = await getETHBalance(client, client.account.address)
	await submitBid(client, auctionAddress, tick, bidAmount)
	const after = await getETHBalance(client, client.account.address)
	strictEqualTypeSafe(before - bidAmount, after, `bid ${bidAmount} not locked`)
	return before
}

export async function previewFinalization(client: WriteClient, auctionAddress: Address) {
	return await client.readContract({
		abi: auctionAbi,
		functionName: 'previewFinalization',
		address: auctionAddress,
		args: [],
	})
}

export async function assertContractEmpty(client: WriteClient, auctionAddress: Address, tolerance: bigint = 1000n): Promise<void> {
	approximatelyEqual(await getETHBalance(client, auctionAddress), 0n, tolerance, 'contract not empty')
}

export async function getPendingEthRefund(client: WriteClient, auctionAddress: Address, bidder: Address): Promise<bigint> {
	return await client.readContract({
		abi: auctionAbi,
		address: auctionAddress,
		functionName: 'pendingEthRefundsAttoEth',
		args: [bidder],
	})
}

export async function withdrawPendingEthRefund(refundClient: WriteClient, auctionAddress: Address): Promise<void> {
	if ((await getPendingEthRefund(refundClient, auctionAddress, refundClient.account.address)) === 0n) return
	const hash = await refundClient.writeContract({
		abi: auctionAbi,
		address: auctionAddress,
		functionName: 'withdrawPendingEthRefund',
	})
	await refundClient.waitForTransactionReceipt({ hash })
}

export async function setupStandardAuction(client: WriteClient, auctionAddress: Address, attoEthRaiseCap: bigint = DEFAULT_ETH_RAISE_CAP, maxAttoRepBeingSold: bigint = DEFAULT_MAX_REP): Promise<void> {
	await startAuction(client, auctionAddress, attoEthRaiseCap * ATTOETH_PER_ETH, maxAttoRepBeingSold * ATTOETH_PER_ETH)
}

// ============ Fixture ============

/**
 * Deploys Zoltar, the Statoblast infrastructure, and one UniformPriceDualCapBatchAuction owned by `TEST_ADDRESSES[0]`
 * once per file, then restores that baseline snapshot before every test.
 */
export function useAuctionFixture() {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let auctionAddress: Address

	function createTestClient(idx: number): WriteClient {
		const address = ensureDefined(TEST_ADDRESSES[idx], `TEST_ADDRESSES[${idx}] is undefined`)
		return createWriteClient(mockWindow, address)
	}

	const deployRejectingEthReceiver = async (): Promise<Address> => {
		const hash = await client.sendTransaction({
			data: encodeDeployData({
				abi: rejectingEthReceiverArtifact.abi,
				bytecode: `0x${rejectingEthReceiverArtifact.evm.bytecode.object}`,
			}),
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (typeof contractAddress !== 'string') throw new Error('rejecting ETH receiver deployment address is unavailable')
		return contractAddress
	}

	const executeThroughReceiver = async (receiver: Address, target: Address, data: Hex, value = 0n, gas?: bigint) => {
		const hash = await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: receiver,
			functionName: 'execute',
			args: [target, data],
			value,
			gas,
		})
		await client.waitForTransactionReceipt({ hash })
		return hash
	}

	async function decodeAuctionEvents(hash: Hash) {
		const receipt = await client.waitForTransactionReceipt({ hash })
		return receipt.logs
			.filter(log => log.address.toLowerCase() === auctionAddress.toLowerCase())
			.map(log =>
				decodeEventLog({
					abi: auctionAbi,
					data: log.data,
					topics: log.topics,
				}),
			)
	}

	async function finalizeAndVerify(client: WriteClient, auctionAddress: Address): Promise<void> {
		await mockWindow.advanceTime(AUCTION_TIME + 1n)
		await finalize(client, auctionAddress)
		strictEqualTypeSafe(await isFinalized(client, auctionAddress), true, 'auction not finalized')
	}

	async function assertFairPayoutForUser(auctionCreator: WriteClient, auctionAddress: Address, userId: Address, bids: { tick: bigint; bidSize: bigint; bidIndex: bigint }[], clearingTick: bigint, tolerance: bigint = DEFAULT_TOLERANCE): Promise<{ totalFilledAttoRep: bigint; totalRefundAttoEth: bigint }> {
		const clearingPrice = tickToPrice(clearingTick)
		const clearing = await computeClearing(auctionCreator, auctionAddress)
		assert.ok(clearing.hitCap, 'expected finalized auction with clearing price')
		strictEqualTypeSafe(clearing.foundTick, clearingTick, 'clearing tick mismatch')
		let totalFilledAttoRep = 0n
		let totalRefundAttoEth = 0n

		const pendingRefundBefore = await getPendingEthRefund(auctionCreator, auctionAddress, userId)
		for (const bid of bids) {
			const amounts = await simulateWithdrawBids(auctionCreator, auctionAddress, userId, [{ tick: bid.tick, bidIndex: bid.bidIndex }])

			if (bid.tick < clearingTick) {
				// Losing bid: full refund, no REP
				assert.strictEqual(amounts.totalFilledAttoRep, 0n, `Bid ${bid.bidIndex} (losing): should get 0 REP`)
				approximatelyEqual(amounts.totalRefundAttoEth, bid.bidSize, tolerance, `Bid ${bid.bidIndex} (losing): full ETH refund`)
				totalRefundAttoEth += amounts.totalRefundAttoEth
			} else if (bid.tick === clearingTick) {
				// At-clearing: partial fill, partial refund
				const bidView = ensureDefined((await getBidPageAtTick(auctionCreator, auctionAddress, bid.tick, bid.bidIndex, 1n))[0], `Bid ${bid.bidIndex} (clearing): missing bid view`)
				strictEqualTypeSafe(bidView.bidAmountAttoEth, bid.bidSize, `Bid ${bid.bidIndex} (clearing): bid size mismatch`)
				const ethUsed = computeClearingTickEthUsed(bid.bidSize, bidView.activeCumulativeBidBeforeAttoEth, clearing.bidAtClearingTickAttoEth)
				const expectedFilledAttoRep = clearingPrice === 0n ? 0n : (ethUsed * ATTOETH_PER_ETH) / clearingPrice
				if (ethUsed > 0n) assert.ok(amounts.totalFilledAttoRep >= expectedFilledAttoRep, `Bid ${bid.bidIndex} (clearing): filled REP below expected fill`)
				assert.ok(amounts.totalFilledAttoRep <= expectedFilledAttoRep + 1n, `Bid ${bid.bidIndex} (clearing): filled REP <= fill plus carried dust`)
				const expectedRefund = bid.bidSize - ethUsed
				approximatelyEqual(amounts.totalRefundAttoEth, expectedRefund, tolerance, `Bid ${bid.bidIndex} (clearing): correct ETH refund`)
				totalFilledAttoRep += amounts.totalFilledAttoRep
				totalRefundAttoEth += amounts.totalRefundAttoEth
			} else {
				// Winning bid: full REP demand, no ETH refund
				const expectedFilledAttoRep = (bid.bidSize * ATTOETH_PER_ETH) / clearingPrice
				assert.ok(amounts.totalFilledAttoRep >= expectedFilledAttoRep, `Bid ${bid.bidIndex} (winning): REP fill`)
				assert.ok(amounts.totalFilledAttoRep <= expectedFilledAttoRep + 1n, `Bid ${bid.bidIndex} (winning): REP fill plus carried dust`)
				assert.strictEqual(amounts.totalRefundAttoEth, 0n, `Bid ${bid.bidIndex} (winning): no ETH refund`)
				totalFilledAttoRep += amounts.totalFilledAttoRep
			}
			await withdrawBids(auctionCreator, auctionAddress, userId, [{ tick: bid.tick, bidIndex: bid.bidIndex }])
		}
		const pendingRefundAfter = await getPendingEthRefund(auctionCreator, auctionAddress, userId)
		approximatelyEqual(pendingRefundAfter - pendingRefundBefore, totalRefundAttoEth, tolerance, 'settlement must credit the complete refund before withdrawal')
		if (pendingRefundAfter > 0n) {
			await withdrawPendingEthRefund(createWriteClient(mockWindow, BigInt(userId)), auctionAddress)
			strictEqualTypeSafe(await getPendingEthRefund(auctionCreator, auctionAddress, userId), 0n, 'pull payment must clear the bidder refund credit')
		}
		return { totalFilledAttoRep, totalRefundAttoEth }
	}

	const deployOwnedAuction = async (clientIndex: number) => {
		const ownerClient = createTestClient(clientIndex)
		await deployUniformPriceDualCapBatchAuction(client, ownerClient.account.address)
		return { ownerClient, localAuctionAddress: getUniformPriceDualCapBatchAuctionAddress(ownerClient.account.address) }
	}

	const estimateFinalizeGas = async (ownerClient: WriteClient, localAuctionAddress: Address) =>
		await ownerClient.estimateContractGas({
			abi: auctionAbi,
			functionName: 'finalize',
			address: localAuctionAddress,
			args: [],
		})

	const estimateWithdrawGasWithManyRefundedPredecessors = async (bidCount: bigint, clientIndex: number) => {
		const { ownerClient, localAuctionAddress } = await deployOwnedAuction(clientIndex)
		const sameTick = 0n
		const bidAmount = 1n * ATTOETH_PER_ETH
		await startAuction(ownerClient, localAuctionAddress, 10n * bidAmount, bidAmount)

		for (let bidIndex = 0n; bidIndex < bidCount; bidIndex++) {
			await submitBid(ownerClient, localAuctionAddress, sameTick, bidAmount)
		}

		const bidDataStartSlot = getBidDataStartSlot(sameTick)
		const nodeBaseSlot = getAuctionNodeBaseSlot(1n)
		const stateDiff: Record<string, bigint> = {
			[formatStorageSlot(nodeBaseSlot + 1n)]: bidAmount,
			[formatStorageSlot(nodeBaseSlot + 2n)]: bidAmount,
		}

		for (let bidIndex = 0n; bidIndex < bidCount - 1n; bidIndex++) {
			const claimedSlot = bidDataStartSlot + bidIndex * BID_STRUCT_SLOT_COUNT
			const ethAmountSlot = bidDataStartSlot + bidIndex * BID_STRUCT_SLOT_COUNT + 1n
			stateDiff[formatStorageSlot(claimedSlot)] = BigInt(ownerClient.account.address) | (1n << BID_CLAIMED_OFFSET_BITS)
			stateDiff[formatStorageSlot(ethAmountSlot)] = ((bidIndex + 1n) * bidAmount) << UINT128_BITS
		}

		Object.assign(stateDiff, buildRefundedTreeStateDiff(sameTick, bidCount, bidCount - 1n, bidAmount))

		await mockWindow.addStateOverrides({
			[localAuctionAddress]: {
				stateDiff,
			},
		})

		await finalizeAndVerify(ownerClient, localAuctionAddress)

		return await ownerClient.estimateContractGas({
			abi: auctionAbi,
			functionName: 'withdrawBids',
			address: localAuctionAddress,
			args: [ownerClient.account.address, [{ bidIndex: bidCount - 1n, tick: sameTick }], 0n, 0n, 0n],
		})
	}

	const estimateFinalizeGasWithBidDistribution = async (bidCount: bigint, distinctTicks: boolean, clientIndex: number) => {
		const { ownerClient, localAuctionAddress } = await deployOwnedAuction(clientIndex)
		const bidAmount = 1n * ATTOETH_PER_ETH
		const totalBidAmount = bidCount * bidAmount
		await startAuction(ownerClient, localAuctionAddress, totalBidAmount + bidAmount, totalBidAmount + bidAmount)

		for (let bidIndex = 0n; bidIndex < bidCount; bidIndex++) {
			const tick = distinctTicks ? bidIndex : 0n
			await submitBid(ownerClient, localAuctionAddress, tick, bidAmount)
		}

		await mockWindow.advanceTime(AUCTION_TIME + 1n)

		return await estimateFinalizeGas(ownerClient, localAuctionAddress)
	}

	const estimateFinalizeGasForSyntheticWorstCaseDepth = async (height: bigint, clientIndex: number) => {
		const { ownerClient, localAuctionAddress } = await deployOwnedAuction(clientIndex)
		const bidAmount = 1n * ATTOETH_PER_ETH
		await startAuction(ownerClient, localAuctionAddress, height * bidAmount + bidAmount, 1n)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)

		await mockWindow.addStateOverrides({
			[localAuctionAddress]: {
				balance: height * bidAmount,
				stateDiff: buildSyntheticWorstCaseFinalizeStateDiff(height, bidAmount),
			},
		})

		return await estimateFinalizeGas(ownerClient, localAuctionAddress)
	}

	const estimateUnderfundedFinalizeGasForSyntheticWorstCaseDepth = async (height: bigint, clientIndex: number) => {
		const { ownerClient, localAuctionAddress } = await deployOwnedAuction(clientIndex)
		const bidAmount = 1n * ATTOETH_PER_ETH
		const totalEth = height * bidAmount
		const maxAttoRepBeingSold = totalEth + 1n
		const attoEthRaiseCap = totalEth + bidAmount
		await startAuction(ownerClient, localAuctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)

		await mockWindow.addStateOverrides({
			[localAuctionAddress]: {
				balance: totalEth,
				stateDiff: buildSyntheticWorstCaseFinalizeStateDiff(height, bidAmount, maxAttoRepBeingSold, attoEthRaiseCap),
			},
		})

		return await estimateFinalizeGas(ownerClient, localAuctionAddress)
	}

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		await setupTestAccounts(mockWindow)
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await deployUniformPriceDualCapBatchAuction(client, client.account.address)
		auctionAddress = getUniformPriceDualCapBatchAuctionAddress(client.account.address)
		assert.ok(await contractExists(client, auctionAddress), 'auction exists')
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
	})

	return {
		get mockWindow() {
			return mockWindow
		},
		get client() {
			return client
		},
		get auctionAddress() {
			return auctionAddress
		},
		createTestClient,
		deployRejectingEthReceiver,
		executeThroughReceiver,
		decodeAuctionEvents,
		finalizeAndVerify,
		assertFairPayoutForUser,
		estimateWithdrawGasWithManyRefundedPredecessors,
		estimateFinalizeGasWithBidDistribution,
		estimateFinalizeGasForSyntheticWorstCaseDepth,
		estimateUnderfundedFinalizeGasForSyntheticWorstCaseDepth,
	}
}
