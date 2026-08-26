import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { ConnectivityDegradedError, createRpcEndpointPool, createWalletClient, getAddress, isHex, keccak256, mainnet, privateKeyToAccount, toHex } from '../support/bot-shared.ts'
import type { OperatorSettings } from '../../src/config/settings.ts'
import { OperationRediscoveryRequired, TransactionAwaitingRecovery, assertFreshWalletAssetDebits, assertStepPreflightCalls, executeOperationPlan, finalizedReceiptWithQuorum, type ExecutionEnvironment } from '../../src/execution/transaction-executor.ts'
import type { OperationPlan, OperationStep } from '../../src/operations/types.ts'
import { initialDurableState, initialRuntimeState, loadDurableState } from '../../src/state/operator-state.ts'

const servers: Array<{ stop: (closeActiveConnections?: boolean) => void }> = []
const directories: string[] = []
const sender = getAddress('0x0000000000000000000000000000000000000001')
const caller = getAddress('0x0000000000000000000000000000000000000002')
const target = getAddress('0x0000000000000000000000000000000000000003')
const zeroAddress = getAddress('0x0000000000000000000000000000000000000000')

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true)
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

function rpcRequest(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Expected a JSON-RPC request object')
	}
	return value
}

function settings(readRpcUrl: string, quorumRpcUrls: string[]): OperatorSettings {
	return {
		connectivity: {
			publicRpcUrls: [readRpcUrl],
			quorumRpcUrls,
			readRpcUrl,
			rpcQuorum: 2,
		},
		deployment: {
			openOracle: zeroAddress,
			questionData: zeroAddress,
			securityPoolFactory: zeroAddress,
			securityPoolForker: zeroAddress,
			tradingFactory: zeroAddress,
			tradingRouter: zeroAddress,
			weth: zeroAddress,
			zoltar: zeroAddress,
		},
		discovery: {
			maxPools: 1,
			maxQuestions: 1,
			maxStagedOperationsPerPool: 1,
			maxUniverses: 1,
			maxVaultsPerPool: 1,
		},
		network: { chainId: 1, explorerUrl: '', name: 'mainnet' },
		networkConfigured: true,
		paused: false,
		privateKey: undefined,
		runtime: {
			execute: true,
			lifecyclePollMilliseconds: 1_000,
			once: false,
			protocolLogBlockSpan: 1,
			protocolStartBlock: 0n,
			stateFile: '.state/test.json',
			ui: false,
			uiHost: '127.0.0.1',
			uiPort: 4_193,
		},
		scheduler: { maximumDelaySeconds: 61, minimumDelaySeconds: 60 },
		strategy: {
			allowHighRiskOperations: true,
			allowIrreversibleOperations: false,
			enabledEcosystems: ['statoblast'],
			maximumEthPerOperationAttoEth: 1n,
			maximumGasCostAttoEth: 1n,
			maximumRepPerOperationAttoRep: 1n,
			minimumEthReserveAttoEth: 0n,
			minimumRepReserveAttoRep: 0n,
			workflowValidForBlocks: 64n,
		},
		submission: {
			minimumBundleRelaySuccesses: 1,
			mode: 'public',
			relayUrls: [],
		},
		version: 1,
	}
}

function step(): OperationStep {
	return {
		data: '0x1234',
		evidence: [{ kind: 'receipt-success' }],
		gasLimit: '100000',
		id: 'outer',
		label: 'Outer coordinator call',
		preflightCalls: [
			{
				caller,
				data: '0xabcd',
				expectedResult: '0x1234',
				label: 'Direct pool mutation',
				to: target,
				value: '7',
			},
		],
		to: target,
		walletAssetDebits: [],
	}
}

function rpcServer(requests: unknown[], result: () => 'revert' | 'success' | 'unavailable') {
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = rpcRequest(await request.json())
			requests.push(body)
			const id = 'id' in body ? body.id : 1
			const outcome = result()
			if (outcome === 'unavailable') return new Response('Temporary RPC outage', { status: 503 })
			return outcome === 'success'
				? Response.json({ id, jsonrpc: '2.0', result: '0x1234' })
				: Response.json({
						error: {
							code: 3,
							message: 'execution reverted: downstream failed',
						},
						id,
						jsonrpc: '2.0',
					})
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

function creditRpcServer(balance: bigint) {
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = rpcRequest(await request.json())
			const id = 'id' in body ? body.id : 1
			return Response.json({
				id,
				jsonrpc: '2.0',
				result: toHex(balance, { size: 32 }),
			})
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

function combinedRepBalanceRpcServer(balances: { credit: () => bigint; wallet: () => bigint }, options: { available?: (() => boolean) | undefined; requests?: unknown[] | undefined } = {}) {
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = rpcRequest(await request.json())
			options.requests?.push(body)
			if (options.available?.() === false) return new Response('Temporary RPC outage', { status: 503 })
			if (!('method' in body) || body.method !== 'eth_call' || !('params' in body) || !Array.isArray(body.params)) {
				return new Response('Expected an eth_call request', { status: 400 })
			}
			const transaction = rpcRequest(body.params[0])
			const to = 'to' in transaction && typeof transaction.to === 'string' ? transaction.to.toLowerCase() : undefined
			let balance: bigint
			if (to === caller.toLowerCase()) balance = balances.credit()
			else if (to === target.toLowerCase()) balance = balances.wallet()
			else return new Response(`Unexpected balance target ${String(to)}`, { status: 400 })
			return Response.json({
				id: 'id' in body ? body.id : 1,
				jsonrpc: '2.0',
				result: toHex(balance, { size: 32 }),
			})
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

const receiptTransactionHash = `0x${'11'.repeat(32)}` as const
const receiptBlockHash = `0x${'22'.repeat(32)}` as const
const finalityBlockHash = `0x${'33'.repeat(32)}` as const

function receiptRpcServer(head: bigint, receiptVisible: boolean) {
	const requestedMethods: string[] = []
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = rpcRequest(await request.json())
			if (!('method' in body) || typeof body.method !== 'string') {
				return new Response('Expected a JSON-RPC method', { status: 400 })
			}
			requestedMethods.push(body.method)
			const id = 'id' in body ? body.id : 1
			if (body.method === 'eth_getTransactionReceipt') {
				return Response.json({
					id,
					jsonrpc: '2.0',
					result: receiptVisible
						? {
								blockHash: receiptBlockHash,
								blockNumber: '0x64',
								contractAddress: null,
								cumulativeGasUsed: '0x5208',
								effectiveGasPrice: '0x1',
								from: sender,
								gasUsed: '0x5208',
								logs: [],
								logsBloom: `0x${'00'.repeat(256)}`,
								status: '0x1',
								to: target,
								transactionHash: receiptTransactionHash,
								transactionIndex: '0x0',
								type: '0x2',
							}
						: null,
				})
			}
			if (body.method === 'eth_blockNumber') {
				return Response.json({ id, jsonrpc: '2.0', result: toHex(head) })
			}
			if (body.method === 'eth_getBlockByNumber') {
				if (!('params' in body) || !Array.isArray(body.params) || typeof body.params[0] !== 'string') {
					return new Response('Expected a numeric block request', {
						status: 400,
					})
				}
				const blockNumber = BigInt(body.params[0])
				if (blockNumber > head) return Response.json({ id, jsonrpc: '2.0', result: null })
				return Response.json({
					id,
					jsonrpc: '2.0',
					result: {
						baseFeePerGas: '0x1',
						difficulty: '0x0',
						extraData: '0x',
						gasLimit: '0x1c9c380',
						gasUsed: '0x5208',
						hash: blockNumber === 100n ? receiptBlockHash : finalityBlockHash,
						logsBloom: `0x${'00'.repeat(256)}`,
						miner: zeroAddress,
						mixHash: `0x${'00'.repeat(32)}`,
						nonce: '0x0000000000000000',
						number: toHex(blockNumber),
						parentHash: `0x${'44'.repeat(32)}`,
						receiptsRoot: `0x${'55'.repeat(32)}`,
						sha3Uncles: `0x${'66'.repeat(32)}`,
						size: '0x1',
						stateRoot: `0x${'77'.repeat(32)}`,
						timestamp: '0x1',
						totalDifficulty: '0x0',
						transactions: [],
						transactionsRoot: `0x${'88'.repeat(32)}`,
						uncles: [],
					},
				})
			}
			return new Response(`Unexpected RPC method ${body.method}`, {
				status: 500,
			})
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return {
		requestedMethods,
		url: `http://127.0.0.1:${server.port.toString()}`,
	}
}

function environment(firstUrl: string, secondUrl: string, ...additionalUrls: string[]): ExecutionEnvironment {
	const quorumRpcUrls = [secondUrl, ...additionalUrls]
	return {
		chain: mainnet,
		pool: createRpcEndpointPool([firstUrl, ...quorumRpcUrls]),
		sender,
		settings: settings(firstUrl, quorumRpcUrls),
		state: initialRuntimeState(false, sender, 1),
	}
}

describe('transaction receipt quorum', () => {
	test('accepts two matching current receipts while ignoring a pre-receipt lagging reader', async () => {
		const first = receiptRpcServer(112n, true)
		const second = receiptRpcServer(112n, true)
		const lagging = receiptRpcServer(99n, false)

		const result = await finalizedReceiptWithQuorum(environment(first.url, second.url, lagging.url), receiptTransactionHash)

		expect(result.observed).toBe(true)
		expect(result.receipt?.transactionHash).toBe(receiptTransactionHash)
		expect(lagging.requestedMethods).toContain('eth_getTransactionReceipt')
		expect(lagging.requestedMethods).toContain('eth_blockNumber')
		expect(lagging.requestedMethods).not.toContain('eth_getBlockByNumber')
	})

	test('fails closed when a reader at the receipt block cannot find the receipt', async () => {
		const first = receiptRpcServer(112n, true)
		const second = receiptRpcServer(112n, true)
		const capableMissing = receiptRpcServer(112n, false)

		await expect(finalizedReceiptWithQuorum(environment(first.url, second.url, capableMissing.url), receiptTransactionHash)).rejects.toThrow('RPC disagreement for receipt')
	})

	test('classifies a lone receipt without quorum as degraded connectivity', async () => {
		const onlyReceipt = receiptRpcServer(112n, true)
		const firstLagging = receiptRpcServer(99n, false)
		const secondLagging = receiptRpcServer(99n, false)

		await expect(finalizedReceiptWithQuorum(environment(onlyReceipt.url, firstLagging.url, secondLagging.url), receiptTransactionHash)).rejects.toBeInstanceOf(ConnectivityDegradedError)
	})
})

function requestTransaction(request: unknown) {
	const body = rpcRequest(request)
	if (!('method' in body) || body.method !== 'eth_call') {
		throw new Error('Expected an eth_call request')
	}
	const params = 'params' in body ? body.params : undefined
	if (!Array.isArray(params) || params.length !== 2) {
		throw new Error('Expected exact eth_call parameters')
	}
	const transaction = rpcRequest(params[0])
	return { blockTag: params[1], transaction }
}

describe('transaction downstream preflights', () => {
	test('uses the exact caller, calldata, value, target, and anchored block on every quorum endpoint', async () => {
		const firstRequests: unknown[] = []
		const secondRequests: unknown[] = []
		const firstUrl = rpcServer(firstRequests, () => 'success')
		const secondUrl = rpcServer(secondRequests, () => 'success')

		await assertStepPreflightCalls(environment(firstUrl, secondUrl), step(), {
			attestingRpcUrls: new Set([firstUrl, secondUrl]),
			number: 123n,
		})

		for (const requests of [firstRequests, secondRequests]) {
			expect(requests).toHaveLength(1)
			const { blockTag, transaction } = requestTransaction(requests[0])
			expect(blockTag).toBe('0x7b')
			expect(transaction).toEqual({
				data: '0xabcd',
				from: caller.toLowerCase(),
				to: target.toLowerCase(),
				value: '0x7',
			})
		}
	})

	test('turns a downstream revert into unsigned canonical rediscovery', async () => {
		const firstUrl = rpcServer([], () => 'revert')
		const secondUrl = rpcServer([], () => 'revert')
		try {
			await assertStepPreflightCalls(environment(firstUrl, secondUrl), step(), {
				attestingRpcUrls: new Set([firstUrl, secondUrl]),
				number: 123n,
			})
			throw new Error('Expected downstream preflight to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(OperationRediscoveryRequired)
			expect(error).toHaveProperty('message', expect.stringContaining('Direct pool mutation'))
		}
	})

	test('turns a changed downstream semantic result into unsigned canonical rediscovery', async () => {
		const firstUrl = rpcServer([], () => 'success')
		const secondUrl = rpcServer([], () => 'success')
		const changedStep = step()
		const preflight = changedStep.preflightCalls[0]
		if (preflight === undefined) throw new Error('Expected a downstream preflight')
		preflight.expectedResult = '0xabcd'
		try {
			await assertStepPreflightCalls(environment(firstUrl, secondUrl), changedStep, {
				attestingRpcUrls: new Set([firstUrl, secondUrl]),
				number: 123n,
			})
			throw new Error('Expected downstream preflight to require rediscovery')
		} catch (error) {
			expect(error).toBeInstanceOf(OperationRediscoveryRequired)
			expect(error).toHaveProperty('message', expect.stringContaining('different semantic result'))
		}
	})

	test('requires every canonical attester to complete an exact downstream preflight', async () => {
		const firstRequests: unknown[] = []
		const secondRequests: unknown[] = []
		const unavailableRequests: unknown[] = []
		const firstUrl = rpcServer(firstRequests, () => 'success')
		const secondUrl = rpcServer(secondRequests, () => 'success')
		const unavailableUrl = rpcServer(unavailableRequests, () => 'unavailable')

		await expect(
			assertStepPreflightCalls(environment(firstUrl, secondUrl, unavailableUrl), step(), {
				attestingRpcUrls: new Set([firstUrl, secondUrl, unavailableUrl]),
				number: 123n,
			}),
		).rejects.toBeInstanceOf(ConnectivityDegradedError)

		expect(firstRequests).toHaveLength(1)
		expect(secondRequests).toHaveLength(1)
		expect(unavailableRequests).toHaveLength(1)
	})

	test('fresh-checks internal OpenOracle credit and retains a one-atto buffer', async () => {
		const firstUrl = creditRpcServer(10n)
		const secondUrl = creditRpcServer(10n)
		const creditStep = step()
		creditStep.walletAssetDebits = [
			{
				amount: '9',
				asset: target,
				category: 'rep',
				kind: 'open-oracle-credit',
				openOracle: caller,
			},
		]
		const anchor = { attestingRpcUrls: new Set([firstUrl, secondUrl]), number: 123n }
		await expect(assertFreshWalletAssetDebits(environment(firstUrl, secondUrl), creditStep, anchor)).resolves.toBeUndefined()
		creditStep.walletAssetDebits[0] = {
			amount: '10',
			asset: target,
			category: 'rep',
			kind: 'open-oracle-credit',
			openOracle: caller,
		}
		await expect(assertFreshWalletAssetDebits(environment(firstUrl, secondUrl), creditStep, anchor)).rejects.toThrow('retained one-atto buffer')
	})

	test.each(['credit', 'wallet'] as const)('fresh-checks the combined wallet and OpenOracle REP reserve after a %s balance drop', async changedBalance => {
		let creditBalance = 51n
		let walletBalance = 60n
		const balances = {
			credit: () => creditBalance,
			wallet: () => walletBalance,
		}
		const firstUrl = combinedRepBalanceRpcServer(balances)
		const secondUrl = combinedRepBalanceRpcServer(balances)
		const currentEnvironment = environment(firstUrl, secondUrl)
		currentEnvironment.settings.strategy.minimumRepReserveAttoRep = 70n
		const anchor = { attestingRpcUrls: new Set([firstUrl, secondUrl]), number: 123n }
		const creditStep = step()
		creditStep.walletAssetDebits = [
			{
				amount: '40',
				asset: target,
				category: 'rep',
				kind: 'open-oracle-credit',
				openOracle: caller,
			},
		]

		await expect(assertFreshWalletAssetDebits(currentEnvironment, creditStep, anchor)).resolves.toBeUndefined()
		if (changedBalance === 'credit') creditBalance -= 1n
		else walletBalance -= 1n
		await expect(assertFreshWalletAssetDebits(currentEnvironment, creditStep, anchor)).rejects.toThrow('combined wallet and OpenOracle REP reserve')
	})

	test('does not substitute a nonattester when a canonical REP-balance reader is unavailable', async () => {
		const firstRequests: unknown[] = []
		const unavailableRequests: unknown[] = []
		const nonattesterRequests: unknown[] = []
		const balances = { credit: () => 1_000n, wallet: () => 1_000n }
		const firstUrl = combinedRepBalanceRpcServer(balances, { requests: firstRequests })
		const unavailableUrl = combinedRepBalanceRpcServer(balances, { available: () => false, requests: unavailableRequests })
		const nonattesterUrl = combinedRepBalanceRpcServer(balances, { requests: nonattesterRequests })
		const currentEnvironment = environment(firstUrl, unavailableUrl, nonattesterUrl)
		currentEnvironment.settings.strategy.minimumRepReserveAttoRep = 70n
		const creditStep = step()
		creditStep.walletAssetDebits = [
			{
				amount: '40',
				asset: target,
				category: 'rep',
				kind: 'open-oracle-credit',
				openOracle: caller,
			},
		]

		await expect(
			assertFreshWalletAssetDebits(currentEnvironment, creditStep, {
				attestingRpcUrls: new Set([firstUrl, unavailableUrl]),
				number: 123n,
			}),
		).rejects.toBeInstanceOf(ConnectivityDegradedError)
		expect(firstRequests).toHaveLength(1)
		expect(unavailableRequests).toHaveLength(1)
		expect(nonattesterRequests).toHaveLength(0)
	})
})

function executablePlan(): OperationPlan {
	return {
		classification: 'selectable',
		createdAtBlock: '99',
		definitionId: 'statoblast.pool.checkpoint-collateral',
		ecosystem: 'statoblast',
		id: 'plan:post-journal-anchor',
		label: 'Checkpoint pool collateral',
		metadata: {},
		obligation: false,
		planningSeed: 1,
		postconditions: ['The transaction succeeds'],
		priority: 'random',
		risk: 'low',
		steps: [
			{
				data: '0x1234',
				evidence: [{ kind: 'receipt-success' }],
				gasLimit: '100000',
				id: 'checkpoint',
				label: 'Checkpoint collateral',
				preflightCalls: [],
				to: target,
				walletAssetDebits: [],
			},
		],
	}
}

function executionRpcServer(options: { ethCall?: 'success' | 'unavailable'; head?: bigint } = {}) {
	const requestedMethods: string[] = []
	let currentHead = options.head ?? 99n
	let currentNonce = 3n
	let ethCallHook: (() => void) | undefined
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = rpcRequest(await request.json())
			if (!('method' in body) || typeof body.method !== 'string') return new Response('Expected a JSON-RPC method', { status: 400 })
			requestedMethods.push(body.method)
			const id = 'id' in body ? body.id : 1
			switch (body.method) {
				case 'eth_chainId':
					return Response.json({ id, jsonrpc: '2.0', result: '0x1' })
				case 'eth_blockNumber':
					return Response.json({
						id,
						jsonrpc: '2.0',
						result: toHex(currentHead),
					})
				case 'eth_getBalance':
					return Response.json({
						id,
						jsonrpc: '2.0',
						result: toHex(10n ** 20n),
					})
				case 'eth_getTransactionCount':
					return Response.json({
						id,
						jsonrpc: '2.0',
						result: toHex(currentNonce),
					})
				case 'eth_call':
					ethCallHook?.()
					return options.ethCall === 'unavailable' ? new Response('Temporary RPC outage', { status: 503 }) : Response.json({ id, jsonrpc: '2.0', result: '0x' })
				case 'eth_estimateGas':
					return Response.json({ id, jsonrpc: '2.0', result: '0x5208' })
				case 'eth_getTransactionReceipt':
					return Response.json({ id, jsonrpc: '2.0', result: null })
				case 'eth_sendRawTransaction': {
					const params = 'params' in body ? body.params : undefined
					const serializedTransaction = Array.isArray(params) ? params[0] : undefined
					if (typeof serializedTransaction !== 'string' || !isHex(serializedTransaction))
						return new Response('Expected a serialized transaction', {
							status: 400,
						})
					return Response.json({
						id,
						jsonrpc: '2.0',
						result: keccak256(serializedTransaction),
					})
				}
				case 'eth_getBlockByNumber':
					return Response.json({
						id,
						jsonrpc: '2.0',
						result: {
							baseFeePerGas: '0x1',
							difficulty: '0x0',
							extraData: '0x',
							gasLimit: '0x1c9c380',
							gasUsed: '0x0',
							hash: currentHead === 99n ? `0x${'99'.repeat(32)}` : `0x${'aa'.repeat(32)}`,
							logsBloom: `0x${'00'.repeat(256)}`,
							miner: zeroAddress,
							mixHash: `0x${'00'.repeat(32)}`,
							nonce: '0x0000000000000000',
							number: toHex(currentHead),
							parentHash: `0x${'44'.repeat(32)}`,
							receiptsRoot: `0x${'55'.repeat(32)}`,
							sha3Uncles: `0x${'66'.repeat(32)}`,
							size: '0x1',
							stateRoot: `0x${'77'.repeat(32)}`,
							timestamp: '0x1',
							totalDifficulty: '0x0',
							transactions: [],
							transactionsRoot: `0x${'88'.repeat(32)}`,
							uncles: [],
						},
					})
				default:
					return new Response(`Unexpected RPC method ${body.method}`, {
						status: 500,
					})
			}
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return {
		requestedMethods,
		setEthCallHook(value: () => void) {
			ethCallHook = value
		},
		setHead(value: bigint) {
			currentHead = value
		},
		setNonce(value: bigint) {
			currentNonce = value
		},
		url: `http://127.0.0.1:${server.port.toString()}`,
	}
}

async function postJournalExecutionFixture(postJournalHead: bigint) {
	const directory = await mkdtemp('/tmp/zoltar-chaos-execution-')
	directories.push(directory)
	const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
	const first = executionRpcServer()
	const second = executionRpcServer()
	const configured = settings(first.url, [second.url])
	const stateFile = join(directory, 'state.json')
	configured.runtime.stateFile = stateFile
	configured.strategy.maximumGasCostAttoEth = 10n ** 18n
	const pool = createRpcEndpointPool([first.url, second.url])
	const state = initialRuntimeState(false, account.address, 1, initialDurableState(1, false, 'profile:post-journal-anchor', account.address))
	const environment: ExecutionEnvironment = {
		beforeBroadcast: async () => {
			first.setHead(postJournalHead)
			second.setHead(postJournalHead)
		},
		chain: mainnet,
		pool,
		sender: account.address,
		settings: configured,
		state,
		wallet: createWalletClient({
			account,
			chain: mainnet,
			transport: pool.transport,
		}),
	}
	return { environment, first, second, state, stateFile }
}

describe('transaction signing-anchor re-attestation', () => {
	test('does not let a successful non-attester replace a failed signing-block attester', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-pre-signing-')
		directories.push(directory)
		const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
		const signTransaction = account.signTransaction
		let signingAttempts = 0
		account.signTransaction = async transaction => {
			signingAttempts += 1
			return await signTransaction(transaction)
		}
		const first = executionRpcServer()
		const unavailableAttester = executionRpcServer({ ethCall: 'unavailable' })
		const laggingNonAttester = executionRpcServer({ head: 98n })
		const configured = settings(first.url, [unavailableAttester.url, laggingNonAttester.url])
		configured.runtime.stateFile = join(directory, 'state.json')
		configured.strategy.maximumGasCostAttoEth = 10n ** 18n
		const pool = createRpcEndpointPool([first.url, unavailableAttester.url, laggingNonAttester.url])
		const state = initialRuntimeState(false, account.address, 1, initialDurableState(1, false, 'profile:strict-attesters', account.address))
		const environment: ExecutionEnvironment = {
			chain: mainnet,
			pool,
			sender: account.address,
			settings: configured,
			state,
			wallet: createWalletClient({
				account,
				chain: mainnet,
				transport: pool.transport,
			}),
		}

		await expect(executeOperationPlan(environment, executablePlan())).rejects.toBeInstanceOf(ConnectivityDegradedError)

		expect(state.pendingTransactions).toHaveLength(0)
		expect(signingAttempts).toBe(0)
		expect(first.requestedMethods).toContain('eth_call')
		expect(unavailableAttester.requestedMethods).toContain('eth_call')
		expect(laggingNonAttester.requestedMethods).not.toContain('eth_call')
		for (const methods of [first.requestedMethods, unavailableAttester.requestedMethods, laggingNonAttester.requestedMethods]) {
			expect(methods).not.toContain('eth_estimateGas')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
	})

	test('does not sign when a newly caught-up reader changes the canonical attester set after simulation', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-pre-signing-set-')
		directories.push(directory)
		const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
		const signTransaction = account.signTransaction
		let signingAttempts = 0
		account.signTransaction = async transaction => {
			signingAttempts += 1
			return await signTransaction(transaction)
		}
		const first = executionRpcServer()
		const second = executionRpcServer()
		const catchingUp = executionRpcServer({ head: 98n })
		first.setEthCallHook(() => catchingUp.setHead(99n))
		const configured = settings(first.url, [second.url, catchingUp.url])
		configured.runtime.stateFile = join(directory, 'state.json')
		configured.strategy.maximumGasCostAttoEth = 10n ** 18n
		const pool = createRpcEndpointPool([first.url, second.url, catchingUp.url])
		const state = initialRuntimeState(false, account.address, 1, initialDurableState(1, false, 'profile:changing-attesters', account.address))
		const environment: ExecutionEnvironment = {
			chain: mainnet,
			pool,
			sender: account.address,
			settings: configured,
			state,
			wallet: createWalletClient({ account, chain: mainnet, transport: pool.transport }),
		}

		await expect(executeOperationPlan(environment, executablePlan())).rejects.toThrow('attester set changed during pre-signing checks')

		expect(signingAttempts).toBe(0)
		expect(state.pendingTransactions).toHaveLength(0)
		expect(catchingUp.requestedMethods).not.toContain('eth_call')
		for (const methods of [first.requestedMethods, second.requestedMethods, catchingUp.requestedMethods]) expect(methods).not.toContain('eth_sendRawTransaction')
	})

	test('retains signed bytes when the canonical attester set changes before broadcast', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-post-journal-set-')
		directories.push(directory)
		const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
		const first = executionRpcServer()
		const second = executionRpcServer()
		const catchingUp = executionRpcServer({ head: 98n })
		const configured = settings(first.url, [second.url, catchingUp.url])
		const stateFile = join(directory, 'state.json')
		configured.runtime.stateFile = stateFile
		configured.strategy.maximumGasCostAttoEth = 10n ** 18n
		const pool = createRpcEndpointPool([first.url, second.url, catchingUp.url])
		const state = initialRuntimeState(false, account.address, 1, initialDurableState(1, false, 'profile:post-journal-changing-attesters', account.address))
		const environment: ExecutionEnvironment = {
			beforeBroadcast: async () => catchingUp.setHead(99n),
			chain: mainnet,
			pool,
			sender: account.address,
			settings: configured,
			state,
			wallet: createWalletClient({ account, chain: mainnet, transport: pool.transport }),
		}

		await expect(executeOperationPlan(environment, executablePlan())).rejects.toThrow('attester set changed after signed intent journaling')

		expect(state.pendingTransactions[0]?.status).toBe('signed')
		expect(state.workflows[0]?.status).toBe('waiting-transaction')
		const durable = await loadDurableState(stateFile, 1)
		expect(durable.pendingTransactions[0]?.status).toBe('signed')
		expect(catchingUp.requestedMethods).not.toContain('eth_call')
		for (const methods of [first.requestedMethods, second.requestedMethods, catchingUp.requestedMethods]) expect(methods).not.toContain('eth_sendRawTransaction')
	})

	test('retains signed bytes without broadcasting when the canonical head advances during durable journaling', async () => {
		const { environment, first, second, state, stateFile } = await postJournalExecutionFixture(100n)

		await expect(executeOperationPlan(environment, executablePlan())).rejects.toBeInstanceOf(TransactionAwaitingRecovery)
		expect(state.pendingTransactions[0]?.status).toBe('signed')
		expect(state.workflows[0]?.status).toBe('waiting-transaction')
		const durable = await loadDurableState(stateFile, 1)
		expect(durable.pendingTransactions[0]?.status).toBe('signed')
		expect(durable.workflows[0]?.status).toBe('waiting-transaction')
		for (const methods of [first.requestedMethods, second.requestedMethods]) expect(methods).not.toContain('eth_sendRawTransaction')
	})

	test('does not broadcast when durable journaling reaches the signed transport horizon', async () => {
		const { environment, first, second, state } = await postJournalExecutionFixture(124n)

		await expect(executeOperationPlan(environment, executablePlan())).rejects.toThrow('signed submission window closed before broadcast')
		expect(state.pendingTransactions[0]?.maxBlockNumber).toBe(124n)
		expect(state.pendingTransactions[0]?.status).toBe('signed')
		for (const methods of [first.requestedMethods, second.requestedMethods]) expect(methods).not.toContain('eth_sendRawTransaction')
	})

	test('does not broadcast when the pending nonce changes during durable journaling', async () => {
		const { environment, first, second, state } = await postJournalExecutionFixture(99n)
		environment.beforeBroadcast = async () => {
			first.setNonce(4n)
			second.setNonce(4n)
		}

		await expect(executeOperationPlan(environment, executablePlan())).rejects.toThrow('signer nonce 3 was consumed before broadcast')
		expect(state.pendingTransactions[0]?.status).toBe('signed')
		expect(state.workflows[0]?.status).toBe('waiting-transaction')
		for (const methods of [first.requestedMethods, second.requestedMethods]) expect(methods).not.toContain('eth_sendRawTransaction')
	})
})
