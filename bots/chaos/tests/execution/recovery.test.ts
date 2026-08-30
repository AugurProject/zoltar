import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { ConnectivityDegradedError, createRpcEndpointPool, createWalletClient, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, mainnet, privateKeyToAccount, toHex } from '../support/bot-shared.ts'
import type { OperatorSettings } from '../../src/config/settings.ts'
import { securityPoolAbi } from '../../src/contracts/abi.ts'
import { assertRecoverySubmissionMode, pendingIntentRecoveryAction, recoverPendingTransactions, transactionIsStrictNonceCancellation } from '../../src/execution/recovery.ts'
import { TransactionAwaitingRecovery, type ExecutionEnvironment } from '../../src/execution/transaction-executor.ts'
import type { OperationPlan } from '../../src/operations/types.ts'
import { createDurableWorkflow, markWorkflowStepSigned, markWorkflowStepSubmitted } from '../../src/runtime/workflows.ts'
import { initialDurableState, initialRuntimeState, loadDurableState, loadRuntimeState, saveDurableState, type PendingTransactionIntent } from '../../src/state/operator-state.ts'

const servers: Array<{ stop: (closeActiveConnections?: boolean) => void }> = []
const directories: string[] = []
const target = getAddress('0x0000000000000000000000000000000000000020')
const openOracle = getAddress('0x0000000000000000000000000000000000000021')
const zeroAddress = getAddress('0x0000000000000000000000000000000000000000')
const childRepSplitSignature = 'ChildRepSplit(address,uint256,uint256,uint256)'
const childRepSplitTopic = keccak256(toHex(childRepSplitSignature))
const recoveryReceiptBlockHash = `0x${'aa'.repeat(32)}` as const
const recoveryFinalityBlockHash = `0x${'bb'.repeat(32)}` as const
const recoveryReceiptClockTimestamp = 2_000_000n

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true)
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

function rpcRequest(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON-RPC request object')
	return value
}

type RecoveryGasEstimateOutcome = 'excessive' | 'malformed' | 'success' | 'unavailable' | 'zero'

type RecoveryRpcOptions = {
	baseFeePerGas?: bigint | undefined
	ethBalanceAttoEth?: bigint | undefined
	ethBalanceAttoEthUnavailable?: boolean | undefined
	ethCallUnavailable?: boolean | undefined
	gasEstimate?: RecoveryGasEstimateOutcome | undefined
	head?: bigint | undefined
	repBalances?: { credit: bigint; wallet: bigint } | undefined
	vaultBacking?: { amountAttoRep: bigint; vault: `0x${string}` } | undefined
}

function recoveryRpcServer(blockHash: `0x${string}`, transactionHash: `0x${string}`, options: RecoveryRpcOptions = {}) {
	const requestedMethods: string[] = []
	const requestedTransactions: Array<{ method: string; transaction: unknown }> = []
	let currentBlockHash = blockHash
	let currentHead = options.head ?? 99n
	let currentNonce = 3n
	let ethCallHook: (() => void) | undefined
	const vaultCall = options.vaultBacking === undefined ? undefined : encodeFunctionData({ abi: securityPoolAbi, args: [options.vaultBacking.vault], functionName: 'securityVaults' })
	const backingCall = options.vaultBacking === undefined ? undefined : encodeFunctionData({ abi: securityPoolAbi, args: [10n], functionName: 'backingUnitsToAttoRep' })
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = rpcRequest(await request.json())
			if (!('method' in body) || typeof body.method !== 'string') return new Response('Expected a JSON-RPC method', { status: 400 })
			requestedMethods.push(body.method)
			if ((body.method === 'eth_call' || body.method === 'eth_estimateGas') && 'params' in body && Array.isArray(body.params)) {
				requestedTransactions.push({ method: body.method, transaction: body.params[0] })
			}
			const id = 'id' in body ? body.id : 1
			switch (body.method) {
				case 'eth_chainId':
					return Response.json({ id, jsonrpc: '2.0', result: '0x1' })
				case 'eth_blockNumber':
					return Response.json({ id, jsonrpc: '2.0', result: toHex(currentHead) })
				case 'eth_getTransactionCount':
					return Response.json({ id, jsonrpc: '2.0', result: toHex(currentNonce) })
				case 'eth_getBalance':
					if (options.ethBalanceAttoEthUnavailable === true) return new Response('RPC temporarily unavailable', { status: 503 })
					return Response.json({ id, jsonrpc: '2.0', result: toHex(options.ethBalanceAttoEth ?? 10n ** 20n) })
				case 'eth_getTransactionByHash':
				case 'eth_getTransactionReceipt':
					return Response.json({ id, jsonrpc: '2.0', result: null })
				case 'eth_call':
					if (options.vaultBacking !== undefined && 'params' in body && Array.isArray(body.params)) {
						const transaction = rpcRequest(body.params[0])
						const to = 'to' in transaction && typeof transaction.to === 'string' ? transaction.to.toLowerCase() : undefined
						const data = 'data' in transaction && typeof transaction.data === 'string' ? transaction.data.toLowerCase() : undefined
						if (to === target.toLowerCase() && data === vaultCall) {
							return Response.json({ id, jsonrpc: '2.0', result: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 0n, 0n, 0n]) })
						}
						if (to === target.toLowerCase() && data === backingCall) return Response.json({ id, jsonrpc: '2.0', result: toHex(options.vaultBacking.amountAttoRep, { size: 32 }) })
					}
					if (options.repBalances !== undefined && 'params' in body && Array.isArray(body.params)) {
						const transaction = rpcRequest(body.params[0])
						const to = 'to' in transaction && typeof transaction.to === 'string' ? transaction.to.toLowerCase() : undefined
						const data = 'data' in transaction && typeof transaction.data === 'string' ? transaction.data.toLowerCase() : undefined
						if (to === openOracle.toLowerCase()) return Response.json({ id, jsonrpc: '2.0', result: toHex(options.repBalances.credit, { size: 32 }) })
						if (to === target.toLowerCase() && data !== '0x1234') return Response.json({ id, jsonrpc: '2.0', result: toHex(options.repBalances.wallet, { size: 32 }) })
					}
					ethCallHook?.()
					if (options.ethCallUnavailable === true) return new Response('RPC temporarily unavailable', { status: 503 })
					return Response.json({ id, jsonrpc: '2.0', result: '0x' })
				case 'eth_estimateGas':
					if (options.gasEstimate === 'unavailable') return new Response('RPC temporarily unavailable', { status: 503 })
					if (options.gasEstimate === 'malformed') return Response.json({ id, jsonrpc: '2.0', result: 'not-hex' })
					if (options.gasEstimate === 'zero') return Response.json({ id, jsonrpc: '2.0', result: '0x0' })
					if (options.gasEstimate === 'excessive') return Response.json({ id, jsonrpc: '2.0', result: toHex(100_001n) })
					return Response.json({ id, jsonrpc: '2.0', result: '0x5208' })
				case 'eth_sendRawTransaction':
					return Response.json({ id, jsonrpc: '2.0', result: transactionHash })
				case 'eth_getBlockByNumber':
					return Response.json({
						id,
						jsonrpc: '2.0',
						result: {
							baseFeePerGas: toHex(options.baseFeePerGas ?? 1n),
							difficulty: '0x0',
							extraData: '0x',
							gasLimit: '0x1c9c380',
							gasUsed: '0x0',
							hash: currentBlockHash,
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
					return new Response(`Unexpected RPC method ${body.method}`, { status: 500 })
			}
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return {
		requestedMethods,
		requestedTransactions,
		setEthCallHook(value: () => void) {
			ethCallHook = value
		},
		setHead(value: bigint) {
			currentHead = value
		},
		setNonce(value: bigint) {
			currentNonce = value
		},
		setBlockHash(value: `0x${string}`) {
			currentBlockHash = value
		},
		url: `http://127.0.0.1:${server.port.toString()}`,
	}
}

function recoveryPlan(downstreamPreflight = false, transactionValue = 0n): OperationPlan {
	return {
		classification: 'selectable',
		createdAtBlock: '99',
		definitionId: 'open-oracle.dust',
		ecosystem: 'open-oracle',
		id: 'plan:recovery-fork-test',
		label: 'Recovery fork test',
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
				id: 'dust',
				label: 'Dust tokens',
				preflightCalls: downstreamPreflight
					? [
							{
								caller: target,
								data: '0xabcd',
								expectedResult: '0x',
								label: 'Downstream recovery guard',
								to: target,
								value: '0',
							},
						]
					: [],
				to: target,
				...(transactionValue === 0n ? {} : { value: transactionValue.toString() }),
				walletAssetDebits: transactionValue === 0n ? [] : [{ amount: transactionValue.toString(), asset: 'ETH', kind: 'native' }],
			},
		],
	}
}

function canonicalLifecycleRecoveryPlan(): OperationPlan {
	const plan = recoveryPlan()
	const step = plan.steps[0]
	const targetAttoRep = 100n.toString()
	if (step === undefined) throw new Error('Recovery test plan is missing its step')
	return {
		...plan,
		classification: 'lifecycle-obligation',
		definitionId: 'statoblast.fork.migrate-rep',
		ecosystem: 'statoblast',
		id: 'plan:recovered-migrate-rep',
		label: 'Fork workflow: migrate-rep',
		metadata: { outcome: '0', pool: target, targetAttoRep },
		obligation: true,
		priority: 'urgent',
		steps: [
			{
				...step,
				evidence: [
					{
						abi: 'event ChildRepSplit(address indexed parent, uint256 indexed outcomeIndex, uint256 childPoolRepSplitAttoRep, uint256 pendingChildAttoRep)',
						canonicalLifecycleConfirmation: true,
						emitter: target,
						equals: targetAttoRep,
						field: 'childPoolRepSplitAttoRep',
						indexed: { outcomeIndex: '0', parent: target },
						kind: 'decoded-event-field',
						signature: childRepSplitSignature,
						topic0: childRepSplitTopic,
					},
				],
				id: 'migrate-rep',
				label: 'migrate-rep',
			},
		],
	}
}

function recoverySettings(readRpcUrl: string, quorumRpcUrls: string[], stateFile: string): OperatorSettings {
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
		discovery: { maxPools: 1, maxQuestions: 1, maxStagedOperationsPerPool: 1, maxUniverses: 1, maxVaultsPerPool: 1 },
		network: { chainId: 1, explorerUrl: '', maximumBlockIntervalSeconds: 15, name: 'mainnet' },
		networkConfigured: true,
		paused: false,
		privateKey: undefined,
		runtime: {
			execute: true,
			lifecyclePollMilliseconds: 1_000,
			once: false,
			protocolLogBlockSpan: 1,
			protocolStartBlock: 0n,
			stateFile,
			ui: false,
			uiHost: '127.0.0.1',
			uiPort: 4_193,
		},
		scheduler: { maximumDelaySeconds: 61, minimumDelaySeconds: 60 },
		strategy: {
			allowHighRiskOperations: true,
			allowIrreversibleOperations: false,
			enabledEcosystems: ['open-oracle'],
			maximumEthPerOperationAttoEth: 10n ** 20n,
			maximumGasCostAttoEth: 10n ** 20n,
			maximumRepPerOperationAttoRep: 10n ** 20n,
			minimumEthReserveAttoEth: 0n,
			minimumRepReserveAttoRep: 0n,
			workflowValidForBlocks: 64n,
		},
		submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
		version: 1,
	}
}

type FinalizedRecoveryRpcState = {
	account: `0x${string}`
	cancellationHash?: `0x${string}` | undefined
	originalHash: `0x${string}`
	receiptHash: `0x${string}`
	receiptStatus: '0x0' | '0x1'
	replacementHash?: `0x${string}` | undefined
	signerCode: `0x${string}`
	transactionType: '0x2' | '0x4'
}

function finalizedRecoveryRpcServer(state: FinalizedRecoveryRpcState) {
	const requestedCodeBlocks: string[] = []
	const requestedMethods: string[] = []
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = rpcRequest(await request.json())
			if (!('method' in body) || typeof body.method !== 'string') return new Response('Expected a JSON-RPC method', { status: 400 })
			requestedMethods.push(body.method)
			const id = 'id' in body ? body.id : 1
			const params = 'params' in body && Array.isArray(body.params) ? body.params : []
			const requestedHash = params[0]
			const isReplacement = typeof requestedHash === 'string' && requestedHash.toLowerCase() === state.replacementHash?.toLowerCase()
			const isCancellation = typeof requestedHash === 'string' && requestedHash.toLowerCase() === state.cancellationHash?.toLowerCase()
			switch (body.method) {
				case 'eth_chainId':
					return Response.json({ id, jsonrpc: '2.0', result: '0x1' })
				case 'eth_blockNumber':
					return Response.json({ id, jsonrpc: '2.0', result: toHex(112n) })
				case 'eth_getTransactionByHash':
					return Response.json({
						id,
						jsonrpc: '2.0',
						result:
							isReplacement || isCancellation
								? {
										blockHash: recoveryReceiptBlockHash,
										blockNumber: toHex(100n),
										from: state.account,
										gas: toHex(100_000n),
										hash: requestedHash,
										input: isCancellation ? '0x' : '0x1234',
										maxFeePerGas: '0x3',
										maxPriorityFeePerGas: '0x1',
										nonce: '0x3',
										to: isCancellation ? state.account : target,
										transactionIndex: '0x0',
										type: state.transactionType,
										value: '0x0',
									}
								: null,
					})
				case 'eth_getTransactionReceipt':
					return Response.json({
						id,
						jsonrpc: '2.0',
						result:
							typeof requestedHash === 'string' && requestedHash.toLowerCase() === state.receiptHash.toLowerCase()
								? {
										blockHash: recoveryReceiptBlockHash,
										blockNumber: toHex(100n),
										contractAddress: null,
										cumulativeGasUsed: '0x5208',
										effectiveGasPrice: '0x1',
										from: state.account,
										gasUsed: '0x5208',
										logs: [],
										logsBloom: `0x${'00'.repeat(256)}`,
										status: state.receiptStatus,
										to: state.cancellationHash?.toLowerCase() === state.receiptHash.toLowerCase() ? state.account : target,
										transactionHash: state.receiptHash,
										transactionIndex: '0x0',
										type: state.transactionType,
									}
								: null,
					})
				case 'eth_getCode':
					if (params[0]?.toString().toLowerCase() !== state.account.toLowerCase() || typeof params[1] !== 'string') return new Response('Unexpected signer code request', { status: 400 })
					requestedCodeBlocks.push(params[1])
					return Response.json({ id, jsonrpc: '2.0', result: state.signerCode })
				case 'eth_getBlockByNumber': {
					if (typeof params[0] !== 'string') return new Response('Expected a numeric block request', { status: 400 })
					const blockNumber = BigInt(params[0])
					return Response.json({
						id,
						jsonrpc: '2.0',
						result: {
							baseFeePerGas: '0x1',
							difficulty: '0x0',
							extraData: '0x',
							gasLimit: '0x1c9c380',
							gasUsed: '0x5208',
							hash: blockNumber === 100n ? recoveryReceiptBlockHash : recoveryFinalityBlockHash,
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
							timestamp: toHex(recoveryReceiptClockTimestamp),
							totalDifficulty: '0x0',
							transactions: [],
							transactionsRoot: `0x${'88'.repeat(32)}`,
							uncles: [],
						},
					})
				}
				default:
					return new Response(`Unexpected RPC method ${body.method}`, { status: 500 })
			}
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return {
		requestedCodeBlocks,
		requestedMethods,
		url: `http://127.0.0.1:${server.port.toString()}`,
	}
}

type FinalizedRecoveryMode = 'cancellation' | 'original' | 'replacement'
type FinalizedRecoveryOutcome = 'revert' | 'semantic-failure' | 'success'

type FinalizedRecoveryOptions = {
	signerCode?: `0x${string}` | undefined
	transactionType?: '0x2' | '0x4' | undefined
}

async function finalizedRecoveryEnvironment(mode: FinalizedRecoveryMode, outcome: FinalizedRecoveryOutcome = 'success', options: FinalizedRecoveryOptions = {}) {
	const directory = await mkdtemp('/tmp/zoltar-chaos-finalized-recovery-')
	directories.push(directory)
	const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
	const serializedTransaction = await account.signTransaction({
		chainId: 1,
		data: '0x1234',
		gas: 100_000n,
		maxFeePerGas: 2n,
		maxPriorityFeePerGas: 1n,
		nonce: 3n,
		to: target,
		value: 0n,
	})
	const originalHash = keccak256(serializedTransaction)
	const replacementHash = `0x${'99'.repeat(32)}` as const
	const cancellationHash = `0x${'88'.repeat(32)}` as const
	const receiptHashByMode = { cancellation: cancellationHash, original: originalHash, replacement: replacementHash }
	const rpcState: FinalizedRecoveryRpcState = {
		account: account.address,
		...(mode === 'cancellation' ? { cancellationHash } : {}),
		originalHash,
		receiptHash: receiptHashByMode[mode],
		receiptStatus: outcome === 'revert' ? '0x0' : '0x1',
		...(mode === 'replacement' ? { replacementHash } : {}),
		signerCode: options.signerCode ?? '0x',
		transactionType: options.transactionType ?? '0x2',
	}
	const first = finalizedRecoveryRpcServer(rpcState)
	const second = finalizedRecoveryRpcServer(rpcState)
	const stateFile = join(directory, 'state.json')
	const settings = recoverySettings(first.url, [second.url], stateFile)
	const plan = canonicalLifecycleRecoveryPlan()
	const workflow = createDurableWorkflow(plan)
	const step = plan.steps[0]
	if (step === undefined) throw new Error('Recovery test plan is missing its step')
	const intent: PendingTransactionIntent = {
		...(mode === 'cancellation' ? { cancellationHash } : {}),
		data: '0x1234',
		hash: originalHash,
		id: `intent:${originalHash.slice(2)}`,
		label: step.label,
		maxBlockNumber: 120n,
		mode: 'public',
		nonce: 3n,
		operationId: plan.definitionId,
		...(mode === 'replacement' ? { replacementHash } : {}),
		semanticExpectation: {
			balanceBaselines: [],
			evidence: outcome === 'semantic-failure' ? [{ emitter: target, kind: 'event', signature: childRepSplitSignature, topic0: childRepSplitTopic }] : step.evidence,
			postconditions: plan.postconditions,
			storageBaselines: [],
		},
		sender: account.address,
		serializedTransaction,
		signedAt: new Date().toISOString(),
		status: 'confirmation-unknown',
		stepId: step.id,
		submissionBlock: 99n,
		submittedAt: new Date().toISOString(),
		to: target,
		value: 0n,
		workflowId: workflow.id,
	}
	markWorkflowStepSigned(workflow, intent.stepId, intent.id, intent.hash)
	markWorkflowStepSubmitted(workflow, intent.stepId)
	const state = initialRuntimeState(false, account.address, 1, initialDurableState(1, false, 'profile:finalized-recovery', account.address))
	state.pendingTransactions.push(intent)
	state.workflows.push(workflow)
	await saveDurableState(stateFile, state)
	const recoveredState = await loadRuntimeState(stateFile, false, account.address, 1)
	const pool = createRpcEndpointPool([first.url, second.url])
	return {
		environment: {
			chain: mainnet,
			clock: () => Number(recoveryReceiptClockTimestamp * 1_000n),
			pool,
			sender: account.address,
			settings,
			state: recoveredState,
		} satisfies ExecutionEnvironment,
		requestedCodeBlocks: [first.requestedCodeBlocks, second.requestedCodeBlocks],
		requestedMethods: [first.requestedMethods, second.requestedMethods],
		state: recoveredState,
		stateFile,
	}
}

type RecoveryDispositionCollections = Pick<ExecutionEnvironment['state'], 'activities' | 'pendingTransactions' | 'workflows'>

function recoveryDispositionCollections(state: RecoveryDispositionCollections) {
	return structuredClone({
		activities: state.activities,
		pendingTransactions: state.pendingTransactions,
		workflows: state.workflows,
	})
}

function failRecoveryDispositionPersistence(environment: ExecutionEnvironment) {
	const submittedJournal = recoveryDispositionCollections(environment.state)
	let persistenceCalls = 0
	let failed = false
	environment.persistState = async state => {
		persistenceCalls += 1
		await saveDurableState(environment.settings.runtime.stateFile, state)
		if (!failed && state.pendingTransactions.length === 0) {
			failed = true
			throw new Error('injected recovery disposition persistence failure')
		}
	}
	return {
		persistenceCalls: () => persistenceCalls,
		submittedJournal,
	}
}

type RecoveryEnvironmentOptions = {
	baseFeePerGas?: bigint | undefined
	catchUpThirdDuringReplay?: boolean | undefined
	downstreamPreflight?: boolean | undefined
	ethBalanceAttoEth?: bigint | undefined
	maximumEthPerOperationAttoEth?: bigint | undefined
	maximumGasCostAttoEth?: bigint | undefined
	maximumRepPerOperationAttoRep?: bigint | undefined
	minimumEthReserveAttoEth?: bigint | undefined
	repBalances?: { credit: bigint; wallet: bigint } | undefined
	secondEthBalanceAttoEthUnavailable?: boolean | undefined
	thirdGasEstimate?: RecoveryGasEstimateOutcome | undefined
	transactionValue?: bigint | undefined
	unavailableThirdAttester?: boolean | undefined
	vaultBackingAttoRep?: bigint | undefined
	vaultRepDebit?: bigint | undefined
}

async function forkedRecoveryEnvironment(options: RecoveryEnvironmentOptions = {}) {
	const directory = await mkdtemp('/tmp/zoltar-chaos-recovery-')
	directories.push(directory)
	const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
	const serializedTransaction = await account.signTransaction({
		chainId: 1,
		data: '0x1234',
		gas: 100_000n,
		maxFeePerGas: 2n,
		maxPriorityFeePerGas: 1n,
		nonce: 3n,
		to: target,
		value: options.transactionValue ?? 0n,
	})
	const hash = keccak256(serializedTransaction)
	const commonRpcOptions = {
		baseFeePerGas: options.baseFeePerGas,
		ethBalanceAttoEth: options.ethBalanceAttoEth,
		repBalances: options.repBalances,
		vaultBacking: options.vaultBackingAttoRep === undefined ? undefined : { amountAttoRep: options.vaultBackingAttoRep, vault: account.address },
	}
	const first = recoveryRpcServer(`0x${'11'.repeat(32)}`, hash, commonRpcOptions)
	const second = recoveryRpcServer(`0x${'11'.repeat(32)}`, hash, { ...commonRpcOptions, ethBalanceAttoEthUnavailable: options.secondEthBalanceAttoEthUnavailable })
	const needsThird = options.unavailableThirdAttester === true || options.thirdGasEstimate !== undefined || options.catchUpThirdDuringReplay === true || options.secondEthBalanceAttoEthUnavailable === true
	const third = needsThird
		? recoveryRpcServer(`0x${'11'.repeat(32)}`, hash, {
				...commonRpcOptions,
				...(options.unavailableThirdAttester === true ? { ethCallUnavailable: true } : {}),
				...(options.thirdGasEstimate === undefined ? {} : { gasEstimate: options.thirdGasEstimate }),
				head: options.catchUpThirdDuringReplay === true || options.secondEthBalanceAttoEthUnavailable === true ? 98n : 99n,
			})
		: undefined
	const rpcServers = third === undefined ? [first, second] : [first, second, third]
	if (options.catchUpThirdDuringReplay === true && third !== undefined) {
		first.setEthCallHook(() => third.setHead(99n))
	}
	const settings = recoverySettings(
		first.url,
		rpcServers.slice(1).map(server => server.url),
		join(directory, 'state.json'),
	)
	settings.strategy.maximumEthPerOperationAttoEth = options.maximumEthPerOperationAttoEth ?? settings.strategy.maximumEthPerOperationAttoEth
	settings.strategy.maximumGasCostAttoEth = options.maximumGasCostAttoEth ?? settings.strategy.maximumGasCostAttoEth
	settings.strategy.maximumRepPerOperationAttoRep = options.maximumRepPerOperationAttoRep ?? settings.strategy.maximumRepPerOperationAttoRep
	settings.strategy.minimumEthReserveAttoEth = options.minimumEthReserveAttoEth ?? settings.strategy.minimumEthReserveAttoEth
	const pool = createRpcEndpointPool(rpcServers.map(server => server.url))
	const plan = recoveryPlan(options.downstreamPreflight, options.transactionValue)
	if (options.repBalances !== undefined) {
		const step = plan.steps[0]
		if (step === undefined) throw new Error('Recovery test plan is missing its step')
		step.walletAssetDebits = [{ amount: '40', asset: target, category: 'rep', kind: 'open-oracle-credit', openOracle }]
		settings.strategy.minimumRepReserveAttoRep = 70n
	}
	if (options.vaultRepDebit !== undefined) {
		const step = plan.steps[0]
		if (step === undefined) throw new Error('Recovery test plan is missing its step')
		step.walletAssetDebits = [{ amount: options.vaultRepDebit.toString(), category: 'rep', kind: 'security-pool-vault-rep', pool: target, vault: account.address }]
	}
	const workflow = createDurableWorkflow(plan)
	const intent: PendingTransactionIntent = {
		data: '0x1234',
		hash,
		id: `intent:${hash.slice(2)}`,
		label: 'Dust tokens',
		maxBlockNumber: 100n,
		mode: 'public',
		nonce: 3n,
		operationId: plan.definitionId,
		semanticExpectation: { balanceBaselines: [], evidence: [{ kind: 'receipt-success' }], postconditions: plan.postconditions, storageBaselines: [] },
		sender: account.address,
		serializedTransaction,
		signedAt: new Date().toISOString(),
		status: 'signed',
		stepId: 'dust',
		to: target,
		value: options.transactionValue ?? 0n,
		workflowId: workflow.id,
	}
	markWorkflowStepSigned(workflow, intent.stepId, intent.id, intent.hash)
	const state = initialRuntimeState(false, account.address, 1, initialDurableState(1, false, 'profile:recovery-fork-test', account.address))
	state.pendingTransactions.push(intent)
	state.workflows.push(workflow)
	const environment: ExecutionEnvironment = {
		chain: mainnet,
		clock: () => 1_000,
		pool,
		sender: account.address,
		settings,
		state,
		wallet: createWalletClient({ account, chain: mainnet, transport: pool.transport }),
	}
	return {
		advanceBothDuringReplay() {
			let advanced = false
			first.setEthCallHook(() => {
				if (advanced) return
				advanced = true
				first.setBlockHash(`0x${'33'.repeat(32)}`)
				second.setBlockHash(`0x${'33'.repeat(32)}`)
			})
		},
		consumeNonceDuringReplay() {
			let consumed = false
			first.setEthCallHook(() => {
				if (consumed) return
				consumed = true
				first.setNonce(4n)
				second.setNonce(4n)
			})
		},
		environment,
		forkSecondReader: () => second.setBlockHash(`0x${'22'.repeat(32)}`),
		requestedMethods: rpcServers.map(server => server.requestedMethods),
		requestedTransactions: rpcServers.map(server => server.requestedTransactions),
		setHeads(value: bigint) {
			first.setHead(value)
			second.setHead(value)
		},
		setNonces(value: bigint) {
			first.setNonce(value)
			second.setNonce(value)
		},
	}
}

describe('pending chaos transaction recovery decisions', () => {
	describe('atomic recovery disposition persistence', () => {
		test.each([
			{ mode: 'original', outcome: 'success', scenario: 'successful original receipt' },
			{ mode: 'original', outcome: 'revert', scenario: 'reverted original receipt' },
			{ mode: 'original', outcome: 'semantic-failure', scenario: 'semantically invalid original receipt' },
			{ mode: 'replacement', outcome: 'success', scenario: 'successful exact replacement' },
			{ mode: 'replacement', outcome: 'revert', scenario: 'reverted exact replacement' },
			{ mode: 'cancellation', outcome: 'success', scenario: 'verified nonce cancellation' },
		] satisfies readonly { mode: FinalizedRecoveryMode; outcome: FinalizedRecoveryOutcome; scenario: string }[])('retains the submitted journal when $scenario disposition persistence fails', async ({ mode, outcome }) => {
			const fixture = await finalizedRecoveryEnvironment(mode, outcome)
			const failure = failRecoveryDispositionPersistence(fixture.environment)

			await expect(recoverPendingTransactions(fixture.environment, { resubmit: false })).rejects.toBeInstanceOf(TransactionAwaitingRecovery)

			expect(failure.persistenceCalls()).toBe(2)
			expect(recoveryDispositionCollections(fixture.state)).toEqual(failure.submittedJournal)
			const durable = await loadDurableState(fixture.stateFile, 1)
			expect(recoveryDispositionCollections(durable)).toEqual(failure.submittedJournal)
			expect(fixture.state.pendingTransactions).toHaveLength(1)
			expect(fixture.state.workflows[0]?.status).toBe('waiting-transaction')
		})
	})

	test('restores a persisted successful empty-log receipt as waiting for canonical confirmation', async () => {
		const fixture = await finalizedRecoveryEnvironment('original')

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: false })).resolves.toBe(true)

		expect(fixture.state.pendingTransactions).toHaveLength(0)
		expect(fixture.state.workflows[0]?.status).toBe('waiting-obligation')
		expect(fixture.state.workflows[0]?.steps[0]).toMatchObject({ status: 'confirmed', transactionHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) })
		const durable = await loadDurableState(fixture.stateFile, 1)
		expect(durable.pendingTransactions).toHaveLength(0)
		expect(durable.workflows[0]?.status).toBe('waiting-obligation')
	})

	test('restores a queued exact replacement empty-log receipt as waiting for canonical confirmation', async () => {
		const fixture = await finalizedRecoveryEnvironment('replacement')

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: false })).resolves.toBe(true)

		expect(fixture.state.pendingTransactions).toHaveLength(0)
		expect(fixture.state.workflows[0]?.status).toBe('waiting-obligation')
		expect(fixture.state.workflows[0]?.steps[0]).toMatchObject({ status: 'confirmed', transactionHash: `0x${'99'.repeat(32)}` })
		const durable = await loadDurableState(fixture.stateFile, 1)
		expect(durable.pendingTransactions).toHaveLength(0)
		expect(durable.workflows[0]?.status).toBe('waiting-obligation')
	})

	test.each([
		{ mode: 'replacement', subject: 'Replacement transaction' },
		{ mode: 'cancellation', subject: 'Nonce cancellation' },
	] satisfies readonly { mode: 'cancellation' | 'replacement'; subject: string }[])('rejects an otherwise exact EIP-7702 $mode without changing recovery state', async ({ mode, subject }) => {
		const fixture = await finalizedRecoveryEnvironment(mode, 'success', { transactionType: '0x4' })
		const before = recoveryDispositionCollections(fixture.state)

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: false })).rejects.toThrow(`${subject} must use a bot-compatible EIP-1559 transaction`)

		expect(recoveryDispositionCollections(fixture.state)).toEqual(before)
		expect(recoveryDispositionCollections(await loadDurableState(fixture.stateFile, 1))).toEqual(before)
	})

	test('rejects a type-2 nonce cancellation when the signer has code at the finalized receipt block', async () => {
		const fixture = await finalizedRecoveryEnvironment('cancellation', 'success', { signerCode: `0xef0100${'22'.repeat(20)}` })
		const before = recoveryDispositionCollections(fixture.state)

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: false })).rejects.toThrow('Nonce cancellation signer has code at its finalized receipt block')

		expect(recoveryDispositionCollections(fixture.state)).toEqual(before)
		expect(recoveryDispositionCollections(await loadDurableState(fixture.stateFile, 1))).toEqual(before)
	})

	test('accepts a type-2 nonce cancellation only with quorum-proven empty signer code at the receipt block', async () => {
		const fixture = await finalizedRecoveryEnvironment('cancellation')

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: false })).resolves.toBe(true)

		expect(fixture.state.pendingTransactions).toHaveLength(0)
		expect(fixture.state.workflows[0]?.status).toBe('failed')
		for (const requestedMethods of fixture.requestedMethods) expect(requestedMethods).toContain('eth_getCode')
		for (const requestedBlocks of fixture.requestedCodeBlocks) expect(requestedBlocks).toEqual([toHex(100n)])
	})

	test('resubmits when exact-attester ETH funding equals the signed maximum cost plus reserve', async () => {
		const fixture = await forkedRecoveryEnvironment({
			ethBalanceAttoEth: 200_105n,
			minimumEthReserveAttoEth: 100n,
			transactionValue: 5n,
		})

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).resolves.toBe(true)

		for (const methods of fixture.requestedMethods) expect(methods).toContain('eth_getBalance')
		for (const transactions of fixture.requestedTransactions) {
			const recoveryRequests = transactions.filter(candidate => {
				const transaction = rpcRequest(candidate.transaction)
				return 'data' in transaction && transaction.data === '0x1234'
			})
			expect(recoveryRequests).toHaveLength(2)
			for (const candidate of recoveryRequests) {
				expect(candidate.transaction).toMatchObject({
					gas: toHex(100_000n),
					maxFeePerGas: '0x2',
					maxPriorityFeePerGas: '0x1',
					value: '0x5',
				})
			}
		}
		expect(fixture.requestedMethods[0]).toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('submitted')
	})

	test.each([
		{ balance: 200_104n, label: 'one atto below the ETH reserve', reserve: 100n, value: 5n },
		{ balance: 199_999n, label: 'below the signed maximum gas cost', reserve: 0n, value: 0n },
	])('retains identical bytes when funding is $label', async ({ balance, reserve, value }) => {
		const fixture = await forkedRecoveryEnvironment({ ethBalanceAttoEth: balance, minimumEthReserveAttoEth: reserve, transactionValue: value })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('wallet ETH reserve')

		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('retains identical bytes when the canonical base fee exceeds the signed maximum fee', async () => {
		const fixture = await forkedRecoveryEnvironment({ baseFeePerGas: 3n })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('below the current canonical base fee')

		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
	})

	test('retains identical bytes when the current gas-cost cap is below the signed ceiling', async () => {
		const fixture = await forkedRecoveryEnvironment({ maximumGasCostAttoEth: 199_999n })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('signed gas ceiling exceeds')

		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
	})

	test('rechecks current gas policy after durable broadcast journaling', async () => {
		const fixture = await forkedRecoveryEnvironment()
		fixture.environment.beforeBroadcast = () => {
			fixture.environment.settings.strategy.maximumGasCostAttoEth = 199_999n
			return Promise.resolve()
		}

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('signed gas ceiling exceeds')

		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test.each([
		{ options: { maximumEthPerOperationAttoEth: 4n, transactionValue: 5n }, policy: 'strategy.maximumEthPerOperation' },
		{ options: { maximumRepPerOperationAttoRep: 39n, repBalances: { credit: 1_000n, wallet: 1_000n } }, policy: 'strategy.maximumRepPerOperation' },
		{ options: { maximumRepPerOperationAttoRep: 39n, vaultRepDebit: 40n }, policy: 'strategy.maximumRepPerOperation' },
	])('retains identical bytes when the current principal cap tightens below $policy', async ({ options, policy }) => {
		const fixture = await forkedRecoveryEnvironment(options)

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow(policy)

		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
	})

	test('does not substitute a funded nonattester for an unavailable canonical ETH-balance reader', async () => {
		const fixture = await forkedRecoveryEnvironment({ ethBalanceAttoEth: 10n ** 20n, secondEthBalanceAttoEthUnavailable: true })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toBeInstanceOf(ConnectivityDegradedError)

		expect(fixture.requestedMethods[0]?.filter(method => method === 'eth_getBalance')).toHaveLength(1)
		expect(fixture.requestedMethods[1]?.filter(method => method === 'eth_getBalance')).toHaveLength(1)
		expect(fixture.requestedMethods[2]).not.toContain('eth_getBalance')
		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
	})

	test('revalidates the combined REP reserve before identical-byte resubmission', async () => {
		const fixture = await forkedRecoveryEnvironment({ repBalances: { credit: 51n, wallet: 59n } })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('combined wallet and OpenOracle REP reserve')

		for (const methods of fixture.requestedMethods) {
			expect(methods.filter(method => method === 'eth_call')).toHaveLength(2)
			expect(methods).not.toContain('eth_estimateGas')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('revalidates SecurityPool vault REP backing before identical-byte resubmission', async () => {
		const fixture = await forkedRecoveryEnvironment({ vaultBackingAttoRep: 39n, vaultRepDebit: 40n })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('no longer has the declared SecurityPool vault REP backing')

		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('requires every canonical attester to replay the primary transaction before recovery broadcast', async () => {
		const fixture = await forkedRecoveryEnvironment({ unavailableThirdAttester: true })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toBeInstanceOf(ConnectivityDegradedError)

		for (const methods of fixture.requestedMethods) {
			expect(methods).toContain('eth_getBlockByNumber')
			expect(methods.filter(method => method === 'eth_call')).toHaveLength(1)
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('requires every canonical attester to replay downstream preflights before primary recovery simulation', async () => {
		const fixture = await forkedRecoveryEnvironment({ downstreamPreflight: true, unavailableThirdAttester: true })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toBeInstanceOf(ConnectivityDegradedError)

		for (const methods of fixture.requestedMethods) {
			expect(methods).toContain('eth_getBlockByNumber')
			expect(methods.filter(method => method === 'eth_call')).toHaveLength(1)
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	for (const gasEstimate of ['unavailable', 'malformed', 'zero', 'excessive'] as const) {
		test(`blocks canonical-attester recovery gas estimate outcome: ${gasEstimate}`, async () => {
			const fixture = await forkedRecoveryEnvironment({ thirdGasEstimate: gasEstimate })

			await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow()

			for (const methods of fixture.requestedMethods) {
				expect(methods.filter(method => method === 'eth_call')).toHaveLength(1)
				expect(methods.filter(method => method === 'eth_estimateGas')).toHaveLength(1)
				expect(methods).not.toContain('eth_sendRawTransaction')
			}
			expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
			expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
		})
	}

	test('retains recovery state when a newly caught-up reader changes the attester set after replay', async () => {
		const fixture = await forkedRecoveryEnvironment({ catchUpThirdDuringReplay: true })

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('attester set changed during replay checks')

		const newlyCaughtUp = fixture.requestedMethods[2]
		if (newlyCaughtUp === undefined) throw new Error('Expected a third recovery reader')
		expect(fixture.requestedMethods[0]?.filter(method => method === 'eth_call')).toHaveLength(1)
		expect(fixture.requestedMethods[1]?.filter(method => method === 'eth_call')).toHaveLength(1)
		expect(newlyCaughtUp).not.toContain('eth_call')
		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('does not broadcast identical bytes when quorum readers report different hashes at the recovery height', async () => {
		const fixture = await forkedRecoveryEnvironment()

		await expect(
			recoverPendingTransactions(fixture.environment, {
				beforeResubmit: async () => fixture.forkSecondReader(),
				resubmit: true,
			}),
		).rejects.toThrow('RPC disagreement for Dust tokens recovery block')

		for (const methods of fixture.requestedMethods) {
			expect(methods).toContain('eth_getBlockByNumber')
			expect(methods).not.toContain('eth_call')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('does not broadcast when the quorum block identity changes during recovery simulation', async () => {
		const fixture = await forkedRecoveryEnvironment()
		fixture.advanceBothDuringReplay()

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('canonical recovery anchor or its attester set changed during replay checks')

		for (const methods of fixture.requestedMethods) {
			expect(methods).toContain('eth_call')
			expect(methods).not.toContain('eth_sendRawTransaction')
			expect(methods.filter(method => method === 'eth_getBlockByNumber')).toHaveLength(3)
		}
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('closes the recovery window when the fresh anchor reaches the signed horizon', async () => {
		const fixture = await forkedRecoveryEnvironment()

		await expect(
			recoverPendingTransactions(fixture.environment, {
				beforeResubmit: async () => fixture.setHeads(100n),
				resubmit: true,
			}),
		).resolves.toBeTrue()

		for (const methods of fixture.requestedMethods) {
			expect(methods).toContain('eth_getBlockByNumber')
			expect(methods).not.toContain('eth_call')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.recoveryBlocker).toContain('resubmission window closed')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
	})

	test('rechecks the pending nonce after submission preflight before recovery simulation', async () => {
		const fixture = await forkedRecoveryEnvironment()

		await expect(
			recoverPendingTransactions(fixture.environment, {
				beforeResubmit: async () => fixture.setNonces(4n),
				resubmit: true,
			}),
		).rejects.toThrow('Signer nonce 3 was consumed without a quorum receipt')

		for (const methods of fixture.requestedMethods) {
			expect(methods).not.toContain('eth_call')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.recoveryBlocker).toContain('was consumed without a quorum receipt')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
	})

	test('enters manual reconciliation before consulting stale transaction visibility after a nonce mismatch', async () => {
		const fixture = await forkedRecoveryEnvironment()
		fixture.setNonces(4n)

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('Signer nonce 3 was consumed without a quorum receipt')

		for (const methods of fixture.requestedMethods) {
			expect(methods).not.toContain('eth_getTransactionByHash')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.recoveryBlocker).toContain('was consumed without a quorum receipt')
	})

	test('rechecks the pending nonce after recovery simulation before journaling a broadcast', async () => {
		const fixture = await forkedRecoveryEnvironment()
		fixture.consumeNonceDuringReplay()

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('Signer nonce 3 was consumed without a quorum receipt')

		for (const methods of fixture.requestedMethods) {
			expect(methods).toContain('eth_call')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.recoveryBlocker).toContain('was consumed without a quorum receipt')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
	})

	test('rechecks the signed horizon after the write-ahead broadcast journal persists', async () => {
		const fixture = await forkedRecoveryEnvironment()
		fixture.environment.beforeBroadcast = async () => fixture.setHeads(100n)

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('signed recovery submission window closed before broadcast')

		for (const methods of fixture.requestedMethods) {
			expect(methods).toContain('eth_call')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.recoveryBlocker).toContain('resubmission window closed')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('rechecks the pending nonce after the write-ahead broadcast journal persists', async () => {
		const fixture = await forkedRecoveryEnvironment()
		fixture.environment.beforeBroadcast = async () => fixture.setNonces(4n)

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('Signer nonce 3 was consumed without a quorum receipt')

		for (const methods of fixture.requestedMethods) {
			expect(methods).toContain('eth_call')
			expect(methods).not.toContain('eth_sendRawTransaction')
		}
		expect(fixture.environment.state.pendingTransactions[0]?.recoveryBlocker).toContain('was consumed without a quorum receipt')
		expect(fixture.environment.state.pendingTransactions[0]?.status).toBe('signed')
		expect(fixture.environment.state.workflows[0]?.status).toBe('waiting-transaction')
	})

	test('preserves an earlier uncertain broadcast journal when a later recovery replay is deferred', async () => {
		const fixture = await forkedRecoveryEnvironment()
		const intent = fixture.environment.state.pendingTransactions[0]
		const workflow = fixture.environment.state.workflows[0]
		const step = workflow?.steps[0]
		if (intent === undefined || workflow === undefined || step === undefined) throw new Error('Recovery fixture is incomplete')
		intent.status = 'confirmation-unknown'
		intent.submissionBlock = 90n
		intent.submittedAt = '2026-08-24T00:00:00.000Z'
		step.status = 'submitted'
		fixture.environment.beforeBroadcast = async () => fixture.setHeads(100n)

		await expect(recoverPendingTransactions(fixture.environment, { resubmit: true })).rejects.toThrow('signed recovery submission window closed before broadcast')

		expect(intent.status).toBe('confirmation-unknown')
		expect(intent.submissionBlock).toBe(90n)
		expect(intent.submittedAt).toBe('2026-08-24T00:00:00.000Z')
		expect(step.status).toBe('submitted')
		for (const methods of fixture.requestedMethods) expect(methods).not.toContain('eth_sendRawTransaction')
	})

	test('never replaces an ambiguous consumed nonce automatically', () => {
		expect(pendingIntentRecoveryAction({ maxBlockNumber: 100n, mode: 'public', nonce: 7n }, 8n, [110n, 111n])).toBe('manual-reconciliation')
	})

	test('never queues a future transaction across a backward nonce gap', () => {
		expect(pendingIntentRecoveryAction({ maxBlockNumber: 100n, mode: 'public', nonce: 7n }, 6n, [90n, 91n])).toBe('manual-reconciliation')
	})

	test('retains private intents after the automatic submission window closes', () => {
		const intent = { maxBlockNumber: 100n, mode: 'private' as const, nonce: 7n }
		expect(pendingIntentRecoveryAction(intent, 7n, [99n, 100n], 12n)).toBe('resubmit-identical')
		expect(pendingIntentRecoveryAction(intent, 7n, [100n, 101n], 12n)).toBe('submission-window-closed')
		expect(pendingIntentRecoveryAction(intent, 7n, [101n, 102n], 12n)).toBe('submission-window-closed')
	})

	test('resubmits only the identical signed bytes while the window remains usable', () => {
		expect(pendingIntentRecoveryAction({ maxBlockNumber: 100n, mode: 'private', nonce: 7n }, 7n, [99n, 100n])).toBe('resubmit-identical')
		expect(pendingIntentRecoveryAction({ maxBlockNumber: 100n, mode: 'public', nonce: 7n }, 7n, [99n, 100n])).toBe('resubmit-identical')
	})

	test('closes public resubmission using the configured-quorum shared head', () => {
		expect(pendingIntentRecoveryAction({ maxBlockNumber: 100n, mode: 'public', nonce: 7n }, 7n, [101n, 102n, 12n], 12n, false, 2)).toBe('submission-window-closed')
	})

	test('continues monitoring an exact visible transaction after its submission window', () => {
		expect(pendingIntentRecoveryAction({ maxBlockNumber: 100n, mode: 'public', nonce: 7n }, 7n, [101n, 102n], 12n, true, 2)).toBe('wait-known-pending')
	})

	test('requires manual reconciliation when nonce state contradicts cached exact-hash visibility', () => {
		const intent = { maxBlockNumber: 100n, mode: 'public' as const, nonce: 7n }
		expect(pendingIntentRecoveryAction(intent, 8n, [101n, 102n], 12n, true, 2)).toBe('manual-reconciliation')
		expect(pendingIntentRecoveryAction(intent, 6n, [101n, 102n], 12n, true, 2)).toBe('manual-reconciliation')
	})

	test('never changes a pending transaction between private and public submission', () => {
		expect(() => assertRecoverySubmissionMode('private', 'public')).toThrow('requires submission.mode to remain private')
		expect(() => assertRecoverySubmissionMode('public', 'private')).toThrow('requires submission.mode to remain public')
		expect(() => assertRecoverySubmissionMode('private', 'private')).not.toThrow()
	})

	test('accepts only an exact empty self-transfer as a nonce cancellation', () => {
		const sender = '0x0000000000000000000000000000000000000001'
		const cancellation = {
			from: sender,
			input: '0x',
			nonce: 7n,
			to: sender,
			type: 'eip1559',
			value: 0n,
		}
		expect(
			transactionIsStrictNonceCancellation(cancellation, {
				nonce: 7n,
				sender,
			}),
		).toBeTrue()
		expect(transactionIsStrictNonceCancellation({ ...cancellation, input: '0x00' }, { nonce: 7n, sender })).toBeFalse()
		expect(transactionIsStrictNonceCancellation({ ...cancellation, to: '0x0000000000000000000000000000000000000002' }, { nonce: 7n, sender })).toBeFalse()
		expect(transactionIsStrictNonceCancellation({ ...cancellation, type: 'eip7702' }, { nonce: 7n, sender })).toBeFalse()
	})
})
