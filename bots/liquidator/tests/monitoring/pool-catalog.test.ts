import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { expect, test } from 'bun:test'
import { createPublicClient, getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { loadPoolCatalog } from '#monitoring/pool-catalog'

const address = getAddress('0x1111111111111111111111111111111111111111')

function fixture(total: bigint, options: { failMetrics?: boolean; failDates?: boolean; failDeployment?: boolean; missingQuestion?: boolean; reorg?: boolean } = {}) {
	const reads: { functionName: string; args: readonly unknown[]; blockNumber: bigint }[] = []
	let blockReads = 0
	const client = new Proxy(
		createPublicClient({
			chain: mainnet,
			transport: custom({
				request: async () => {
					throw new Error('Unexpected RPC')
				},
			}),
		}),
		{
			get(target, property) {
				if (property === 'getBlock')
					return async (parameters?: { blockNumber?: bigint }) => {
						if (parameters?.blockNumber === 20n) return { number: 20n, hash: '0x33', timestamp: 1789560000n }
						return { number: 42n, hash: options.reorg && blockReads++ > 0 ? '0x22' : '0x11' }
					}
				if (property === 'getLogs') return async () => (options.failDeployment ? [] : [{ blockNumber: 20n, blockHash: '0x33' }])
				if (property === 'readContract')
					return async (parameters: { functionName: string; args: readonly unknown[]; blockNumber: bigint }) => {
						reads.push(parameters)
						switch (parameters.functionName) {
							case 'securityPoolDeploymentCount':
								return total
							case 'securityPoolDeploymentsRange':
								return [{ securityPool: address, parent: zeroAddress, universeId: 7n, questionId: 42n, statoblastSecurityMultiplierBps: 12500n }]
							case 'systemState':
								if (options.failMetrics) throw new Error('Pool unavailable')
								return 0n
							case 'getTotalPoolHeldAttoRep':
								return 2n * 10n ** 18n
							case 'questionData':
								if (options.failDates) throw new Error('Question unavailable')
								return address
							case 'questionCreatedTimestamp':
								return options.missingQuestion ? 0n : 1789387200n
							case 'questions':
								return ['Question', '', 1789473600n, 1792065600n, 0n, 0n, 0n, '']
							case 'getVaultCount':
								return 3n
							default:
								throw new Error(`Unexpected read ${parameters.functionName}`)
						}
					}
				return Reflect.get(target, property)
			},
		},
	)
	return { client, reads }
}

test('browses unselected factory deployments with bounded ranges at a canonical block', async () => {
	const { client, reads } = fixture(25n)
	const result = await loadPoolCatalog(client, address, 1, 2)
	expect(result).toMatchObject({ total: '25', pageCount: '3', page: 2, pools: [{ address, universeId: '7', questionId: '42', deploymentDate: '1789560000', questionDates: { startTime: '1789473600', endTime: '1792065600' }, metrics: { systemState: '0', totalPoolHeldRep: '2', vaultCount: '3' } }] })
	expect(reads.find(read => read.functionName === 'securityPoolDeploymentsRange')?.args).toEqual([24n, 1n])
	expect(reads.every(read => read.blockNumber === 42n)).toBe(true)
	expect(result).not.toHaveProperty('block')
	expect(reads.filter(read => read.functionName === 'questions').map(read => read.args)).toEqual([[42n]])
})

test('handles empty and out-of-range pages without reading pool details', async () => {
	for (const [total, page] of [
		[0n, 0],
		[1n, 1],
	] as const) {
		const { client, reads } = fixture(total)
		expect((await loadPoolCatalog(client, address, 1, page)).pools).toEqual([])
		expect(reads.map(read => read.functionName)).toEqual(['securityPoolDeploymentCount'])
	}
})

test('retains a registered pool when its current metrics are unavailable', async () => {
	const { client } = fixture(1n, { failMetrics: true })
	const result = await loadPoolCatalog(client, address, 1, 0)
	expect(result.pools[0]?.address).toBe(address)
	expect(result.pools[0]?.metrics).toBeUndefined()
	expect(result.pools[0]?.deploymentDate).toBe('1789560000')
	expect(result.pools[0]?.questionDates?.endTime).toBe('1792065600')
})

test('rejects invalid pagination and reorganized snapshots', async () => {
	const { client } = fixture(1n, { reorg: true })
	await expect(loadPoolCatalog(client, address, 1, -1)).rejects.toThrow('non-negative')
	await expect(loadPoolCatalog(client, address, 1, 0)).rejects.toThrow('changed during discovery')
})

test('keeps deployment and question dates independent when either source is unavailable', async () => {
	const noQuestion = await loadPoolCatalog(fixture(1n, { failDates: true }).client, address, 1, 0)
	expect(noQuestion.pools[0]?.questionDates).toBeUndefined()
	expect(noQuestion.pools[0]?.deploymentDate).toBe('1789560000')
	expect(noQuestion.pools[0]?.metrics?.vaultCount).toBe('3')
	const noDeployment = await loadPoolCatalog(fixture(1n, { failDeployment: true }).client, address, 1, 0)
	expect(noDeployment.pools[0]?.deploymentDate).toBeUndefined()
	expect(noDeployment.pools[0]?.questionDates?.startTime).toBe('1789473600')
	const missingQuestion = await loadPoolCatalog(fixture(1n, { missingQuestion: true }).client, address, 1, 0)
	expect(missingQuestion.pools[0]?.questionDates).toBeUndefined()
})
