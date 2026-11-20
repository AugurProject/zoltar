import { expect, test } from 'bun:test'
import { createPublicClient, getAddress, type Address } from '../../src/ethereum.ts'
import { custom } from '@zoltar/core-shared/evm/ethereum'
import { createRpcDiagnosticContext } from '../../src/indexer-runtime.ts'
import { getKnownLogs } from '../../src/indexer/log-scanner.ts'
import type { ProviderState } from '../../src/indexer/network-state.ts'
import type { ContractMetadata } from '../../src/types.ts'

const address = (id: number): Address => getAddress(`0x${id.toString(16).padStart(40, '0')}`)
test('#1468: factory discovery does not issue one RPC per child REP token', async () => {
	let logCalls = 0
	const hash = `0x${'1'.repeat(64)}` as const
	const client = createPublicClient({
		transport: custom({
			request: async ({ method }) => {
				if (method === 'eth_getLogs') {
					logCalls++
					return []
				}
				if (method === 'eth_getBlockByNumber') return { number: '0x1', hash, parentHash: hash, timestamp: '0x1', transactions: [] }
				throw new Error(`Unexpected ${method}`)
			},
		}),
	})
	const active = { client, logClient: client, endpoint: 'test', number: 1, getChainId: async () => 1 }
	const providers: ProviderState = { active, client, logClient: client, list: [active], traceUnsupported: new WeakSet(), verified: new WeakSet(), stateBoundaries: new WeakMap(), historicalCodeUnavailable: new WeakMap(), failoverSawPrunedLogFailure: false, diagnostics: createRpcDiagnosticContext(active) }
	const contracts = new Map<string, ContractMetadata>()
	for (let i = 0; i < 500; i++) contracts.set(address(i + 1).toLowerCase(), { address: address(i + 1), kind: 'reputationToken', label: 'REP', provenance: 'event' })
	for (const [id, kind] of [
		[1001, 'weth'],
		[1002, 'usdc'],
		[1003, 'uniswapV2Factory'],
		[1004, 'uniswapV3Factory'],
	] as const)
		contracts.set(address(id).toLowerCase(), { address: address(id), kind, label: kind, provenance: 'manifest' })
	await getKnownLogs(providers, 1n, [address(1003), address(1004)], contracts, hash)
	expect(logCalls).toBeLessThanOrEqual(4)
})
