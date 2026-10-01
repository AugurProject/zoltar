import { beforeEach, describe, test } from 'bun:test'
import { encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { computeClearing, deployUniformPriceDualCapBatchAuction, finalize, getActiveTickPage, getBidPageAtTick, getEthRaisedAttoEth, getTickSummary, getTotalRepPurchasedAttoRep, isFinalized, refundLosingBids, startAuction, submitBid, withdrawBids } from '../../testSupport/simulator/utils/contracts/auction'
import { getUniformPriceDualCapBatchAuctionAddress } from '../../testSupport/simulator/utils/contracts/deployments'
import { ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction, test_statoblast_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact } from '../../types/contractArtifact'
import { useAuctionFixture } from './fixture'
import { ATTOETH_PER_ETH, AUCTION_TIME, MAX_ATTO_REP } from './model'

describe('UniformPriceDualCapBatchAuction: Auction Management', () => {
	const fixture = useAuctionFixture()
	const { createTestClient, deployRejectingEthReceiver, executeThroughReceiver, decodeAuctionEvents, finalizeAndVerify } = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let auctionAddress: Address

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		auctionAddress = fixture.auctionAddress
	})

	test('startAuction validation', async () => {
		const attoEthRaiseCap = 100n * 10n ** 18n
		const maxAttoRepBeingSold = 10n * 10n ** 18n

		const attacker = createTestClient(1)
		await assert.rejects(async () => await startAuction(attacker, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold), /Only the auction owner can start the auction/)
		await assert.rejects(async () => await startAuction(client, auctionAddress, 0n, maxAttoRepBeingSold), /Auction ETH raise cap and REP sale cap must both be positive/)
		await assert.rejects(async () => await startAuction(client, auctionAddress, attoEthRaiseCap, 0n), /Auction ETH raise cap and REP sale cap must both be positive/)
		await assert.rejects(async () => await startAuction(client, auctionAddress, attoEthRaiseCap, MAX_ATTO_REP + 1n), /Auction REP sale cap too high/)
		await assert.rejects(async () => await startAuction(client, auctionAddress, 1n << 128n, maxAttoRepBeingSold), /Auction ETH raise cap too high/)

		await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold)

		await assert.rejects(async () => await startAuction(client, auctionAddress, attoEthRaiseCap, maxAttoRepBeingSold), /Auction has already been started/)
	})

	test('finalization and withdrawal guards reject repeats, wrong beneficiaries, missing indices, and claimed bids', async () => {
		const tick = 0n
		const bidAmount = 2n * ATTOETH_PER_ETH
		await startAuction(client, auctionAddress, bidAmount, 10n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, tick, bidAmount)
		await finalizeAndVerify(client, auctionAddress)

		await assert.rejects(finalize(client, auctionAddress), /Auction has already been finalized/)
		await assert.rejects(withdrawBids(client, auctionAddress, addressString(TEST_ADDRESSES[1]), [{ tick, bidIndex: 0n }]), /Bid does not belong to the requested withdrawal address/)
		await assert.rejects(withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 1n }]), /panic: array out-of-bounds access \(0x32\)/)

		await withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }])
		await assert.rejects(withdrawBids(client, auctionAddress, client.account.address, [{ tick, bidIndex: 0n }]), /Bid has already been claimed or does not exist/)
	})

	test('pre-finalization refund guards cover owner delegation, lifecycle, clearing, bidder identity, and repeats', async () => {
		const attacker = createTestClient(1)
		const losingBidder = createTestClient(2)
		const tickIndices = [{ tick: -10_000n, bidIndex: 0n }]
		const auctionAbi = statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi

		await assert.rejects(refundLosingBids(client, auctionAddress, []), /Auction must be started before refunding losing bids/)
		await startAuction(client, auctionAddress, 2n * ATTOETH_PER_ETH, 10n * ATTOETH_PER_ETH)
		await assert.rejects(refundLosingBids(client, auctionAddress, []), /Auction has not reached a clearing price yet/)
		await assert.rejects(
			attacker.writeContract({
				abi: auctionAbi,
				address: auctionAddress,
				functionName: 'refundLosingBidsFor',
				args: [losingBidder.account.address, []],
			}),
			/Only the auction owner can refund losing bids on behalf of bidders/,
		)

		await submitBid(client, auctionAddress, 0n, 2n * ATTOETH_PER_ETH)
		await submitBid(losingBidder, auctionAddress, -10_000n, ATTOETH_PER_ETH)
		await assert.rejects(
			client.writeContract({
				abi: auctionAbi,
				address: auctionAddress,
				functionName: 'refundLosingBidsFor',
				args: [addressString(0n), []],
			}),
			/Auction bidder address must not be the zero address/,
		)
		await assert.rejects(
			client.writeContract({
				abi: auctionAbi,
				address: auctionAddress,
				functionName: 'refundLosingBidsFor',
				args: [attacker.account.address, tickIndices],
			}),
			/Bid does not belong to the requested refund bidder/,
		)
		await assert.rejects(refundLosingBids(client, auctionAddress, [{ tick: 0n, bidIndex: 0n }]), /Binding or winning bid cannot be refunded before finalization/)

		await refundLosingBids(losingBidder, auctionAddress, tickIndices)
		await assert.rejects(refundLosingBids(losingBidder, auctionAddress, tickIndices), /Bid has already been withdrawn or does not exist/)

		await finalizeAndVerify(client, auctionAddress)
		await assert.rejects(refundLosingBids(client, auctionAddress, []), /Auction has already been finalized/)
	})

	test('settlement credits rejecting bidders without calling them while owner rejection still rolls back finalization', async () => {
		const auctionAbi = statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi
		const rejectingReceiver = await deployRejectingEthReceiver()
		await deployUniformPriceDualCapBatchAuction(client, rejectingReceiver)
		const rejectingOwnerAuction = getUniformPriceDualCapBatchAuctionAddress(rejectingReceiver)
		const winningBid = 2n * ATTOETH_PER_ETH
		const losingBid = ATTOETH_PER_ETH
		const losingTick = -10_000n
		const startData = encodeFunctionData({
			abi: auctionAbi,
			functionName: 'startAuction',
			args: [winningBid, 10n * ATTOETH_PER_ETH],
		})
		await executeThroughReceiver(rejectingReceiver, rejectingOwnerAuction, startData)
		await submitBid(client, rejectingOwnerAuction, 0n, winningBid)
		await executeThroughReceiver(rejectingReceiver, rejectingOwnerAuction, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [losingTick] }), losingBid)
		await mockWindow.advanceTime(AUCTION_TIME + 1n)

		const auctionBalanceBeforeFailedFinalize = await getETHBalance(client, rejectingOwnerAuction)
		await assert.rejects(executeThroughReceiver(rejectingReceiver, rejectingOwnerAuction, encodeFunctionData({ abi: auctionAbi, functionName: 'finalize', args: [] })), /Auction failed to send raised ETH to the owner/)
		assert.strictEqual(await isFinalized(client, rejectingOwnerAuction), false, 'failed owner payment must roll back finalization')
		assert.strictEqual(await getEthRaisedAttoEth(client, rejectingOwnerAuction), 0n, 'failed owner payment must roll back raised ETH accounting')
		assert.strictEqual(await getTotalRepPurchasedAttoRep(client, rejectingOwnerAuction), 0n, 'failed owner payment must roll back purchased REP accounting')
		assert.strictEqual(await getETHBalance(client, rejectingOwnerAuction), auctionBalanceBeforeFailedFinalize, 'failed owner payment must preserve auction ETH')

		await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: rejectingReceiver,
			functionName: 'setRejectETH',
			args: [false],
		})
		await executeThroughReceiver(rejectingReceiver, rejectingOwnerAuction, encodeFunctionData({ abi: auctionAbi, functionName: 'finalize', args: [] }))
		await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: rejectingReceiver,
			functionName: 'setRejectETH',
			args: [true],
		})

		const auctionBalanceBeforeDeferredWithdrawal = await getETHBalance(client, rejectingOwnerAuction)
		await executeThroughReceiver(
			rejectingReceiver,
			rejectingOwnerAuction,
			encodeFunctionData({
				abi: auctionAbi,
				functionName: 'withdrawBids',
				args: [rejectingReceiver, [{ tick: losingTick, bidIndex: 0n }], 0n, 0n, 0n],
			}),
		)
		const losingBidAfterWithdrawal = ensureDefined((await getBidPageAtTick(client, rejectingOwnerAuction, losingTick, 0n, 1n))[0], 'missing rejecting receiver bid after withdrawal')
		assert.strictEqual(losingBidAfterWithdrawal.claimed, true, 'refund rejection must not roll back finalized bid settlement')
		assert.strictEqual(
			await client.readContract({
				abi: auctionAbi,
				address: rejectingOwnerAuction,
				functionName: 'pendingEthRefundsAttoEth',
				args: [rejectingReceiver],
			}),
			losingBid,
			'rejected finalized refund should remain withdrawable from auction escrow',
		)
		assert.strictEqual(await getETHBalance(client, rejectingOwnerAuction), auctionBalanceBeforeDeferredWithdrawal, 'deferred finalized refund must remain held by the auction')
		await assert.rejects(executeThroughReceiver(rejectingReceiver, rejectingOwnerAuction, encodeFunctionData({ abi: auctionAbi, functionName: 'withdrawPendingEthRefund', args: [] })), /Auction failed to withdraw credited ETH refund/)
		await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: rejectingReceiver,
			functionName: 'setRejectETH',
			args: [false],
		})
		const receiverBalanceBeforeDeferredWithdrawal = await getETHBalance(client, rejectingReceiver)
		await executeThroughReceiver(rejectingReceiver, rejectingOwnerAuction, encodeFunctionData({ abi: auctionAbi, functionName: 'withdrawPendingEthRefund', args: [] }))
		assert.strictEqual((await getETHBalance(client, rejectingReceiver)) - receiverBalanceBeforeDeferredWithdrawal, losingBid, 'the bidder should be able to pull the deferred finalized refund after accepting ETH')
		assert.strictEqual(
			await client.readContract({
				abi: auctionAbi,
				address: rejectingOwnerAuction,
				functionName: 'pendingEthRefundsAttoEth',
				args: [rejectingReceiver],
			}),
			0n,
			'successful deferred withdrawal should clear the bidder escrow',
		)

		await startAuction(client, auctionAddress, winningBid, 10n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, 0n, winningBid)
		await executeThroughReceiver(rejectingReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [losingTick] }), losingBid)
		await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: rejectingReceiver,
			functionName: 'setRejectETH',
			args: [true],
		})
		const activeEthBeforeDeferredRefund = (await getActiveTickPage(client, auctionAddress, 0n, 100n)).reduce((sum, tick) => sum + tick.currentTotalBidAttoEth, 0n)
		const clearingBeforeRefund = await computeClearing(client, auctionAddress)
		assert.strictEqual(clearingBeforeRefund.hitCap, true, 'the higher bid should establish a funded clearing before the losing refund')
		const balanceBeforeDeferredRefund = await getETHBalance(client, auctionAddress)
		strictEqualTypeSafe(activeEthBeforeDeferredRefund, winningBid + losingBid, 'all pre-refund ETH should remain in active bid liabilities')
		strictEqualTypeSafe(balanceBeforeDeferredRefund, activeEthBeforeDeferredRefund, 'pre-finalization raw ETH should initially equal active bid liabilities')
		await executeThroughReceiver(
			rejectingReceiver,
			auctionAddress,
			encodeFunctionData({
				abi: auctionAbi,
				functionName: 'refundLosingBids',
				args: [[{ tick: losingTick, bidIndex: 0n }]],
			}),
		)
		const losingBidAfterRefund = ensureDefined((await getBidPageAtTick(client, auctionAddress, losingTick, 0n, 1n))[0], 'missing rejecting receiver bid after refund')
		const clearingAfterRefund = await computeClearing(client, auctionAddress)
		assert.strictEqual(losingBidAfterRefund.claimed, true, 'refund rejection must not roll back a pre-finalization losing-bid refund')
		assert.strictEqual(clearingAfterRefund.hitCap, true, 'deferred losing refunds must preserve the funded clearing')
		assert.strictEqual((await getTickSummary(client, auctionAddress, losingTick)).active, false, 'settled losing bids should remain removed from active clearing state')
		assert.strictEqual(await getETHBalance(client, auctionAddress), balanceBeforeDeferredRefund, 'deferred pre-finalization refund must remain held by the auction')
		const pendingPreFinalizationRefund = await client.readContract({
			abi: auctionAbi,
			address: auctionAddress,
			functionName: 'pendingEthRefundsAttoEth',
			args: [rejectingReceiver],
		})
		assert.strictEqual(pendingPreFinalizationRefund, losingBid, 'rejected pre-finalization refund should remain withdrawable from auction escrow')
		const activeEthAfterDeferredRefund = (await getActiveTickPage(client, auctionAddress, 0n, 100n)).reduce((sum, tick) => sum + tick.currentTotalBidAttoEth, 0n)
		strictEqualTypeSafe(activeEthAfterDeferredRefund, winningBid, 'deferred refunds should leave only the qualifying bid in active liabilities')
		strictEqualTypeSafe(await getETHBalance(client, auctionAddress), activeEthAfterDeferredRefund + pendingPreFinalizationRefund, 'pre-finalization raw ETH should equal active bids plus deferred refunds')

		await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: rejectingReceiver,
			functionName: 'setRejectETH',
			args: [false],
		})
		await executeThroughReceiver(
			rejectingReceiver,
			auctionAddress,
			encodeFunctionData({
				abi: auctionAbi,
				functionName: 'withdrawPendingEthRefund',
				args: [],
			}),
		)
		strictEqualTypeSafe(
			await client.readContract({
				abi: auctionAbi,
				address: auctionAddress,
				functionName: 'pendingEthRefundsAttoEth',
				args: [rejectingReceiver],
			}),
			0n,
			'the successful pull should clear the pre-finalization deferred liability',
		)
		strictEqualTypeSafe(await getETHBalance(client, auctionAddress), activeEthAfterDeferredRefund, 'pulling the deferred refund should leave exactly the active bid liability')
	})

	test('gas-exhausting losing bidders cannot block pre-finalization refund accounting', async () => {
		const auctionAbi = statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi
		const gasExhaustingReceiver = await deployRejectingEthReceiver()
		const winningBid = 2n * ATTOETH_PER_ETH
		const losingBid = ATTOETH_PER_ETH
		const losingTick = -10_000n

		await startAuction(client, auctionAddress, winningBid, 10n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, 0n, winningBid)
		await executeThroughReceiver(gasExhaustingReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [losingTick] }), losingBid)
		await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: gasExhaustingReceiver,
			functionName: 'setConsumeAllGas',
			args: [true],
		})

		await executeThroughReceiver(
			gasExhaustingReceiver,
			auctionAddress,
			encodeFunctionData({
				abi: auctionAbi,
				functionName: 'refundLosingBids',
				args: [[{ tick: losingTick, bidIndex: 0n }]],
			}),
			0n,
			500_000n,
		)

		const settledBid = ensureDefined((await getBidPageAtTick(client, auctionAddress, losingTick, 0n, 1n))[0], 'missing gas-exhausting receiver bid after refund')
		assert.strictEqual(settledBid.claimed, true, 'gas exhaustion must not roll back the losing bid settlement')
		assert.strictEqual((await getTickSummary(client, auctionAddress, losingTick)).active, false, 'gas exhaustion must not restore the settled bid to active clearing state')
		assert.strictEqual(
			await client.readContract({
				abi: auctionAbi,
				address: auctionAddress,
				functionName: 'pendingEthRefundsAttoEth',
				args: [gasExhaustingReceiver],
			}),
			losingBid,
			'the gas-exhausting bidder refund should remain in pull escrow',
		)
	})

	test('one multi-bid refund call emits one aggregate credit event', async () => {
		const auctionAbi = statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi
		const refundReceiver = await deployRejectingEthReceiver()
		const winningBid = 3n * ATTOETH_PER_ETH
		const firstLosingBid = ATTOETH_PER_ETH
		const secondLosingBid = 2n * ATTOETH_PER_ETH
		const firstLosingTick = -10_000n
		const secondLosingTick = -11_000n

		await startAuction(client, auctionAddress, winningBid, 10n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, 0n, winningBid)
		await executeThroughReceiver(refundReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [firstLosingTick] }), firstLosingBid)
		await executeThroughReceiver(refundReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [secondLosingTick] }), secondLosingBid)

		const refundHash = await executeThroughReceiver(
			refundReceiver,
			auctionAddress,
			encodeFunctionData({
				abi: auctionAbi,
				functionName: 'refundLosingBids',
				args: [
					[
						{ tick: firstLosingTick, bidIndex: 0n },
						{ tick: secondLosingTick, bidIndex: 0n },
					],
				],
			}),
		)
		const refundEvents = (await decodeAuctionEvents(refundHash)).filter(log => log.eventName === 'EthRefundCredited')
		assert.strictEqual(refundEvents.length, 1, 'one settlement call should emit one aggregate refund-credit event')
		const refundEvent = ensureDefined(refundEvents[0], 'missing aggregate refund-credit event')
		if (refundEvent.eventName !== 'EthRefundCredited') throw new Error('unexpected aggregate refund-credit event')
		assert.strictEqual(refundEvent.args.amountAttoEth, firstLosingBid + secondLosingBid, 'the credit event should aggregate every refund processed by the call')
		assert.strictEqual(refundEvent.args.pendingAmountAttoEth, firstLosingBid + secondLosingBid, 'the aggregate event should report the resulting bidder liability')
	})

	test('separate refund credits accumulate until the bidder pulls the complete balance', async () => {
		const auctionAbi = statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi
		const rejectingReceiver = await deployRejectingEthReceiver()
		const winningBid = 3n * ATTOETH_PER_ETH
		const firstLosingBid = ATTOETH_PER_ETH
		const secondLosingBid = 2n * ATTOETH_PER_ETH
		const firstLosingTick = -10_000n
		const secondLosingTick = -11_000n
		const totalDeferredRefund = firstLosingBid + secondLosingBid

		await startAuction(client, auctionAddress, winningBid, 10n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, 0n, winningBid)
		await executeThroughReceiver(rejectingReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [firstLosingTick] }), firstLosingBid)
		await executeThroughReceiver(rejectingReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [secondLosingTick] }), secondLosingBid)

		await executeThroughReceiver(
			rejectingReceiver,
			auctionAddress,
			encodeFunctionData({
				abi: auctionAbi,
				functionName: 'refundLosingBids',
				args: [[{ tick: firstLosingTick, bidIndex: 0n }]],
			}),
		)
		const secondRefundHash = await executeThroughReceiver(
			rejectingReceiver,
			auctionAddress,
			encodeFunctionData({
				abi: auctionAbi,
				functionName: 'refundLosingBids',
				args: [[{ tick: secondLosingTick, bidIndex: 0n }]],
			}),
		)

		const secondDeferredEvent = (await decodeAuctionEvents(secondRefundHash)).find(log => log.eventName === 'EthRefundCredited')
		if (secondDeferredEvent?.eventName !== 'EthRefundCredited') throw new Error('missing second refund-credit event')
		assert.strictEqual(secondDeferredEvent.args.amountAttoEth, secondLosingBid, 'the second event should report only the newly deferred refund')
		assert.strictEqual(secondDeferredEvent.args.pendingAmountAttoEth, totalDeferredRefund, 'the second event should report the complete cumulative refund liability')
		assert.strictEqual(
			await client.readContract({
				abi: auctionAbi,
				address: auctionAddress,
				functionName: 'pendingEthRefundsAttoEth',
				args: [rejectingReceiver],
			}),
			totalDeferredRefund,
			'separate credits must add to the existing bidder liability',
		)

		await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: rejectingReceiver,
			functionName: 'setRejectETH',
			args: [false],
		})
		const receiverBalanceBeforePull = await getETHBalance(client, rejectingReceiver)
		await executeThroughReceiver(rejectingReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'withdrawPendingEthRefund', args: [] }))
		assert.strictEqual((await getETHBalance(client, rejectingReceiver)) - receiverBalanceBeforePull, totalDeferredRefund, 'the pull path should pay every separately accumulated refund')
		assert.strictEqual(
			await client.readContract({
				abi: auctionAbi,
				address: auctionAddress,
				functionName: 'pendingEthRefundsAttoEth',
				args: [rejectingReceiver],
			}),
			0n,
			'the complete accumulated liability should clear after a successful pull',
		)
	})

	test('refund-credit events remain reducer-safe when a pull callback settles another bid', async () => {
		const auctionAbi = statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi
		const reentrantReceiver = await deployRejectingEthReceiver()
		const winningBid = 2n * ATTOETH_PER_ETH
		const firstLosingBid = ATTOETH_PER_ETH
		const secondLosingBid = 2n * ATTOETH_PER_ETH
		const firstLosingTick = -10_000n
		const secondLosingTick = -11_000n

		await startAuction(client, auctionAddress, winningBid, 10n * ATTOETH_PER_ETH)
		await submitBid(client, auctionAddress, 0n, winningBid)
		await executeThroughReceiver(reentrantReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [firstLosingTick] }), firstLosingBid)
		await executeThroughReceiver(reentrantReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [secondLosingTick] }), secondLosingBid)

		await executeThroughReceiver(
			reentrantReceiver,
			auctionAddress,
			encodeFunctionData({
				abi: auctionAbi,
				functionName: 'refundLosingBids',
				args: [[{ tick: firstLosingTick, bidIndex: 0n }]],
			}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: auctionAbi,
				address: auctionAddress,
				functionName: 'pendingEthRefundsAttoEth',
				args: [reentrantReceiver],
			}),
			firstLosingBid,
			'the first credit should establish the replay starting balance',
		)

		await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: reentrantReceiver,
			functionName: 'setReceiveReentry',
			args: [
				auctionAddress,
				encodeFunctionData({
					abi: auctionAbi,
					functionName: 'refundLosingBids',
					args: [[{ tick: secondLosingTick, bidIndex: 0n }]],
				}),
			],
		})
		const pullHash = await executeThroughReceiver(reentrantReceiver, auctionAddress, encodeFunctionData({ abi: auctionAbi, functionName: 'withdrawPendingEthRefund', args: [] }))

		let reconstructedPendingRefund = firstLosingBid
		for (const log of await decodeAuctionEvents(pullHash)) {
			if (log.eventName === 'PendingEthRefundWithdrawn') {
				assert.strictEqual(log.args.amountAttoEth, reconstructedPendingRefund, 'a withdrawal event must clear the complete prior liability')
				reconstructedPendingRefund = 0n
			}
			if (log.eventName === 'EthRefundCredited') {
				assert.strictEqual(log.args.pendingAmountAttoEth, reconstructedPendingRefund + log.args.amountAttoEth, 'a refund-credit event must add its delta to the prior liability')
				reconstructedPendingRefund = log.args.pendingAmountAttoEth
			}
		}

		const onchainPendingRefund = await client.readContract({
			abi: auctionAbi,
			address: auctionAddress,
			functionName: 'pendingEthRefundsAttoEth',
			args: [reentrantReceiver],
		})
		assert.strictEqual(onchainPendingRefund, secondLosingBid, 'the reentrant refund credit should remain withdrawable')
		assert.strictEqual(reconstructedPendingRefund, onchainPendingRefund, 'ordered auction events must reconstruct the final refund-credit liability')
	})
})
