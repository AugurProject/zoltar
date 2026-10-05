import { describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData, getAddress, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { refundTruthAuctionBid, submitTruthAuctionBid } from '@zoltar/ui-statoblast-shared/protocol/truthAuctionActions.js'
import { statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction as auctionArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient, createBlockWithTimestamp, mockTransactionHash } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import type { TransactionPlanStep, TransactionRequestPreview } from '@zoltar/ui-core-shared/wallet/chainBackend.js'

const pool = getAddress('0x00000000000000000000000000000000000000a1')
const auction = getAddress('0x00000000000000000000000000000000000000a2')

describe('truth auction writes', () => {
	for (const bids of [
		undefined,
		[{ tick: -3n, bidIndex: 4n }],
		[
			{ tick: -3n, bidIndex: 4n },
			{ tick: 2n, bidIndex: 9n },
		],
	]) {
		test(`encodes ${bids?.length ?? 'default'} refund selection as one tuple-array argument`, async () => {
			let data: Hex | undefined
			const client = createMockWriteClient(request => {
				expect(request.to).toBe(auction)
				data = request.data
			})
			await refundTruthAuctionBid(asWriteClient(client), pool, 1n, auction, -3n, 4n, bids)
			if (data === undefined) throw new Error('Refund transaction was not submitted')
			const decoded = decodeFunctionData({ abi: auctionArtifact.abi, data })
			expect(decoded.functionName).toBe('refundLosingBids')
			expect(decoded.args).toEqual([bids ?? [{ tick: -3n, bidIndex: 4n }]])
		})
	}

	for (const { currentTimestamp, auctionStarted, finalized, expected } of [
		{ currentTimestamp: 604_800n, auctionStarted: 1n, finalized: false, expected: 'Truth auction ends too soon to submit a bid.' },
		{ currentTimestamp: 604_741n, auctionStarted: 1n, finalized: false, expected: 'Truth auction ends too soon to submit a bid.' },
		{ currentTimestamp: 604_801n, auctionStarted: 1n, finalized: false, expected: 'Truth auction has ended.' },
		{ currentTimestamp: 1n, auctionStarted: 0n, finalized: false, expected: 'Loading truth auction deadline…' },
		{ currentTimestamp: undefined, auctionStarted: 1n, finalized: false, expected: 'Loading current chain time…' },
		{ currentTimestamp: 1n, auctionStarted: 1n, finalized: true, expected: 'Truth auction is already finalized.' },
	]) {
		test(`blocks ${expected} at ${currentTimestamp} without sending`, async () => {
			const send = mock(() => undefined)
			const client = {
				...createMockWriteClient(send, async request => (request.functionName === 'auctionStarted' ? auctionStarted : finalized)),
				getBlock: async () => ({ timestamp: currentTimestamp }),
			}
			await expect(submitTruthAuctionBid(asWriteClient(client), pool, 1n, auction, 3n, 100n)).rejects.toThrow(expected)
			expect(send).not.toHaveBeenCalled()
		})
	}

	test('preserves confirmed success without a redundant receipt request', async () => {
		const client = {
			...createMockWriteClient(
				() => undefined,
				async request => (request.functionName === 'auctionStarted' ? 1n : false),
			),
			getBlock: async () => createBlockWithTimestamp(604_740n),
		}
		const wait = mock(async () => {
			if (wait.mock.calls.length > 1) throw new Error('RPC unavailable after confirmation')
			return { status: 'success' as const }
		})
		client.waitForTransactionReceipt = wait
		await expect(submitTruthAuctionBid(asWriteClient(client), pool, 1n, auction, 3n, 100n)).resolves.toEqual({ action: 'submitBid', hash: mockTransactionHash, securityPoolAddress: pool, universeId: 1n })
		expect(wait).toHaveBeenCalledTimes(1)
	})

	test('reviews the bid with its ETH amount and submitted tick price', async () => {
		const previews: TransactionRequestPreview[] = []
		const plans: (readonly TransactionPlanStep[])[] = []
		const client = {
			...asWriteClient(
				createMockWriteClient(
					() => undefined,
					async request => (request.functionName === 'auctionStarted' ? 1n : false),
				),
			),
			getBlock: async () => createBlockWithTimestamp(604_740n),
			onTransactionPlan: (steps: readonly TransactionPlanStep[]) => plans.push(steps),
			onTransactionPrepared: (preview: TransactionRequestPreview) => previews.push(preview),
		}
		await submitTruthAuctionBid(client, pool, 1n, auction, 3n, 15n * 10n ** 17n)
		const expectedTitle = 'Bid 1.5\u00a0ETH at 1.000301\u00a0ETH per REP'
		const expectedDescription = 'Locks the ETH shown below in the truth auction at your bid price. Bids can’t be cancelled: the ETH stays locked until the bid wins REP backing in the child pool or is refunded as a losing bid.'
		expect(previews.map(preview => [preview.reviewTitle, preview.reviewDescription])).toEqual([[expectedTitle, expectedDescription]])
		expect(plans.map(steps => steps.map(step => [step.reviewTitle, step.reviewDescription]))).toEqual([[[expectedTitle, expectedDescription]]])
	})

	test('still rejects a reverted bid receipt', async () => {
		const client = {
			...createMockWriteClient(
				() => undefined,
				async request => (request.functionName === 'auctionStarted' ? 1n : false),
			),
			getBlock: async () => createBlockWithTimestamp(604_740n),
		}
		client.waitForTransactionReceipt = async () => ({ status: 'reverted' })
		await expect(submitTruthAuctionBid(asWriteClient(client), pool, 1n, auction, 3n, 100n)).rejects.toThrow('Transaction reverted')
	})
})
