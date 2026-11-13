import { expect, test } from 'bun:test'
import { getAddress } from '../../src/ethereum.ts'
import { sampleEntityState } from '../../src/snapshot-client.ts'

const pool = getAddress('0x1111111111111111111111111111111111111111')
const target = { entityType: 'pool', entityIdentity: pool, address: pool } as const

const fixture = () => {
	const calls: string[] = []
	let failIdentity = false
	const client = {
		readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint | undefined }) => {
			calls.push(`${functionName}:${blockNumber}`)
			if (['securityPoolFactory', 'getSecurityPoolPortfolio', 'collateralToken'].includes(functionName)) {
				if (failIdentity) throw new Error('Identity unavailable')
				return pool
			}
			if (functionName === 'symbol') return 'USDC'
			if (functionName === 'decimals') return 6n
			if (functionName === 'awaitingForkContinuation' || functionName === 'isEscalationResolved') return false
			return blockNumber ?? 0n
		},
	}
	return {
		client,
		calls,
		fail: (value: boolean) => {
			failIdentity = value
		},
	}
}

test('caches immutable collateral identity across blocks while sampling live amounts and display metadata', async () => {
	const { client, calls } = fixture()
	const cache = new Map<string, typeof pool>()
	await sampleEntityState(client, target, 10n, undefined, cache)
	const second = await sampleEntityState(client, target, 11n, undefined, cache)
	for (const name of ['securityPoolFactory', 'getSecurityPoolPortfolio', 'collateralToken']) expect(calls.filter(call => call.startsWith(`${name}:`))).toHaveLength(1)
	for (const name of ['symbol', 'decimals', 'settlementCollateralAttoEth']) expect(calls).toContain(`${name}:11`)
	expect(second.readResult).toMatchObject({ settlementCollateralAttoEth: '11', collateral: { symbol: 'USDC', decimals: 6 } })
	// Independent networks and invalidated history must discover identity again.
	await sampleEntityState(client, target, 12n, undefined, new Map())
	cache.clear()
	await sampleEntityState(client, target, 9n, undefined, cache)
	expect(calls.filter(call => call.startsWith('collateralToken:'))).toHaveLength(3)
})

test('failed collateral identity lookups are retried without losing valid accounting', async () => {
	const { client, calls, fail } = fixture()
	const cache = new Map<string, typeof pool>()
	fail(true)
	const first = await sampleEntityState(client, target, 10n, undefined, cache)
	expect(first.readStatus).toBe('success')
	expect(first.readResult?.['collateralMetadataError']).toBe('Identity unavailable')
	fail(false)
	const second = await sampleEntityState(client, target, 11n, undefined, cache)
	expect(second.readResult?.['collateral']).toMatchObject({ symbol: 'USDC', decimals: 6 })
	expect(calls.filter(call => call.startsWith('securityPoolFactory:'))).toHaveLength(2)
})
