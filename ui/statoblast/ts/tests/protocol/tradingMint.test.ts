import { describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData, getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createBlockWithTimestamp, createMockWriteClient, asWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { createCompleteSetInSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/trading.js'

const pool = getAddress('0x00000000000000000000000000000000000000a1')
const manager = getAddress('0x00000000000000000000000000000000000000b1')

void describe('complete-set mint submission', () => {
	test.each([3541n, 3600n])('does not submit a mint when the oracle expires too soon at %s', async currentTimestamp => {
		const send = mock(() => undefined)
		const client = {
			...asWriteClient(
				createMockWriteClient(send, async request => {
					if (request.functionName === 'escalationGame') return zeroAddress
					if (request.functionName === 'universeId') return 1n
					if (request.functionName === 'openOraclePriceCoordinator') return manager
					if (request.functionName === 'lastSettlementTimestamp') return 1n
					throw new Error(`Unexpected read ${request.functionName}`)
				}),
			),
			getBlock: async () => createBlockWithTimestamp(currentTimestamp),
		}
		await expect(createCompleteSetInSecurityPool(client, pool, 10n ** 18n)).rejects.toThrow('expires too soon')
		expect(send).not.toHaveBeenCalled()
	})

	test('submits the selected mint amount with a fresh oracle', async () => {
		const send = mock((request: { data?: `0x${string}`; value?: bigint }) => {
			expect(request.value).toBe(10n ** 18n)
			if (request.data === undefined) throw new Error('Expected mint calldata')
			expect(decodeFunctionData({ abi: statoblast_SecurityPool_SecurityPool.abi, data: request.data }).functionName).toBe('createCompleteSet')
		})
		const client = {
			...asWriteClient(
				createMockWriteClient(send, async request => {
					if (request.functionName === 'escalationGame') return zeroAddress
					if (request.functionName === 'universeId') return 1n
					if (request.functionName === 'openOraclePriceCoordinator') return manager
					if (request.functionName === 'lastSettlementTimestamp') return 1n
					throw new Error(`Unexpected read ${request.functionName}`)
				}),
			),
			getBlock: async () => createBlockWithTimestamp(3540n),
		}
		await createCompleteSetInSecurityPool(client, pool, 10n ** 18n)
		expect(send).toHaveBeenCalledTimes(1)
	})
})
