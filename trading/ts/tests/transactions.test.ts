import { describe, expect, test } from 'bun:test'
import { enterPositionRequest, migrateSharesRequest, redeemCompleteSetRequest, redeemWinningSharesRequest, requireFreshSimulation, simulateAuthoritatively } from '../sdk/transactions.ts'

const address = `0x${'12'.repeat(20)}` as const

describe('authoritative router simulation', () => {
	test('rejects a quote after the block changes', async () => {
		let block = 10n
		const hash = `0x${'11'.repeat(32)}` as const
		let simulatedAt: `0x${string}` | undefined
		const client = {
			getBlock: async () => ({ number: block, hash }),
			simulate: async (_request: unknown, blockHash: `0x${string}`) => {
				simulatedAt = blockHash
				return { totalLongShares: 42n }
			},
		}
		const request = enterPositionRequest(address, address, 'YES', 1n, 1n, address, 100n)
		const simulation = await simulateAuthoritatively(client, request)
		expect(simulatedAt).toBe(hash)
		block = 11n
		await expect(requireFreshSimulation(client, simulation)).rejects.toThrow('Quote is stale')
	})

	test('rejects a block transition during simulation', async () => {
		let block = 10n
		const hash = `0x${'11'.repeat(32)}` as const
		const client = {
			getBlock: async () => ({ number: block, hash }),
			simulate: async () => {
				block = 11n
				return { totalLongShares: 42n }
			},
		}
		const request = enterPositionRequest(address, address, 'YES', 1n, 1n, address, 100n)
		await expect(simulateAuthoritatively(client, request)).rejects.toThrow('Block changed during simulation')
	})

	test('rejects a same-height block-hash transition during simulation', async () => {
		let read = 0
		const client = {
			getBlock: async () => ({ number: 10n, hash: `0x${(++read).toString().padStart(64, '0')}` as const }),
			simulate: async () => ({ totalLongShares: 42n }),
		}
		const request = enterPositionRequest(address, address, 'YES', 1n, 1n, address, 100n)
		await expect(simulateAuthoritatively(client, request)).rejects.toThrow('Block changed during simulation')
	})

	test('builds explicit settlement and single-source migration requests', () => {
		expect(redeemCompleteSetRequest(address, 5n)).toEqual({ address, functionName: 'redeemCompleteSet', args: [5n] })
		expect(redeemWinningSharesRequest(address)).toEqual({ address, functionName: 'redeemShares', args: [] })
		expect(migrateSharesRequest(address, 17n, 'NO', [3n])).toEqual({ address, functionName: 'migrate', args: [(17n << 8n) | 2n, [3n]] })
	})
})
