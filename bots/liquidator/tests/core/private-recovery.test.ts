import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createWalletClient, defineChain, privateKeyToAccount, type Hex, keccak256, parseTransaction, isHex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { parseSettings } from '#config/settings'
import { loadSettings, saveSettings } from '#config/settings-store'
import { createGoLiveControls } from '#core/go-live-controls'
import { recoverPendingTransactions } from '#execution/recovery'
import { initialRuntimeState, loadDurableState, saveDurableState } from '#state/operator-state'
import { securityPoolReceiptIntent } from './security-pool-receipt-fixture.ts'

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'security-pool-private-recovery-'))
	const { intent, receipt } = await securityPoolReceiptIntent()
	intent.mode = 'private'
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	settings.network.chainId = 1
	settings.runtime.stateFile = join(directory, 'state.json')
	const control: { head: bigint; nonce: bigint; receipt: boolean; cancellationHash?: Hex; cancellationMined: boolean; rejectCancellation?: boolean } = { head: 140n, nonce: 0n, receipt: false, cancellationMined: false }
	const requests: string[] = []
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const payload = await request.json()
			const method = Reflect.get(payload, 'method')
			const id = Reflect.get(payload, 'id')
			if (typeof method !== 'string') throw new Error('Missing JSON-RPC method')
			requests.push(method)
			let result: unknown
			if (method === 'eth_sendRawTransaction') {
				if (control.rejectCancellation) return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: 'provider unavailable' } })
				const raw = Reflect.get(payload, 'params')?.[0]
				if (!isHex(raw, { strict: true })) throw new Error('Missing signed cancellation')
				const hash = keccak256(raw)
				const transaction = parseTransaction(raw)
				expect(transaction.nonce).toBe(intent.nonce)
				expect(transaction.to?.toLowerCase()).toBe(intent.sender.toLowerCase())
				expect(transaction.value).toBe(0n)
				control.cancellationHash = hash
				result = hash
			} else if (method === 'eth_getTransactionReceipt') {
				const envelope = { blockHash: receipt.blockHash, blockNumber: '0x64', contractAddress: null, cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1', from: intent.sender, gasUsed: '0x5208', logs: [], status: '0x1', transactionIndex: '0x0', type: '0x2' }
				if (control.cancellationMined && Reflect.get(payload, 'params')?.[0] === control.cancellationHash) result = { ...envelope, to: intent.sender, transactionHash: control.cancellationHash }
				else if (control.receipt) result = { ...envelope, to: receipt.to, transactionHash: intent.hash }
				else result = null
			} else if (method === 'eth_getTransactionCount') result = `0x${control.nonce.toString(16)}`
			else if (method === 'eth_blockNumber') result = `0x${control.head.toString(16)}`
			else if (method === 'eth_getBlockByNumber') result = { number: Reflect.get(payload, 'params')?.[0] === 'latest' ? `0x${control.head.toString(16)}` : Reflect.get(payload, 'params')?.[0], hash: receipt.blockHash, baseFeePerGas: '0x1', timestamp: '0x1', transactions: [] }
			else return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: `Unexpected recovery RPC ${method}` } })
			return Response.json({ id, jsonrpc: '2.0', result })
		},
	})
	const url = server.url.toString()
	settings.connectivity = { readRpcUrl: url, quorumRpcUrls: [], publicRpcUrls: [], rpcQuorum: 1 }
	settings.submission = { mode: 'private', relayUrls: [url], minimumBundleRelaySuccesses: 1 }
	const chain = defineChain({ id: 1, name: 'Recovery', nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' }, rpcUrls: { default: { http: [url] } } })
	const wallet = createWalletClient({
		account: privateKeyToAccount(`0x${'01'.repeat(32)}`),
		chain,
		transport: custom({
			request: async () => {
				throw new Error('Recovery must not submit through the wallet')
			},
		}),
	})
	const state = initialRuntimeState(false, intent.sender, 1)
	state.pendingTransactions.push(intent)
	await saveDurableState(settings.runtime.stateFile, state)
	return {
		settings,
		wallet,
		state,
		intent,
		control,
		requests,
		async close() {
			server.stop(true)
			await rm(directory, { recursive: true, force: true })
		},
	}
}

test('#1471: dropped expired intents persist and broadcast a same-nonce cancellation without replaying the action', async () => {
	const f = await fixture()
	try {
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(true)
		const pending = (await loadDurableState(f.settings.runtime.stateFile, 1)).pendingTransactions[0]
		expect(pending?.hash).toBe(f.intent.hash)
		expect(pending?.cancellation?.hash).toBe(f.control.cancellationHash)
		expect(f.control.cancellationHash).toBeDefined()
		expect(f.state.pendingTransactions).toHaveLength(1)
	} finally {
		await f.close()
	}
})

for (const mode of ['public', 'private'] as const)
	for (const head of [110n, 140n]) {
		test(`waits or cancels signed ${mode} intent at block ${head} without replaying security pool decisions`, async () => {
			const f = await fixture()
			try {
				f.intent.mode = mode
				f.control.head = head
				await saveDurableState(f.settings.runtime.stateFile, f.state)
				f.state.pendingTransactions = (await loadDurableState(f.settings.runtime.stateFile, 1)).pendingTransactions
				expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(true)
				const pending = (await loadDurableState(f.settings.runtime.stateFile, 1)).pendingTransactions[0]
				expect(pending?.hash).toBe(f.intent.hash)
				expect(pending?.serializedTransaction).toBe(f.intent.serializedTransaction)
				expect(pending?.cancellation !== undefined).toBe(head > 132n)
			} finally {
				await f.close()
			}
		})
	}

test('a consumed nonce without a receipt remains tracked and never falls back to public broadcast', async () => {
	const f = await fixture()
	try {
		f.control.nonce = 1n
		await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow('nonce was consumed')
		expect((await loadDurableState(f.settings.runtime.stateFile, 1)).pendingTransactions[0]?.hash).toBe(f.intent.hash)
		expect(f.requests).toEqual(['eth_blockNumber', 'eth_getTransactionReceipt', 'eth_getTransactionCount'])
	} finally {
		await f.close()
	}
})

test('failed persistence cannot discard an ambiguous signed transaction', async () => {
	const f = await fixture()
	try {
		const originalPath = f.settings.runtime.stateFile
		const blocker = join(dirname(originalPath), 'blocked')
		await writeFile(blocker, 'not a directory')
		f.settings.runtime.stateFile = join(blocker, 'state.json')
		await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow()
		expect(f.state.pendingTransactions).toHaveLength(1)
		expect((await loadDurableState(originalPath, 1)).pendingTransactions[0]?.hash).toBe(f.intent.hash)
		expect(f.requests).not.toContain('eth_sendRawTransaction')
	} finally {
		await f.close()
	}
})

test('shutdown leaves pending recovery untouched without starting RPC work', async () => {
	const f = await fixture()
	try {
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state, undefined, () => true)).toBe(true)
		expect(f.requests).toEqual([])
		expect((await loadDurableState(f.settings.runtime.stateFile, 1)).pendingTransactions[0]?.hash).toBe(f.intent.hash)
	} finally {
		await f.close()
	}
})

test('a finalized receipt resolves an expired private envelope before nonce reconciliation', async () => {
	const f = await fixture()
	try {
		f.control.receipt = true
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(false)
		expect(f.state.pendingTransactions).toHaveLength(0)
		expect((await loadDurableState(f.settings.runtime.stateFile, 1)).pendingTransactions).toHaveLength(0)
		expect(f.requests).not.toContain('eth_getTransactionCount')
		expect(f.requests.every(method => ['eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getBlockByNumber'].includes(method))).toBe(true)
	} finally {
		await f.close()
	}
})

test('restores the authenticated pending signer after restarting with a different saved signer', async () => {
	const f = await fixture()
	const savedKey = `0x${'11'.repeat(32)}` as const
	const pendingKey = `0x${'01'.repeat(32)}` as const
	const unrelatedKey = `0x${'33'.repeat(32)}` as const
	const path = join(dirname(f.settings.runtime.stateFile), 'operator.json')
	try {
		f.settings.connectivity.publicRpcUrls = [f.settings.connectivity.readRpcUrl]
		await saveSettings(path, { ...f.settings, paused: true, privateKey: savedKey, networkConfigured: true, runtime: { ...f.settings.runtime, execute: true } })
		let current = (await loadSettings(path)).settings
		const durable = await loadDurableState(current.runtime.stateFile, current.network.chainId)
		const state = initialRuntimeState(current.paused, privateKeyToAccount(savedKey).address, current.network.chainId)
		state.pendingTransactions = durable.pendingTransactions
		let active: Hex = savedKey
		const controller = createGoLiveControls({
			activePrivateKey: () => active,
			applySigner: key => {
				if (key === undefined) throw new Error('Recovery signer cannot be cleared')
				active = key
				state.wallet = privateKeyToAccount(key).address
			},
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				disableExecution: async () => undefined,
				discardSigner: async () => undefined,
				enableExecution: async () => undefined,
			},
			persist: async update => {
				current = update(current)
				await saveSettings(path, current)
				return current
			},
			runMutation: mutation => mutation(),
			settings: () => current,
			state,
		})
		await expect(controller.setSigner({ privateKey: unrelatedKey, rememberSigner: true })).rejects.toThrow('recovery')
		await expect(controller.setSigner({ privateKey: pendingKey, rememberSigner: false })).rejects.toThrow('saved key differs')
		expect((await loadSettings(path)).settings.privateKey).toBe(savedKey)
		await controller.setSigner({ privateKey: pendingKey, rememberSigner: true })
		expect(active).toBe(pendingKey)
		expect((await loadSettings(path)).settings.privateKey).toBe(pendingKey)
		expect(state.pendingTransactions).toHaveLength(1)
		f.control.receipt = true
		expect(await recoverPendingTransactions(current, f.wallet, state)).toBe(false)
		expect(state.pendingTransactions).toHaveLength(0)
		expect((await loadDurableState(current.runtime.stateFile, current.network.chainId)).pendingTransactions).toHaveLength(0)
	} finally {
		await f.close()
	}
})

test('#1471: confirmed cancellation releases the original journal without applying its financial effects', async () => {
	const f = await fixture()
	try {
		await recoverPendingTransactions(f.settings, f.wallet, f.state)
		f.state.pendingTransactions = (await loadDurableState(f.settings.runtime.stateFile, 1)).pendingTransactions
		f.control.cancellationMined = true
		f.control.nonce = 1n
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(false)
		expect(f.state.pendingTransactions).toEqual([])
		expect((await loadDurableState(f.settings.runtime.stateFile, 1)).pendingTransactions).toEqual([])
		expect(f.state.activities[0]?.message).toContain('Cancelled dropped transaction')
	} finally {
		await f.close()
	}
})
test('#1471: cancellation above the configured gas budget waits without forgetting the intent', async () => {
	const f = await fixture()
	try {
		f.settings.strategy.maximumGasCostAttoEth = 1n
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(true)
		expect(f.state.pendingTransactions).toHaveLength(1)
		expect(f.requests).not.toContain('eth_sendRawTransaction')
	} finally {
		await f.close()
	}
})

test('#1471: late original inclusion wins over an outstanding cancellation', async () => {
	const f = await fixture()
	try {
		await recoverPendingTransactions(f.settings, f.wallet, f.state)
		f.control.receipt = true
		f.control.nonce = 1n
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(false)
		expect(f.state.pendingTransactions).toEqual([])
		expect(f.state.activities[0]?.message).toBe(`${f.intent.label}: completed`)
	} finally {
		await f.close()
	}
})

test('#1471: cancellation delivery failure remains visible and retries the same durable transaction', async () => {
	const f = await fixture()
	try {
		f.control.rejectCancellation = true
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(true)
		const cancellation = f.state.pendingTransactions[0]?.cancellation
		expect(cancellation).toBeDefined()
		expect(f.state.activities[0]?.message).toContain('Cancellation delivery unavailable')
		f.control.rejectCancellation = false
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(true)
		expect(f.state.pendingTransactions[0]?.cancellation).toEqual(cancellation)
		expect(f.control.cancellationHash).toBe(cancellation?.hash)
	} finally {
		await f.close()
	}
})
