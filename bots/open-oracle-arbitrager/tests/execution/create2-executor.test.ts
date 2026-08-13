import { expect, test } from 'bun:test'
import { assertExecutorDeploymentEnvironment, assertExecutorDeploymentIntent, assertExecutorDeploymentReceipt, deployExecutorCreate2, deterministicDeploymentProxy, deterministicDeploymentProxyCode, executorCodeStatus, executorDeploymentPlan, submitExecutorDeploymentTransaction } from '#execution/create2-executor'
import { executorArtifact } from '#contracts/artifacts.generated'
import { keccak256, mainnet, privateKeyToAccount } from '#ethereum'
import type { Hex } from '#ethereum'
import { deployExecutorFromConnectivity, requireActivePersistedNetwork, requirePausedExecutorDeployment } from '../../src/runtime/operator-control-plane.ts'
import { clearExecutorDeploymentIntent, loadExecutorDeploymentIntent, saveExecutorDeploymentIntent, type ExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('rejects executor deployment while a different network is saved for restart', () => {
	expect(() => requireActivePersistedNetwork('mainnet', 'sepolia')).toThrow('Restart to apply the saved network')
	expect(() => requireActivePersistedNetwork('mainnet', 'mainnet')).not.toThrow()
})

test('rechecks execution pause immediately before executor deployment', () => {
	expect(() => requirePausedExecutorDeployment(true, false)).toThrow('Pause execution before deploying')
	expect(() => requirePausedExecutorDeployment(true, true)).not.toThrow()
})

test('derives a stable executor address and canonical proxy calldata from a bytes32 salt', () => {
	const salt = `0x${'00'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	expect(deterministicDeploymentProxy).toBe('0x4e59b44847b379578588920cA78FbF26c0B4956C')
	expect(plan.address).toBe('0xe04E3658Eb81792D5fc059ffF23d996b7940E1aA')
	expect(plan.salt).toBe(salt)
	expect(plan.calldata).toBe(`${salt}${plan.bytecode.slice(2)}` as Hex)
})

test('rejects salts that cannot make CREATE2 deployment deterministic', () => {
	expect(() => executorDeploymentPlan('hello')).toThrow('32-byte')
	expect(() => executorDeploymentPlan(`0x${'00'.repeat(31)}`)).toThrow('32-byte')
})

test('fails closed on a wrong chain or unexpected canonical proxy runtime', () => {
	expect(() => assertExecutorDeploymentEnvironment(1, 11_155_111, deterministicDeploymentProxyCode)).toThrow('RPC chain mismatch')
	expect(() => assertExecutorDeploymentEnvironment(11_155_111, 11_155_111, '0x12')).toThrow('proxy is missing or has unexpected bytecode')
	expect(() => assertExecutorDeploymentEnvironment(11_155_111, 11_155_111, deterministicDeploymentProxyCode)).not.toThrow()
})

test('distinguishes an empty address from matching and conflicting executor runtime', () => {
	const runtime = '0x1234'
	const expectedHash = keccak256(runtime)
	expect(executorCodeStatus(undefined, expectedHash)).toBe('missing')
	expect(executorCodeStatus('0x', expectedHash)).toBe('missing')
	expect(executorCodeStatus(runtime, expectedHash)).toBe('verified')
	expect(() => executorCodeStatus('0xabcd', expectedHash)).toThrow('unexpected runtime bytecode')
})

test('rejects a reverted CREATE2 receipt', () => {
	const hash = `0x${'11'.repeat(32)}` as Hex
	expect(() => assertExecutorDeploymentReceipt('reverted', hash)).toThrow(`reverted: ${hash}`)
	expect(() => assertExecutorDeploymentReceipt('success', hash)).not.toThrow()
})

test('broadcasts one signed executor deployment through every public RPC and tolerates one failure', async () => {
	const transactionHash = `0x${'22'.repeat(32)}` as Hex
	const serializedTransaction = '0x1234' as Hex
	const submissions: { transaction: Hex; url: string }[] = []
	const result = await submitExecutorDeploymentTransaction({
		account: `0x${'11'.repeat(20)}`,
		publicRpcUrls: ['https://primary.example', 'https://secondary.example'],
		publicSubmit: async (url, transaction) => {
			submissions.push({ transaction, url })
			if (url.includes('primary')) throw new Error('primary unavailable')
			return transactionHash
		},
		serializedTransaction,
		transactionHash,
	})

	expect(submissions).toEqual([
		{ transaction: serializedTransaction, url: 'https://primary.example' },
		{ transaction: serializedTransaction, url: 'https://secondary.example' },
	])
	expect(result.hash).toBe(transactionHash)
	expect(result.acceptedTargets).toEqual(['https://secondary.example'])
	expect(result.failedTargets).toHaveLength(1)
})

test('durably round trips and clears the exact signed executor deployment intent', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-intent-'))
	try {
		const privateKey = `0x${'11'.repeat(32)}` as Hex
		const account = privateKeyToAccount(privateKey)
		const salt = `0x${'22'.repeat(32)}` as Hex
		const plan = executorDeploymentPlan(salt)
		const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const intent = {
			account: account.address,
			address: plan.address,
			chainId: 1,
			salt,
			serializedTransaction,
			transactionHash: keccak256(serializedTransaction),
			version: 1,
		} satisfies ExecutorDeploymentIntent
		const path = join(directory, 'deployment.json')
		await saveExecutorDeploymentIntent(path, intent)
		await expect(loadExecutorDeploymentIntent(path)).resolves.toEqual(intent)
		await clearExecutorDeploymentIntent(path)
		await expect(loadExecutorDeploymentIntent(path)).resolves.toBeUndefined()
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})

test('rejects a mismatched pending intent before externally deployed runtime recovery', async () => {
	const privateKey = `0x${'11'.repeat(32)}` as Hex
	const account = privateKeyToAccount(privateKey)
	const salt = `0x${'22'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
	const intent = {
		account: account.address,
		address: plan.address,
		chainId: 1,
		salt,
		serializedTransaction,
		transactionHash: keccak256(serializedTransaction),
		version: 1,
	} satisfies ExecutorDeploymentIntent
	await expect(assertExecutorDeploymentIntent({ ...intent, salt: `0x${'33'.repeat(32)}` }, account.address, 1, plan)).rejects.toThrow('does not match')
	const altered = await account.signTransaction({ chainId: 1, data: '0x1234', gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
	await expect(assertExecutorDeploymentIntent({ ...intent, serializedTransaction: altered, transactionHash: keccak256(altered) }, account.address, 1, plan)).rejects.toThrow('expected CREATE2 call')
})

test('clearing an absent deployment intent is idempotent when its directory is absent', async () => {
	const directory = join(tmpdir(), `zoltar-missing-executor-intent-${crypto.randomUUID()}`)
	await expect(clearExecutorDeploymentIntent(join(directory, 'deployment.json'))).resolves.toBeUndefined()
})

test('requires three distinct read RPC origins inside the deployment primitive', async () => {
	const common = {
		chain: mainnet,
		persistIntent: async () => undefined,
		privateKey: `0x${'11'.repeat(32)}` as Hex,
		rpcUrls: ['https://submit.example'],
		salt: `0x${'22'.repeat(32)}`,
	}
	await expect(deployExecutorCreate2({ ...common, readRpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'] })).rejects.toThrow('three independent read RPC origins')
	await expect(deployExecutorCreate2({ ...common, readRpcUrls: ['https://rpc-a.example/one', 'https://rpc-a.example/two', 'https://rpc-b.example'] })).rejects.toThrow('three independent read RPC origins')
})

test('passes every effective public RPC from the dashboard deployment path', async () => {
	const primaryRpcUrl = 'https://primary.example/'
	const publicRpcUrls = [primaryRpcUrl, 'https://secondary.example/']
	let receivedRpcUrls: readonly string[] = []
	await deployExecutorFromConnectivity(
		{
			chain: mainnet,
			connectivity: { publicRpcUrls, readRpcUrl: primaryRpcUrl },
			privateKey: `0x${'11'.repeat(32)}`,
			quorumRpcUrls: ['https://quorum-a.example/', 'https://quorum-b.example/'],
			salt: `0x${'22'.repeat(32)}`,
		},
		async parameters => {
			receivedRpcUrls = parameters.rpcUrls
			return { address: `0x${'33'.repeat(20)}`, alreadyDeployed: false, transactionHash: `0x${'44'.repeat(32)}` }
		},
	)

	expect(receivedRpcUrls).toEqual(publicRpcUrls)
})

async function runDeploymentScenario(options: { alreadyDeployed?: boolean; existingIntent?: boolean; primaryPreparationFails: boolean; primaryReceiptFails: boolean }) {
	const privateKey = `0x${'11'.repeat(32)}` as Hex
	const account = privateKeyToAccount(privateKey)
	const salt = `0x${'22'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	const runtimeCode = `0x${executorArtifact.evm.deployedBytecode.object}` as Hex
	const broadcastRequests: { transaction: Hex; url: string }[] = []
	const lifecycleEvents: string[] = []
	let deployed = options.alreadyDeployed === true
	let transactionHash = `0x${'00'.repeat(32)}` as Hex

	const rpcResponse = (result: unknown) => Response.json({ id: 1, jsonrpc: '2.0', result })
	const block = (number: bigint) => ({
		baseFeePerGas: '0x1',
		difficulty: '0x0',
		extraData: '0x',
		gasLimit: '0x1c9c380',
		gasUsed: '0x5208',
		hash: number === 100n ? `0x${'aa'.repeat(32)}` : `0x${'bb'.repeat(32)}`,
		logsBloom: `0x${'00'.repeat(256)}`,
		miner: `0x${'00'.repeat(20)}`,
		mixHash: `0x${'00'.repeat(32)}`,
		nonce: '0x0000000000000000',
		number: `0x${number.toString(16)}`,
		parentHash: `0x${'cc'.repeat(32)}`,
		receiptsRoot: `0x${'dd'.repeat(32)}`,
		sha3Uncles: `0x${'ee'.repeat(32)}`,
		size: '0x1',
		stateRoot: `0x${'ff'.repeat(32)}`,
		timestamp: '0x1',
		totalDifficulty: '0x0',
		transactions: [],
		transactionsRoot: `0x${'12'.repeat(32)}`,
		uncles: [],
	})
	const handler = (name: 'primary' | 'secondary' | 'tertiary') => async (request: Request) => {
		const body: unknown = await request.json()
		if (typeof body !== 'object' || body === null || Array.isArray(body) || !('method' in body) || typeof body.method !== 'string' || !('params' in body) || !Array.isArray(body.params)) {
			return new Response('invalid request', { status: 400 })
		}
		if (body.method === 'eth_chainId') return rpcResponse('0x1')
		if (body.method === 'eth_blockNumber') return rpcResponse('0x70')
		if (body.method === 'eth_getBlockByNumber') return rpcResponse(block(BigInt(String(body.params[0]))))
		if (body.method === 'eth_getTransactionCount') return rpcResponse('0x0')
		if (body.method === 'eth_estimateGas') return rpcResponse('0x300000')
		if (body.method === 'eth_gasPrice') return name === 'primary' && options.primaryPreparationFails ? new Response('primary preparation unavailable', { status: 503 }) : rpcResponse('0x3b9aca00')
		if (body.method === 'eth_getCode') {
			const address = body.params[0]
			if (typeof address !== 'string') return new Response('invalid address', { status: 400 })
			if (address.toLowerCase() === deterministicDeploymentProxy.toLowerCase()) return rpcResponse(deterministicDeploymentProxyCode)
			if (address.toLowerCase() === plan.address.toLowerCase()) return rpcResponse(deployed ? runtimeCode : '0x')
			return rpcResponse('0x')
		}
		if (body.method === 'eth_sendRawTransaction') {
			lifecycleEvents.push(`broadcast:${name}`)
			const transaction = body.params[0]
			if (typeof transaction !== 'string' || !transaction.startsWith('0x')) return new Response('invalid transaction', { status: 400 })
			const normalizedTransaction: Hex = `0x${transaction.slice(2)}`
			broadcastRequests.push({ transaction: normalizedTransaction, url: name })
			if (name === 'primary') return new Response('primary broadcast unavailable', { status: 503 })
			transactionHash = keccak256(normalizedTransaction)
			deployed = true
			return rpcResponse(transactionHash)
		}
		if (body.method === 'eth_getTransactionReceipt') {
			if (name === 'primary' && options.primaryReceiptFails) return new Response('primary receipt unavailable', { status: 503 })
			return rpcResponse({
				blockHash: `0x${'aa'.repeat(32)}`,
				blockNumber: '0x64',
				contractAddress: null,
				cumulativeGasUsed: '0x5208',
				effectiveGasPrice: '0x1',
				from: account.address,
				gasUsed: '0x5208',
				logs: [],
				logsBloom: `0x${'00'.repeat(256)}`,
				status: '0x1',
				to: deterministicDeploymentProxy,
				transactionHash,
				transactionIndex: '0x0',
				type: '0x2',
			})
		}
		return new Response(`unexpected method ${body.method}`, { status: 500 })
	}

	const primary = Bun.serve({ fetch: handler('primary'), port: 0 })
	const secondary = Bun.serve({ fetch: handler('secondary'), port: 0 })
	const tertiary = Bun.serve({ fetch: handler('tertiary'), port: 0 })
	try {
		const primaryPort = primary.port
		const secondaryPort = secondary.port
		const tertiaryPort = tertiary.port
		if (primaryPort === undefined || secondaryPort === undefined || tertiaryPort === undefined) throw new Error('Mock RPC server did not expose a port')
		const primaryUrl = `http://127.0.0.1:${primaryPort.toString()}`
		const secondaryUrl = `http://127.0.0.1:${secondaryPort.toString()}`
		const tertiaryUrl = `http://127.0.0.1:${tertiaryPort.toString()}`
		let persistedIntent
		const recoveredSerializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const existingIntent = options.existingIntent
			? ({
					account: account.address,
					address: plan.address,
					chainId: 1,
					salt,
					serializedTransaction: recoveredSerializedTransaction,
					transactionHash: keccak256(recoveredSerializedTransaction),
					version: 1,
				}) satisfies ExecutorDeploymentIntent
			: undefined
		const result = await deployExecutorCreate2({
			chain: mainnet,
			existingIntent,
			persistIntent: async intent => {
				persistedIntent = intent
				lifecycleEvents.push('persist')
			},
			privateKey,
			readRpcUrls: [primaryUrl, secondaryUrl, tertiaryUrl],
			rpcUrls: [primaryUrl, secondaryUrl],
			salt,
		})
		if (existingIntent === undefined) expect(persistedIntent).toBeDefined()
		return { broadcastRequests, expected: { address: plan.address, alreadyDeployed: false, transactionHash }, lifecycleEvents, result }
	} finally {
		primary.stop(true)
		secondary.stop(true)
		tertiary.stop(true)
	}
}

test('persists before broadcasting and tolerates one unavailable preparation reader', async () => {
	const { broadcastRequests, expected, lifecycleEvents, result } = await runDeploymentScenario({ primaryPreparationFails: true, primaryReceiptFails: false })
	expect(result).toEqual(expected)
	expect(lifecycleEvents[0]).toBe('persist')
	expect(broadcastRequests.map(request => request.url)).toEqual(['primary', 'secondary'])
	expect(broadcastRequests[0]?.transaction).toBe(broadcastRequests[1]?.transaction)
})

test('confirms through the secondary when the primary fails receipt polling after broadcast', async () => {
	const { broadcastRequests, expected, result } = await runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: true })
	expect(result).toEqual(expected)
	expect(broadcastRequests).toHaveLength(2)
	expect(broadcastRequests[0]?.transaction).toBe(broadcastRequests[1]?.transaction)
})

test('recovers a matching executor deployed by another account after this intent was persisted', async () => {
	const { broadcastRequests, result } = await runDeploymentScenario({ alreadyDeployed: true, existingIntent: true, primaryPreparationFails: false, primaryReceiptFails: false })
	expect(result.alreadyDeployed).toBe(true)
	expect(result.transactionHash).toBeDefined()
	expect(broadcastRequests).toEqual([])
})
