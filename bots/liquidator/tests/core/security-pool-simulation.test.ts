import { expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { executeSecurityPoolTakeover, SecurityPoolOpportunityExpired, type refreshSecurityPoolExecution } from '../../src/execution/security-pool-executor.ts'
import { submitCall } from '../../src/execution/submit-call.ts'
import { settleInterruptedCycle } from '../../src/runtime/scan-cycle.ts'
import { unit } from '../support/security-pool-observation.ts'
import { securityPoolTakeoverFixture } from '../support/security-pool-execution.ts'

type Mode = 'healed' | 'unexplained' | 'authentication' | 'malformed' | 'disagreement' | 'reorg' | 'transport'
async function simulationFixture(mode: Mode) {
	const { directory, observation, settings, state, wallet } = await securityPoolTakeoverFixture('security-pool-simulation-')
	settings.strategy.maximumGasCostAttoEth = unit / 50n
	let simulated = false
	let refreshes = 0
	const unexpected: string[] = []
	const servers = [0, 1].map(index =>
		Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const payload = await request.json()
				const method = Reflect.get(payload, 'method')
				const id = Reflect.get(payload, 'id')
				if (method === 'eth_getBlockByNumber') return Response.json({ id, jsonrpc: '2.0', result: { number: '0x7b', hash: `0x${(simulated && mode === 'reorg' ? '2' : '1').repeat(64)}`, baseFeePerGas: '0x1', timestamp: '0xe74', transactions: [] } })
				if (method === 'eth_estimateGas') return Response.json({ id, jsonrpc: '2.0', result: '0x1e8480' })
				if (method === 'eth_call') {
					simulated = true
					if (mode !== 'unexplained') {
						const position = observation.positions[0]
						if (position === undefined) throw new Error('Fixture position missing')
						position.maxHealthyPrice = observation.snapshot.liquidationPrice
					}
					if (mode === 'malformed' && index === 1) return Response.json({ id, jsonrpc: '2.0', result: 'malformed' })
					if (mode === 'disagreement' && index === 1) return Response.json({ id, jsonrpc: '2.0', result: '0x' })
					if (mode === 'transport') return new Response('Unavailable', { status: 503 })
					return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: 'execution reverted: Position does not need takeover' } })
				}
				unexpected.push(String(method))
				return Response.json({ id, jsonrpc: '2.0', error: { code: -32601, message: 'Unexpected request' } })
			},
		}),
	)
	const endpoints = servers.map(server => server.url.toString())
	const primary = endpoints[0]
	if (primary === undefined) throw new Error('Fixture endpoint missing')
	settings.connectivity = { readRpcUrl: primary, quorumRpcUrls: endpoints.slice(1), publicRpcUrls: [], rpcQuorum: 2 }
	const refresh: typeof refreshSecurityPoolExecution = async () => {
		refreshes++
		if (simulated && mode === 'authentication') throw new Error('Unrecognized security pool runtime code')
		return { observation, totalPrincipal: observation.snapshot.ownerPrincipalAttoRep, allowance: 0n }
	}
	return {
		settings,
		state,
		unexpected,
		refreshes: () => refreshes,
		run: () => executeSecurityPoolTakeover(wallet, settings, state, createRpcEndpointPool(endpoints), observation, 1n, async () => true, { refresh, submit: submitCall }),
		close: async () => {
			for (const server of servers) server.stop(true)
			await rm(directory, { recursive: true, force: true })
		},
	}
}

test('real submission revalidates a healed security pool after simulation revert without pausing or signing', async () => {
	const fixture = await simulationFixture('healed')
	try {
		const error: unknown = await fixture.run().then(
			() => undefined,
			error => error,
		)
		expect(error).toBeInstanceOf(SecurityPoolOpportunityExpired)
		expect(fixture.refreshes()).toBe(2)
		expect(await settleInterruptedCycle({ settings: fixture.settings }, { state: fixture.state, shutdown: { isRequested: () => false } }, error)).toBe(false)
		expect(fixture.settings.paused).toBe(false)
		expect(fixture.state.paused).toBe(false)
		expect(fixture.state.pendingTransactions).toHaveLength(0)
		expect(fixture.unexpected).toEqual([])
	} finally {
		await fixture.close()
	}
})

for (const mode of ['unexplained', 'authentication', 'malformed', 'disagreement', 'reorg', 'transport'] as const)
	test(`security pool simulation does not downgrade ${mode} failures to opportunity expiry`, async () => {
		const fixture = await simulationFixture(mode)
		try {
			const error: unknown = await fixture.run().then(
				() => undefined,
				error => error,
			)
			expect(error).toBeInstanceOf(Error)
			expect(error).not.toBeInstanceOf(SecurityPoolOpportunityExpired)
			expect(fixture.refreshes()).toBe(mode === 'unexplained' || mode === 'authentication' ? 2 : 1)
			expect(await settleInterruptedCycle({ settings: fixture.settings }, { state: fixture.state, shutdown: { isRequested: () => false } }, error)).toBeUndefined()
			expect(fixture.state.pendingTransactions).toHaveLength(0)
			expect(fixture.unexpected).toEqual([])
		} finally {
			await fixture.close()
		}
	})
