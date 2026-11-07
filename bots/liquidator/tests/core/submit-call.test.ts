import { expect, test } from 'bun:test'
import { parseSettings } from '#config/settings'
import { submitCall } from '#execution/submit-call'
import { initialRuntimeState } from '#state/operator-state'
import { createRpcEndpointPool, createWalletClient, getAddress, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const poolAddress = getAddress('0x0000000000000000000000000000000000000010')
async function fixture() {
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const state = initialRuntimeState(false, account.address, settings.network.chainId)
	const wallet = createWalletClient({
		account,
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Pre-submit stop must precede wallet RPC')
			},
		}),
	})
	return { settings, state, wallet }
}

test('submission uses a common block when honest RPC endpoints differ by one head', async () => {
	const f = await fixture()
	const directory = await mkdtemp(join(tmpdir(), 'liquidator-quorum-'))
	f.settings.runtime.stateFile = join(directory, 'state.json')
	const simulations: unknown[] = []
	const servers = [101n, 100n].map(head =>
		Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const payload = await request.json()
				const method = Reflect.get(payload, 'method')
				const params = Reflect.get(payload, 'params')
				let result: unknown
				if (method === 'eth_getBlockByNumber') {
					const number = params[0] === 'latest' ? head : BigInt(params[0])
					result = { number: `0x${number.toString(16)}`, hash: `0x${number.toString(16).padStart(64, '0')}`, baseFeePerGas: '0x1', timestamp: '0x1', transactions: [] }
				} else if (method === 'eth_getTransactionCount') result = '0x0'
				else if (method === 'eth_call') {
					simulations.push(params[1])
					result = '0x'
				} else throw new Error(`Unexpected RPC ${String(method)}`)
				return Response.json({ id: Reflect.get(payload, 'id'), jsonrpc: '2.0', result })
			},
		}),
	)
	const endpoints = servers.map(server => server.url.toString())
	const primary = endpoints[0]
	if (primary === undefined) throw new Error('Missing RPC')
	f.settings.connectivity = { readRpcUrl: primary, quorumRpcUrls: endpoints.slice(1), publicRpcUrls: [], rpcQuorum: 2 }
	try {
		await expect(
			submitCall(
				f.wallet,
				f.settings,
				f.state,
				createRpcEndpointPool(endpoints),
				{
					to: poolAddress,
					data: '0x',
					gas: 21_000n,
					label: 'Pinned block regression',
					preSubmit: () => {
						throw new Error('Stop before submission')
					},
				},
				'deposit',
			),
		).rejects.toThrow('Stop before submission')
		expect(simulations).toEqual(['0x64', '0x64'])
		expect(f.state.pendingTransactions).toHaveLength(0)
	} finally {
		servers.forEach(server => server.stop(true))
		await rm(directory, { recursive: true, force: true })
	}
})
