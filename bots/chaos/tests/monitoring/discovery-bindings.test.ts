import { describe, expect, test } from 'bun:test'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, isAddress, isHex, type Address } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { questionLedgerAbi, securityPoolFactoryAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { authenticatePoolProtocolBindings } from '../../src/monitoring/discovery-graph.ts'
import { address } from '../operations/fixture.ts'

interface PoolBindingOverrides {
	coordinatorOpenOracle?: Address
	coordinatorRepToken?: Address
	coordinatorWeth?: Address
	poolOpenOracle?: Address
	readFailure?: Error
}

function poolBindingClient(pool: Address, coordinator: Address, overrides: PoolBindingOverrides = {}) {
	const reads: Array<{ address: Address; blockNumber: bigint; functionName: string }> = []
	const client = createPublicClient({
		chain: mainnet,
		transport: custom({
			async request({ method, params }) {
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error('Unexpected RPC request')
				const call = params[0]
				const block = params[1]
				if (typeof call !== 'object' || call === null || !('to' in call) || !isAddress(call.to) || !('data' in call) || !isHex(call.data) || typeof block !== 'string') throw new Error('Invalid binding call')
				const target = getAddress(call.to)
				let abi: typeof questionLedgerAbi | typeof securityPoolFactoryAbi | typeof sharedPoolPriceFeedAbi = sharedPoolPriceFeedAbi
				if (target === pool) abi = questionLedgerAbi
				else if (target === address(4)) abi = securityPoolFactoryAbi
				const { functionName } = decodeFunctionData({ abi, data: call.data })
				reads.push({ address: target, functionName, blockNumber: BigInt(block) })
				if (overrides.readFailure !== undefined) throw overrides.readFailure
				let value: Address | bigint
				if (functionName === 'openOracle') value = target === pool ? (overrides.poolOpenOracle ?? address(6)) : (overrides.coordinatorOpenOracle ?? address(6))
				else if (functionName === 'securityPoolFactory') value = address(4)
				else if (functionName === 'securityPool' || functionName === 'securityPoolOf') value = address(90)
				else if (functionName === 'universeId') value = 6n
				else if (functionName === 'sharedPriceFeeds') value = coordinator
				else if (functionName === 'weth') value = overrides.coordinatorWeth ?? address(7)
				else if (functionName === 'reputationToken') value = overrides.coordinatorRepToken ?? address(24)
				else throw new Error(`Unexpected binding read ${functionName}`)
				return typeof value === 'bigint' ? encodeAbiParameters([{ type: 'uint256' }], [value]) : encodeAbiParameters([{ type: 'address' }], [value])
			},
		}),
	})
	return { client, reads }
}

describe('canonical shared feed protocol bindings', () => {
	test('authenticates every pool and coordinator oracle/token binding at the pinned block', async () => {
		const pool = address(20)
		const coordinator = address(21)
		const binding = poolBindingClient(pool, coordinator)
		await expect(
			authenticatePoolProtocolBindings({
				blockNumber: 55n,
				canonicalRepToken: address(24),
				client: binding.client,
				configuredOpenOracle: address(6),
				configuredWeth: address(7),
				coordinator,
				pool,
			}),
		).resolves.toBeUndefined()
		expect(binding.reads.map(read => [read.address, read.functionName])).toEqual([
			[pool, 'openOracle'],
			[coordinator, 'openOracle'],
			[coordinator, 'weth'],
			[coordinator, 'reputationToken'],
			[pool, 'securityPoolFactory'],
			[address(4), 'securityPoolOf'],
			[coordinator, 'securityPoolFactory'],
			[coordinator, 'universeId'],
			[pool, 'universeId'],
			[address(4), 'sharedPriceFeeds'],
			[coordinator, 'securityPool'],
		])
		expect(binding.reads.every(read => read.blockNumber === 55n)).toBe(true)
	})

	test('rejects mismatched pool and coordinator oracle/token bindings', async () => {
		const pool = address(20)
		const coordinator = address(21)
		const cases: Array<{ expected: string; overrides: PoolBindingOverrides }> = [
			{ expected: `Pool ${pool} OpenOracle edge`, overrides: { poolOpenOracle: address(99) } },
			{ expected: `Coordinator ${coordinator} OpenOracle edge`, overrides: { coordinatorOpenOracle: address(99) } },
			{ expected: `Coordinator ${coordinator} WETH edge`, overrides: { coordinatorWeth: address(99) } },
			{ expected: `Coordinator ${coordinator} REP edge`, overrides: { coordinatorRepToken: address(99) } },
		]
		for (const candidate of cases) {
			await expect(
				authenticatePoolProtocolBindings({
					blockNumber: 55n,
					canonicalRepToken: address(24),
					client: poolBindingClient(pool, coordinator, candidate.overrides).client,
					configuredOpenOracle: address(6),
					configuredWeth: address(7),
					coordinator,
					pool,
				}),
			).rejects.toThrow(candidate.expected)
		}
	})

	test('propagates pool binding transport failures without accepting an unauthenticated graph', async () => {
		const pool = address(20)
		const coordinator = address(21)
		const readFailure = new Error('RPC transport closed during immutable binding read')
		await expect(
			authenticatePoolProtocolBindings({
				blockNumber: 55n,
				canonicalRepToken: address(24),
				client: poolBindingClient(pool, coordinator, { readFailure }).client,
				configuredOpenOracle: address(6),
				configuredWeth: address(7),
				coordinator,
				pool,
			}),
		).rejects.toThrow(readFailure.message)
	})
})
