import { describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData, getAddress, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { refundTruthAuctionBid, submitTruthAuctionBid } from '@zoltar/ui-statoblast-shared/protocol/truthAuctionActions.js'
import { statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction as auctionArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient, mockTransactionHash } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

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

	test('preserves confirmed success without a redundant receipt request', async () => {
		const client = createMockWriteClient(() => undefined)
		const wait = mock(async () => {
			if (wait.mock.calls.length > 1) throw new Error('RPC unavailable after confirmation')
			return { status: 'success' as const }
		})
		client.waitForTransactionReceipt = wait
		await expect(submitTruthAuctionBid(asWriteClient(client), pool, 1n, auction, 3n, 100n)).resolves.toEqual({ action: 'submitBid', hash: mockTransactionHash, securityPoolAddress: pool, universeId: 1n })
		expect(wait).toHaveBeenCalledTimes(1)
	})

	test('still rejects a reverted bid receipt', async () => {
		const client = createMockWriteClient(() => undefined)
		client.waitForTransactionReceipt = async () => ({ status: 'reverted' })
		await expect(submitTruthAuctionBid(asWriteClient(client), pool, 1n, auction, 3n, 100n)).rejects.toThrow('Transaction reverted')
	})
})
