import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createWalletClient, defineChain, encodeAbiParameters, encodeFunctionData, parseTransaction, privateKeyToAccount, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { securityPoolAbi, securityPoolFactoryAbi } from '@zoltar/bot-shared/contracts/abi'
import { prepareSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { parseSettings } from '#config/settings'
import { loadSettings, saveSettings } from '#config/settings-store'
import { createGoLiveControls } from '#core/go-live-controls'
import { recoverPendingTransactions } from '#execution/recovery'
import { initialRuntimeState, loadDurableState, saveDurableState } from '#state/operator-state'

async function fixture(kind: 'fees' | 'deployment' = 'fees') {
	const directory = await mkdtemp(join(tmpdir(), 'private-recovery-'))
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const target = kind === 'fees' ? '0x0000000000000000000000000000000000000020' : settings.deployment.securityPoolFactory
	const desired = { universeId: 0n, questionId: 1n, statoblastSecurityMultiplierBps: 20_000n, initialReportPriorityFeeAttoEthPerGas: 1n }
	settings.desiredPools = [desired]
	settings.approvedUniverses = [0n]
	settings.strategy.allowAutomaticPoolCreation = true
	if (account.signTransaction === undefined) throw new Error('Test account cannot sign')
	const data =
		kind === 'fees'
			? encodeFunctionData({ abi: securityPoolAbi, functionName: 'redeemFees', args: [account.address] })
			: encodeFunctionData({ abi: securityPoolFactoryAbi, functionName: 'deployOriginSecurityPool', args: [desired.universeId, desired.questionId, desired.statoblastSecurityMultiplierBps, desired.initialReportPriorityFeeAttoEthPerGas] })
	const signed = await prepareSignedTransaction({ baseFeePerGas: 1n, blockNumber: 100n, chainId: settings.network.chainId, data, from: account.address, gasEstimate: 250_000n, nonce: 0n, signTransaction: account.signTransaction, to: target })
	const control = { head: 140n, nonce: 0n, fail: false, simulationFails: false, baseFee: 1n, receipt: false, advanceDuringSimulation: 0n, claimableFees: 10n ** 18n, systemState: 0n, universeId: 0n }
	const broadcasts: unknown[] = []
	const persistedWindows: string[] = []
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const payload = await request.json()
			const method = Reflect.get(payload, 'method')
			const id = Reflect.get(payload, 'id')
			let result: unknown
			if (method === 'eth_getTransactionReceipt')
				result = control.receipt
					? { blockHash: `0x${'11'.repeat(32)}`, blockNumber: '0x64', contractAddress: null, cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1', from: account.address, gasUsed: '0x5208', logs: [], status: '0x1', to: target, transactionHash: signed.hash, transactionIndex: '0x0', type: '0x2' }
					: null
			else if (method === 'eth_getTransactionCount') result = `0x${control.nonce.toString(16)}`
			else if (method === 'eth_blockNumber') result = `0x${control.head.toString(16)}`
			else if (method === 'eth_getBlockByNumber') result = { number: Reflect.get(payload, 'params')?.[0] === 'latest' ? `0x${control.head.toString(16)}` : Reflect.get(payload, 'params')?.[0], hash: `0x${'11'.repeat(32)}`, baseFeePerGas: `0x${control.baseFee.toString(16)}`, timestamp: '0x1', transactions: [] }
			else if (method === 'eth_call') {
				const data = Reflect.get(payload, 'params')?.[0]?.data
				if (data === encodeFunctionData({ abi: securityPoolAbi, functionName: 'securityVaults', args: [account.address] })) return Response.json({ id, jsonrpc: '2.0', result: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [0n, 0n, control.claimableFees, 0n]) })
				if (data === encodeFunctionData({ abi: securityPoolAbi, functionName: 'systemState' })) return Response.json({ id, jsonrpc: '2.0', result: encodeAbiParameters([{ type: 'uint256' }], [control.systemState]) })
				if (data === encodeFunctionData({ abi: securityPoolAbi, functionName: 'universeId' })) return Response.json({ id, jsonrpc: '2.0', result: encodeAbiParameters([{ type: 'uint256' }], [control.universeId]) })
				if (control.simulationFails) return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: 'execution reverted' } })
				control.head += control.advanceDuringSimulation
				result = '0x'
			} else if (method === 'eth_sendPrivateTransaction') {
				broadcasts.push(Reflect.get(payload, 'params'))
				const disk = JSON.parse(await Bun.file(settings.runtime.stateFile).text())
				persistedWindows.push(disk.pendingTransactions[0].maxBlockNumber)
				if (control.fail) return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: 'relay unavailable' } })
				result = signed.hash
			} else throw new Error(`Unexpected RPC ${String(method)}`)
			return Response.json({ id, jsonrpc: '2.0', result })
		},
	})
	const url = server.url.toString()
	settings.runtime.stateFile = join(directory, 'state.json')
	settings.connectivity = { readRpcUrl: url, quorumRpcUrls: [], publicRpcUrls: [], rpcQuorum: 1 }
	settings.selectedPools = [target]
	settings.submission = { mode: 'private', relayUrls: [url], minimumBundleRelaySuccesses: 1 }
	const chain = defineChain({ id: settings.network.chainId, name: 'Recovery test', nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' }, rpcUrls: { default: { http: [url] } } })
	const wallet = createWalletClient({ account, chain, transport: custom({ request: async () => '0x1' }) })
	const state = initialRuntimeState(false, account.address, settings.network.chainId)
	state.pendingTransactions.push({
		hash: signed.hash,
		kind,
		label: 'Redeem fees',
		maxBlockNumber: signed.maxBlockNumber,
		mode: 'private',
		nonce: 0n,
		receiptExpectation: { type: 'transaction' },
		requiresMarketEvidence: false,
		sender: account.address,
		serializedTransaction: signed.serializedTransaction,
		submissionBlock: 100n,
	})
	await saveDurableState(settings.runtime.stateFile, state)
	return {
		settings,
		wallet,
		state,
		signed,
		control,
		broadcasts,
		persistedWindows,
		async close() {
			server.stop(true)
			await rm(directory, { recursive: true, force: true })
		},
	}
}

for (const head of [110n, 140n])
	test(`renews the private envelope at block ${head} before broadcast without changing the signature`, async () => {
		const f = await fixture()
		try {
			f.control.head = head
			expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(true)
			expect(f.broadcasts).toEqual([[{ maxBlockNumber: `0x${(head + 25n).toString(16)}`, tx: f.signed.serializedTransaction }]])
			expect(f.persistedWindows).toEqual([(head + 25n).toString()])
			expect(f.state.pendingTransactions[0]?.hash).toBe(f.signed.hash)
		} finally {
			await f.close()
		}
	})

test('persists renewal through broadcast failure and restart, preserving privacy and calldata validity', async () => {
	const f = await fixture()
	try {
		const intent = f.state.pendingTransactions[0]
		if (intent === undefined) throw new Error('Missing test intent')
		intent.lastValidBlockNumber = 150n
		f.control.fail = true
		await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow('relay unavailable')
		expect(f.persistedWindows).toEqual(['150'])
		const durable = await loadDurableState(f.settings.runtime.stateFile, f.settings.network.chainId)
		const restarted = initialRuntimeState(false, f.wallet.account.address, f.settings.network.chainId)
		restarted.pendingTransactions = durable.pendingTransactions
		expect(restarted.pendingTransactions[0]).toMatchObject({ maxBlockNumber: 150n, lastValidBlockNumber: 150n, serializedTransaction: f.signed.serializedTransaction, nonce: 0n, hash: f.signed.hash })
		f.control.fail = false
		f.control.head = 145n
		f.settings.submission.mode = 'public'
		await recoverPendingTransactions(f.settings, f.wallet, restarted)
		expect(f.broadcasts).toEqual(Array.from({ length: 2 }, () => [{ maxBlockNumber: '0x96', tx: f.signed.serializedTransaction }]))
		f.control.head = 150n
		await expect(recoverPendingTransactions(f.settings, f.wallet, restarted)).rejects.toThrow('calldata validity deadline has expired')
		expect(f.broadcasts).toHaveLength(2)
		expect((await loadDurableState(f.settings.runtime.stateFile, f.settings.network.chainId)).pendingTransactions[0]?.reconciliationReason).toContain('replace signer nonce 0')
	} finally {
		await f.close()
	}
})

for (const reason of ['nonce', 'market', 'migration', 'settings', 'simulation', 'fees'] as const)
	test(`retains unresolved intents without broadcasting when blocked by ${reason}`, async () => {
		const f = await fixture()
		try {
			const intent = f.state.pendingTransactions[0]
			if (intent === undefined) throw new Error('Missing test intent')
			if (reason === 'fees') f.control.baseFee = 10n ** 20n
			if (reason === 'nonce') f.control.nonce = 1n
			if (reason === 'market') intent.requiresMarketEvidence = true
			if (reason === 'migration') intent.kind = 'migration'
			if (reason === 'settings') f.settings.selectedPools = []
			if (reason === 'simulation') f.control.simulationFails = true
			await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow()
			expect(f.broadcasts).toHaveLength(0)
			expect(f.state.pendingTransactions).toHaveLength(1)
			expect((await loadDurableState(f.settings.runtime.stateFile, f.settings.network.chainId)).pendingTransactions).toHaveLength(1)
		} finally {
			await f.close()
		}
	})

test('replays only an origin deployment still authorized by current settings', async () => {
	const f = await fixture('deployment')
	try {
		await recoverPendingTransactions(f.settings, f.wallet, f.state)
		expect(f.persistedWindows).toEqual(['165'])
		f.settings.strategy.allowAutomaticPoolCreation = false
		await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow('no longer authorized')
		expect(f.broadcasts).toHaveLength(1)
	} finally {
		await f.close()
	}
})

test('does not broadcast when renewed metadata cannot be persisted', async () => {
	const f = await fixture()
	try {
		f.settings.runtime.stateFile = join(f.settings.runtime.stateFile, 'impossible.json')
		await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow()
		expect(f.broadcasts).toHaveLength(0)
		expect(f.state.pendingTransactions).toHaveLength(1)
	} finally {
		await f.close()
	}
})

test('requires quorum agreement on the current block before renewing the envelope', async () => {
	const f = await fixture()
	const secondary = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const payload = await request.json()
			const response = await fetch(f.settings.connectivity.readRpcUrl, { method: 'POST', body: JSON.stringify(payload) })
			const body = await response.json()
			if (Reflect.get(payload, 'method') === 'eth_getBlockByNumber') body.result.hash = `0x${'22'.repeat(32)}`
			return Response.json(body)
		},
	})
	try {
		f.settings.connectivity.quorumRpcUrls = [secondary.url.toString()]
		f.settings.connectivity.rpcQuorum = 2
		await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow()
		expect(f.broadcasts).toHaveLength(0)
		expect(f.state.pendingTransactions[0]?.maxBlockNumber).toBe(125n)
	} finally {
		secondary.stop(true)
		await f.close()
	}
})

test('recovers after stopping between window persistence and broadcast', async () => {
	const f = await fixture()
	try {
		let stoppingChecks = 0
		await recoverPendingTransactions(f.settings, f.wallet, f.state, undefined, () => ++stoppingChecks === 2)
		expect(f.broadcasts).toHaveLength(0)
		const durable = await loadDurableState(f.settings.runtime.stateFile, f.settings.network.chainId)
		expect(durable.pendingTransactions[0]?.maxBlockNumber).toBe(165n)
		const restarted = initialRuntimeState(false, f.wallet.account.address, f.settings.network.chainId)
		restarted.pendingTransactions = durable.pendingTransactions
		f.control.head = 170n
		await recoverPendingTransactions(f.settings, f.wallet, restarted)
		expect(f.persistedWindows).toEqual(['195'])
		expect(restarted.pendingTransactions[0]?.serializedTransaction).toBe(f.signed.serializedTransaction)
	} finally {
		await f.close()
	}
})

test('resolves a canonical finalized receipt before considering an expired window', async () => {
	const f = await fixture()
	try {
		f.control.receipt = true
		const intent = f.state.pendingTransactions[0]
		if (intent === undefined) throw new Error('Missing test intent')
		intent.lastValidBlockNumber = 100n
		expect(await recoverPendingTransactions(f.settings, f.wallet, f.state)).toBe(false)
		expect(f.broadcasts).toHaveLength(0)
		expect(f.state.pendingTransactions).toHaveLength(0)
		expect((await loadDurableState(f.settings.runtime.stateFile, f.settings.network.chainId)).pendingTransactions).toHaveLength(0)
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

test('derives the future window after a slow simulation advances the chain', async () => {
	const f = await fixture()
	try {
		f.control.advanceDuringSimulation = 30n
		await recoverPendingTransactions(f.settings, f.wallet, f.state)
		expect(f.persistedWindows).toEqual(['195'])
	} finally {
		await f.close()
	}
})

for (const reason of ['zero fees', 'below threshold', 'forked pool', 'unapproved universe'] as const)
	test(`retains fee redemption without broadcasting after ${reason}`, async () => {
		const f = await fixture()
		try {
			if (reason === 'zero fees') {
				f.control.claimableFees = 0n
				f.settings.strategy.redeemFeesAboveAttoEth = 0n
			}
			if (reason === 'below threshold') f.control.claimableFees = 1n
			if (reason === 'forked pool') f.control.systemState = 1n
			if (reason === 'unapproved universe') f.control.universeId = 1n
			await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow('Fee redemption')
			expect(f.broadcasts).toHaveLength(0)
			expect(f.state.pendingTransactions).toHaveLength(1)
			expect((await loadDurableState(f.settings.runtime.stateFile, f.settings.network.chainId)).pendingTransactions[0]?.reconciliationReason).toContain('Fee redemption')
		} finally {
			await f.close()
		}
	})

test('allows fee redemption exactly at a positive configured threshold', async () => {
	const f = await fixture()
	try {
		f.control.claimableFees = f.settings.strategy.redeemFeesAboveAttoEth
		await recoverPendingTransactions(f.settings, f.wallet, f.state)
		expect(f.broadcasts).toHaveLength(1)
	} finally {
		await f.close()
	}
})

test('requires quorum agreement on claimable fees before replay', async () => {
	const f = await fixture()
	const secondary = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const payload = await request.json()
			const response = await fetch(f.settings.connectivity.readRpcUrl, { method: 'POST', body: JSON.stringify(payload) })
			const body = await response.json()
			if (Reflect.get(payload, 'method') === 'eth_call' && Reflect.get(payload, 'params')?.[0]?.data === encodeFunctionData({ abi: securityPoolAbi, functionName: 'securityVaults', args: [f.wallet.account.address] }))
				body.result = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [0n, 0n, 0n, 0n])
			return Response.json(body)
		},
	})
	try {
		f.settings.connectivity.quorumRpcUrls = [secondary.url.toString()]
		f.settings.connectivity.rpcQuorum = 2
		await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow('RPC disagreement')
		expect(f.broadcasts).toHaveLength(0)
		expect(f.state.pendingTransactions[0]?.maxBlockNumber).toBe(125n)
	} finally {
		secondary.stop(true)
		await f.close()
	}
})

for (const exceedsLimit of [true, false])
	test(`checks signed maximum gas cost against the current spending limit (exceeds=${exceedsLimit})`, async () => {
		const f = await fixture()
		try {
			const transaction = parseTransaction(f.signed.serializedTransaction)
			if (transaction.gas === undefined || transaction.maxFeePerGas === undefined) throw new Error('Missing signed gas limits')
			f.settings.strategy.maximumGasCostAttoEth = transaction.gas * transaction.maxFeePerGas - (exceedsLimit ? 1n : 0n)
			if (exceedsLimit) {
				await expect(recoverPendingTransactions(f.settings, f.wallet, f.state)).rejects.toThrow('current maximum gas cost')
				expect(f.broadcasts).toHaveLength(0)
				const durable = await loadDurableState(f.settings.runtime.stateFile, f.settings.network.chainId)
				expect(durable.pendingTransactions[0]).toMatchObject({ maxBlockNumber: 125n, serializedTransaction: f.signed.serializedTransaction })
				expect(durable.pendingTransactions[0]?.reconciliationReason).toContain('current maximum gas cost')
			} else {
				await recoverPendingTransactions(f.settings, f.wallet, f.state)
				expect(f.broadcasts).toHaveLength(1)
			}
		} finally {
			await f.close()
		}
	})
