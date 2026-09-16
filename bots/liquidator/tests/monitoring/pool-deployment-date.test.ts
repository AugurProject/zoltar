import { expect, test } from 'bun:test'
import { createPublicClient, getAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { createPoolDeploymentDateCache, loadPoolDeploymentDate } from '#monitoring/pool-deployment-date'

const factory = getAddress('0x1111111111111111111111111111111111111111')
const pool = getAddress('0x2222222222222222222222222222222222222222')

function fixture(options: { limitLogs?: boolean; historyUnavailable?: boolean; reorg?: boolean; noEvent?: boolean } = {}) {
	const ranges: { event: unknown; address: string; args: { securityPool: string }; fromBlock: bigint; toBlock: bigint }[] = []
	const codeReads: bigint[] = []
	const birthBlock = 7123n
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
				if (property === 'getLogs')
					return async (request: (typeof ranges)[number]) => {
						ranges.push(request)
						if (options.limitLogs && request.fromBlock !== request.toBlock) throw new Error('Block range limit exceeded')
						return options.noEvent ? [] : [{ blockNumber: birthBlock, blockHash: '0x11' }]
					}
				if (property === 'getCode')
					return async (request: { address: string; blockNumber: bigint }) => {
						expect(request.address).toBe(pool)
						codeReads.push(request.blockNumber)
						if (options.historyUnavailable) throw new Error('Historical state unavailable')
						return request.blockNumber >= birthBlock ? '0x6000' : '0x'
					}
				if (property === 'getBlock')
					return async (request: { blockNumber: bigint }) => {
						expect(request.blockNumber).toBe(birthBlock)
						return { timestamp: 1789560000n, hash: options.reorg ? '0x22' : '0x11' }
					}
				return Reflect.get(target, property)
			},
		},
	)
	return { client, ranges, codeReads, birthBlock }
}

test('uses the matching factory deployment event block timestamp', async () => {
	const { client, ranges, codeReads } = fixture()
	expect(await loadPoolDeploymentDate(client, factory, pool, 10000n, 1)).toBe('1789560000')
	expect(ranges).toEqual([{ address: factory, event: expect.anything(), args: { securityPool: pool }, fromBlock: 0n, toBlock: 10000n }])
	expect(codeReads).toEqual([])
})

test('locates a single deployment block when the provider limits log ranges', async () => {
	const { client, ranges, codeReads, birthBlock } = fixture({ limitLogs: true })
	expect(await loadPoolDeploymentDate(client, factory, pool, 10000n, 1)).toBe('1789560000')
	expect(ranges.map(range => [range.fromBlock, range.toBlock])).toEqual([
		[0n, 10000n],
		[birthBlock, birthBlock],
	])
	expect(codeReads.length).toBeLessThanOrEqual(15)
	expect(codeReads.every(block => block <= 10000n)).toBe(true)
})

test('does not substitute a current timestamp when history or event evidence is unavailable', async () => {
	expect(await loadPoolDeploymentDate(fixture({ noEvent: true }).client, factory, pool, 10000n, 1)).toBeUndefined()
	await expect(loadPoolDeploymentDate(fixture({ limitLogs: true, historyUnavailable: true }).client, factory, pool, 10000n, 1)).rejects.toThrow('Historical state unavailable')
	await expect(loadPoolDeploymentDate(fixture({ reorg: true }).client, factory, pool, 10000n, 1)).rejects.toThrow('changed during discovery')
})

test('reuses verified deployment dates without rescanning historical logs', async () => {
	const { client, ranges } = fixture()
	expect(await loadPoolDeploymentDate(client, factory, pool, 10000n, 1)).toBe('1789560000')
	expect(await loadPoolDeploymentDate(client, factory, pool, 10001n, 1)).toBe('1789560000')
	expect(ranges).toHaveLength(1)
})

test('isolates cached dates by chain factory and pool and rechecks their block hash', async () => {
	const options = { reorg: false }
	const { client, ranges } = fixture(options)
	const other = getAddress('0x3333333333333333333333333333333333333333')
	await loadPoolDeploymentDate(client, factory, pool, 10000n, 1)
	await loadPoolDeploymentDate(client, factory, pool, 10000n, 2)
	await loadPoolDeploymentDate(client, other, pool, 10000n, 1)
	await loadPoolDeploymentDate(client, factory, other, 10000n, 1)
	expect(ranges).toHaveLength(4)
	options.reorg = true
	await expect(loadPoolDeploymentDate(client, factory, pool, 10001n, 1)).rejects.toThrow('changed during discovery')
	options.reorg = false
	await loadPoolDeploymentDate(client, factory, pool, 10001n, 1)
	expect(ranges).toHaveLength(5)
})

test('does not cache missing event evidence and shares concurrent date discovery', async () => {
	const missing = fixture({ noEvent: true })
	await loadPoolDeploymentDate(missing.client, factory, pool, 10000n, 1)
	await loadPoolDeploymentDate(missing.client, factory, pool, 10000n, 1)
	expect(missing.ranges).toHaveLength(2)
	const found = fixture()
	expect(await Promise.all([loadPoolDeploymentDate(found.client, factory, pool, 10000n, 1), loadPoolDeploymentDate(found.client, factory, pool, 10000n, 1)])).toEqual(['1789560000', '1789560000'])
	expect(found.ranges).toHaveLength(1)
})

test('retains verified dates across the operator RPC client replacements', async () => {
	const cache = createPoolDeploymentDateCache()
	const first = fixture()
	const next = fixture()
	await loadPoolDeploymentDate(first.client, factory, pool, 10000n, 1, cache)
	expect(await loadPoolDeploymentDate(next.client, factory, pool, 10001n, 1, cache)).toBe('1789560000')
	expect(first.ranges).toHaveLength(1)
	expect(next.ranges).toHaveLength(0)
})
