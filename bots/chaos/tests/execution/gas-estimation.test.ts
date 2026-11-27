import { afterEach, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { createRpcEndpointPool, encodeFunctionData, toHex, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { questionLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { parseSettings } from '../../src/config/settings.ts'
import type { ExactRpcTransaction, ExecutionEnvironment } from '../../src/execution/execution-context.ts'
import { agreedMaximumGasEstimate } from '../../src/execution/execution-quorum.ts'
import { rediscoverableSimulationAndGas } from '../../src/execution/execution-preflight.ts'
import { initialRuntimeState } from '../../src/state/initial-state.ts'

const servers: Array<{ stop: (closeActiveConnections?: boolean) => void }> = []
afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

function gasServer(pinned: bigint, pending: bigint) {
	const tags: string[] = []
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body: unknown = await request.json()
			if (typeof body === 'object' && body !== null && 'method' in body && body.method === 'eth_call') return Response.json({ id: 'id' in body ? body.id : 1, jsonrpc: '2.0', result: '0x' })
			if (typeof body !== 'object' || body === null || !('method' in body) || body.method !== 'eth_estimateGas' || !('params' in body) || !Array.isArray(body.params) || typeof body.params[1] !== 'string') throw new Error('Expected gas estimation with a block tag')
			const tag = body.params[1]
			tags.push(tag)
			return Response.json({ id: 'id' in body ? body.id : 1, jsonrpc: '2.0', result: toHex(tag === 'pending' ? pending : pinned) })
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('Gas RPC server did not expose a port')
	return { tags, url: `http://127.0.0.1:${server.port.toString()}` }
}

async function environment(first: string, second: string): Promise<ExecutionEnvironment> {
	const settings = parseSettings(await Bun.file(resolve(import.meta.dir, '../../config/operator.example.json')).json())
	settings.connectivity = { publicRpcUrls: [first], readRpcUrl: first, quorumRpcUrls: [second], rpcQuorum: 2 }
	settings.networkConfigured = true
	return { chain: mainnet, pool: createRpcEndpointPool([first, second]), sender: zeroAddress, settings, state: initialRuntimeState(false, zeroAddress, 1) }
}

const transaction: ExactRpcTransaction = { data: '0x', from: zeroAddress, to: zeroAddress, value: '0x0' }

test('complete-set redemption budgets for a fee checkpoint when both estimates use the old timestamp', async () => {
	const sameTimestampEstimate = 1_222_879n
	const first = gasServer(sameTimestampEstimate, sameTimestampEstimate)
	const second = gasServer(sameTimestampEstimate, sameTimestampEstimate)
	const context = await environment(first.url, second.url)
	const anchor = { number: 100n, attestingRpcUrls: new Set([first.url, second.url]) }
	const step = { id: 'redeemCompleteSet', label: 'Redemption', to: zeroAddress, gasLimit: '12000000', evidence: [], preflightCalls: [], walletAssetDebits: [] }
	const data = encodeFunctionData({ abi: questionLedgerAbi, functionName: 'redeemCompleteSet', args: [1n, 0n] })
	const estimate = await rediscoverableSimulationAndGas(context, { ...step, data }, anchor)
	expect(paddedTransactionGas(estimate)).toBeGreaterThanOrEqual(1_478_942n)
	expect(await rediscoverableSimulationAndGas(context, { ...step, data: '0x' }, anchor)).toBe(sameTimestampEstimate)
})

test.each([300_000n, 900_000n])('pre-signing gas covers pinned and next-block work at every attester (pinned: %s)', async pinned => {
	const first = gasServer(pinned, 800_000n)
	const second = gasServer(400_000n, 700_000n)
	const context = await environment(first.url, second.url)
	const anchor = { number: 100n, attestingRpcUrls: new Set([first.url, second.url]) }
	expect(await agreedMaximumGasEstimate(context, 'redeem gas', transaction, anchor, { includePending: true })).toBe(pinned > 800_000n ? pinned : 800_000n)
	for (const server of [first, second]) expect(server.tags.toSorted()).toEqual(['0x64', 'pending'])
})

test('recovery estimates remain pinned so an already pending intent is not applied twice', async () => {
	const first = gasServer(300_000n, 0n)
	const second = gasServer(400_000n, 0n)
	const context = await environment(first.url, second.url)
	expect(await agreedMaximumGasEstimate(context, 'recovery gas', transaction, { number: 100n, attestingRpcUrls: new Set([first.url, second.url]) })).toBe(400_000n)
	for (const server of [first, second]) expect(server.tags).toEqual(['0x64'])
})

test('a missing valid pending estimate from one canonical attester prevents signing', async () => {
	const first = gasServer(300_000n, 0n)
	const second = gasServer(400_000n, 700_000n)
	const context = await environment(first.url, second.url)
	await expect(agreedMaximumGasEstimate(context, 'redeem gas', transaction, { number: 100n, attestingRpcUrls: new Set([first.url, second.url]) }, { includePending: true })).rejects.toThrow('redeem gas RPC returned a zero gas estimate')
})
