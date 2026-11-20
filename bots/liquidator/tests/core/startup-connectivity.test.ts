import { afterEach, expect, test } from 'bun:test'
import { parseSettings } from '#config/settings'
import { initialRuntimeState } from '#state/operator-state'
import { checkStartupConnectivity, recheckStartupConnectivity } from '../../src/runtime/startup-connectivity.ts'

const servers: { stop: (force?: boolean) => unknown }[] = []

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

/** A JSON-RPC endpoint answering `eth_chainId` for mainnet, or HTTP 503 while `available()` is false. */
function rpcEndpoint(available: () => boolean) {
	let calls = 0
	const server = Bun.serve({
		fetch: async request => {
			calls += 1
			const body: unknown = await request.json()
			const id = typeof body === 'object' && body !== null ? Reflect.get(body, 'id') : undefined
			if (!available()) return new Response('unavailable', { status: 503 })
			return Response.json({ id, jsonrpc: '2.0', result: '0x1' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('Test server did not expose a port')
	return { calls: () => calls, url: `http://127.0.0.1:${server.port.toString()}/` }
}

test('a failed startup check of the public RPC is repeated before scans until it passes', async () => {
	let publicAvailable = false
	const read = rpcEndpoint(() => true)
	const submission = rpcEndpoint(() => publicAvailable)
	const example = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	const runtime = {
		client: { getChainId: async () => 1 },
		settings: { ...example, connectivity: { ...example.connectivity, publicRpcUrls: [submission.url], quorumRpcUrls: [], readRpcUrl: read.url, rpcQuorum: 1 as const }, networkConfigured: true },
		startupConnectivityPending: false,
	}
	const state = initialRuntimeState(false, undefined, 1)
	runtime.startupConnectivityPending = await checkStartupConnectivity(runtime, { state }, undefined)
	expect(runtime.startupConnectivityPending).toBe(true)
	expect(state.status).toBe('connectivity-degraded')
	await expect(recheckStartupConnectivity(runtime)).rejects.toThrow()
	expect(runtime.startupConnectivityPending).toBe(true)
	const failedCalls = submission.calls()
	publicAvailable = true
	await recheckStartupConnectivity(runtime)
	expect(runtime.startupConnectivityPending).toBe(false)
	expect(submission.calls()).toBeGreaterThan(failedCalls)
	await recheckStartupConnectivity(runtime)
	expect(submission.calls()).toBe(failedCalls + 1)
})
