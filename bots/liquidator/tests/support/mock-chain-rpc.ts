import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRpcEndpointPool, type Address } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '../../src/config/settings.ts'
import type { PortfolioScope } from '../../src/monitoring/portfolio-monitor.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'

type MockChain = { request: (args: { method: string; params?: unknown }) => Promise<unknown> }

/**
 * Serves a mock chain over JSON-RPC and points the operator settings and runtime state at it, so production
 * execution paths run against deployed contracts. Each submitted transaction is mined immediately.
 */
export async function serveMockChainRpc(mock: MockChain, settings: OperatorSettings, account: Address, scope: PortfolioScope, onResult: (method: string, result: unknown) => void = () => undefined) {
	const directory = await mkdtemp(join(tmpdir(), 'portfolio-production-'))
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const body: unknown = await request.json()
			if (typeof body !== 'object' || body === null || !('method' in body) || typeof body.method !== 'string' || !('params' in body) || !Array.isArray(body.params) || !('id' in body)) throw new Error('Invalid RPC fixture request')
			try {
				const result = await mock.request({ method: body.method, params: body.params })
				onResult(body.method, result)
				if (body.method === 'eth_sendRawTransaction') await mock.request({ method: 'anvil_mine', params: ['0xc'] })
				return Response.json({ jsonrpc: '2.0', id: body.id, result })
			} catch (error) {
				return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })
			}
		},
	})
	const endpoint = `http://127.0.0.1:${server.port}`
	settings.connectivity.readRpcUrl = endpoint
	settings.connectivity.quorumRpcUrls = []
	settings.connectivity.publicRpcUrls = [endpoint]
	settings.connectivity.rpcQuorum = 1
	settings.runtime.execute = true
	settings.runtime.pollMilliseconds = 100
	settings.runtime.stateFile = join(directory, 'state.json')
	const state = initialRuntimeState(false, account, 1)
	state.portfolioScopes = [scope]
	return {
		pool: createRpcEndpointPool([endpoint]),
		state,
		stop: async () => {
			await server.stop(true)
			await rm(directory, { recursive: true, force: true })
		},
	}
}
