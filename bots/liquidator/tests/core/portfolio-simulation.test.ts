import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRpcEndpointPool, createWalletClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { executePortfolioTakeover, PortfolioOpportunityExpired, type refreshPortfolioExecution } from '../../src/execution/portfolio-executor.ts'
import { submitCall } from '../../src/execution/liquidation-executor.ts'
import { settleInterruptedCycle } from '../../src/runtime/scan-cycle.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

type Mode = 'healed' | 'unexplained' | 'authentication' | 'malformed' | 'disagreement' | 'reorg' | 'transport'
async function simulationFixture(mode: Mode) {
	const directory = await mkdtemp(join(tmpdir(), 'portfolio-simulation-'))
	const settings = portfolioSettings()
	settings.strategy.maximumGasCostAttoEth = unit / 100n
	settings.runtime.execute = true
	settings.runtime.once = false
	settings.runtime.stateFile = join(directory, 'state.json')
	settings.paused = false
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const observation = portfolioObservation()
	observation.snapshot.owner = account.address
	observation.snapshot.ownerPrincipalAttoRep = 100n * unit
	observation.snapshot.ownerAccount.freeAttoRep = 100n * unit
	const state = initialRuntimeState(false, account.address, 1)
	state.portfolioScopes = [observation.nextScope]
	const wallet = createWalletClient({
		chain: mainnet,
		account,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected signer RPC')
			},
		}),
	})
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
					return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: 'execution reverted: Source healthy' } })
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
	const refresh: typeof refreshPortfolioExecution = async () => {
		refreshes++
		if (simulated && mode === 'authentication') throw new Error('Unrecognized portfolio runtime code')
		return { observation, totalPrincipal: observation.snapshot.ownerPrincipalAttoRep, allowance: 0n }
	}
	return {
		settings,
		state,
		unexpected,
		refreshes: () => refreshes,
		run: () => executePortfolioTakeover(wallet, settings, state, createRpcEndpointPool(endpoints), observation, 1n, async () => true, { refresh, submit: submitCall }),
		close: async () => {
			servers.forEach(server => server.stop(true))
			await rm(directory, { recursive: true, force: true })
		},
	}
}

test('real submission revalidates a healed portfolio after simulation revert without pausing or signing', async () => {
	const fixture = await simulationFixture('healed')
	try {
		const error: unknown = await fixture.run().then(
			() => undefined,
			error => error,
		)
		expect(error).toBeInstanceOf(PortfolioOpportunityExpired)
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
	test(`portfolio simulation does not downgrade ${mode} failures to opportunity expiry`, async () => {
		const fixture = await simulationFixture(mode)
		try {
			const error: unknown = await fixture.run().then(
				() => undefined,
				error => error,
			)
			expect(error).toBeInstanceOf(Error)
			expect(error).not.toBeInstanceOf(PortfolioOpportunityExpired)
			expect(fixture.refreshes()).toBe(mode === 'unexplained' || mode === 'authentication' ? 2 : 1)
			expect(await settleInterruptedCycle({ settings: fixture.settings }, { state: fixture.state, shutdown: { isRequested: () => false } }, error)).toBeUndefined()
			expect(fixture.state.pendingTransactions).toHaveLength(0)
			expect(fixture.unexpected).toEqual([])
		} finally {
			await fixture.close()
		}
	})
