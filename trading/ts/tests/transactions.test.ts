import { describe, expect, test } from 'bun:test'
import { enterPositionRequest, requireFreshSimulation, simulateAuthoritatively } from '../sdk/transactions.ts'

const address = `0x${'12'.repeat(20)}` as const

describe('authoritative router simulation', () => {
	test('rejects a quote after the block changes', async () => {
		let block = 10n
		const client = { getBlockNumber: async () => block, simulate: async () => ({ totalLongShares: 42n }) }
		const request = enterPositionRequest(address, address, 'YES', 1n, 1n, address, 100n)
		const simulation = await simulateAuthoritatively(client, request)
		block = 11n
		await expect(requireFreshSimulation(client, simulation)).rejects.toThrow('Quote is stale')
	})

	test('rejects a block transition during simulation', async () => {
		let block = 10n
		const client = {
			getBlockNumber: async () => block,
			simulate: async () => {
				block = 11n
				return { totalLongShares: 42n }
			},
		}
		const request = enterPositionRequest(address, address, 'YES', 1n, 1n, address, 100n)
		await expect(simulateAuthoritatively(client, request)).rejects.toThrow('Block changed during simulation')
	})
})
