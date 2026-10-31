import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRpcEndpointPool, createWalletClient, parseTransaction, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { executePortfolioTakeover, PortfolioOpportunityExpired, type refreshPortfolioExecution } from '../../src/execution/portfolio-executor.ts'
import { submitCall } from '../../src/execution/liquidation-executor.ts'
import { settleInterruptedCycle } from '../../src/runtime/scan-cycle.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

type Mode = 'success' | 'budget' | 'malformed' | 'zero' | 'revert' | 'reorg' | 'transport'
async function fixture(mode: Mode) {
	const directory = await mkdtemp(join(tmpdir(), 'portfolio-estimate-'))
	const settings = portfolioSettings()
	settings.runtime.execute = true
	settings.runtime.once = false
	settings.runtime.stateFile = join(directory, 'state.json')
	settings.strategy.maximumGasCostAttoEth = mode === 'budget' ? unit / 1000n : unit / 10n
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
	const estimates: { block: unknown; transaction: unknown }[] = []
	const simulatedGas: bigint[] = []
	const unexpected: string[] = []
	let signedGas: bigint | undefined
	const servers = [2_500_000n, 2_600_000n].map((estimate, index) =>
		Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const payload = await request.json()
				const method = Reflect.get(payload, 'method')
				const params = Reflect.get(payload, 'params')
				const id = Reflect.get(payload, 'id')
				let result: unknown
				if (method === 'eth_getBlockByNumber') result = { number: '0x7b', hash: `0x${(estimates.length > 0 && mode === 'reorg' ? '2' : '1').repeat(64)}`, baseFeePerGas: '0x1', timestamp: '0xe74', transactions: [] }
				else if (method === 'eth_estimateGas') {
					estimates.push({ block: params[1], transaction: params[0] })
					if (mode === 'transport') return new Response('Unavailable', { status: 503 })
					if (mode === 'revert' && index === 1) return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: 'execution reverted: bad source' } })
					if (mode === 'malformed' && index === 1) result = 'invalid'
					else if (mode === 'zero' && index === 1) result = '0x0'
					else result = `0x${estimate.toString(16)}`
				} else if (method === 'eth_call') {
					const gas = BigInt(params[0].gas)
					simulatedGas.push(gas)
					if (gas < 3_000_000n) return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: 'out of gas' } })
					result = '0x'
				} else if (method === 'eth_getTransactionCount') result = '0x0'
				else {
					unexpected.push(String(method))
					return Response.json({ id, jsonrpc: '2.0', error: { code: -32601, message: 'Unexpected request' } })
				}
				return Response.json({ id, jsonrpc: '2.0', result })
			},
		}),
	)
	const endpoints = servers.map(server => server.url.toString())
	const primary = endpoints[0]
	if (primary === undefined) throw new Error('Missing fixture endpoint')
	settings.connectivity = { readRpcUrl: primary, quorumRpcUrls: endpoints.slice(1), publicRpcUrls: [], rpcQuorum: 2 }
	const refresh: typeof refreshPortfolioExecution = async () => ({ observation, totalPrincipal: observation.snapshot.ownerPrincipalAttoRep, allowance: 0n })
	const submit: typeof submitCall = async (wallet, settings, state, pool, call, kind) =>
		submitCall(
			wallet,
			settings,
			state,
			pool,
			{
				...call,
				preSubmit: async () => {
					await call.preSubmit?.()
					const intent = state.pendingTransactions[0]
					if (intent !== undefined) {
						signedGas = parseTransaction(intent.serializedTransaction).gas
						throw new Error('Stop after durable signed gas verification')
					}
				},
			},
			kind,
		)
	return {
		settings,
		state,
		observation,
		estimates,
		simulatedGas,
		unexpected,
		signedGas: () => signedGas,
		run: () => executePortfolioTakeover(wallet, settings, state, createRpcEndpointPool(endpoints), observation, 1n, async () => true, { refresh, submit }),
		close: async () => {
			servers.forEach(server => server.stop(true))
			await rm(directory, { recursive: true, force: true })
		},
	}
}

test('portfolio estimates exact pinned calldata across heuristic differences and simulates the actual signed padded gas', async () => {
	const f = await fixture('success')
	try {
		await expect(f.run()).rejects.toThrow('Stop after durable signed gas verification')
		expect(f.estimates).toHaveLength(2)
		expect(f.estimates.every(estimate => estimate.block === '0x7b')).toBe(true)
		for (const estimate of f.estimates) expect(estimate.transaction).toMatchObject({ from: f.observation.snapshot.owner, to: f.observation.snapshot.capitalLedger, value: '0x0' })
		expect(f.simulatedGas).toEqual([paddedTransactionGas(2_600_000n), paddedTransactionGas(2_600_000n)])
		expect(f.signedGas()).toBe(paddedTransactionGas(2_600_000n))
		expect(f.state.pendingTransactions).toHaveLength(0)
		expect(f.unexpected).toEqual([])
	} finally {
		await f.close()
	}
})

for (const funded of [true, false])
	test(`portfolio gas budget skips before signing or funding (already funded=${funded})`, async () => {
		const f = await fixture('budget')
		if (!funded) {
			f.observation.snapshot.ownerPrincipalAttoRep = 0n
			f.observation.snapshot.ownerAccount.freeAttoRep = 0n
		}
		try {
			const error: unknown = await f.run().then(
				() => undefined,
				error => error,
			)
			expect(error).toBeInstanceOf(PortfolioOpportunityExpired)
			expect(await settleInterruptedCycle({ settings: f.settings }, { state: f.state, shutdown: { isRequested: () => false } }, error)).toBe(false)
			expect(f.estimates).toHaveLength(2)
			expect(f.simulatedGas).toHaveLength(0)
			expect(f.signedGas()).toBeUndefined()
			expect(f.state.pendingTransactions).toHaveLength(0)
			expect(f.settings.paused).toBe(false)
			expect(f.state.paused).toBe(false)
			expect(f.unexpected).toEqual([])
		} finally {
			await f.close()
		}
	})

for (const mode of ['malformed', 'zero', 'revert', 'reorg', 'transport'] as const)
	test(`portfolio gas estimation retains ${mode} failure instead of signing or hiding it as expiry`, async () => {
		const f = await fixture(mode)
		try {
			const error: unknown = await f.run().then(
				() => undefined,
				error => error,
			)
			expect(error).toBeInstanceOf(Error)
			expect(error).not.toBeInstanceOf(PortfolioOpportunityExpired)
			expect(await settleInterruptedCycle({ settings: f.settings }, { state: f.state, shutdown: { isRequested: () => false } }, error)).toBeUndefined()
			expect(f.simulatedGas).toHaveLength(0)
			expect(f.signedGas()).toBeUndefined()
			expect(f.state.pendingTransactions).toHaveLength(0)
			expect(f.unexpected).toEqual([])
		} finally {
			await f.close()
		}
	})
