import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialRuntimeState, saveDurableState } from '../../src/state/operator-state.ts'
import { keccak256, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { acquireFileProcessLock } from '@zoltar/bot-shared/execution/process-lock'

const directories: string[] = []
const servers: Bun.Server<unknown>[] = []
const children: Bun.Subprocess[] = []

async function waitForJson(origin: string, path: string, child?: Bun.Subprocess) {
	for (let attempt = 0; attempt < 2_000; attempt++) {
		if (child !== undefined && child.exitCode !== null) {
			const stderr = child.stderr
			const detail = stderr instanceof ReadableStream ? await new Response(stderr).text() : ''
			throw new Error(`Liquidator exited while waiting for ${path}: ${detail}`)
		}
		try {
			const response = await fetch(`${origin}${path}`)
			if (response.ok) return (await response.json()) as Record<string, unknown>
		} catch (error) {
			void error
		}
		await Bun.sleep(20)
	}
	throw new Error('Dashboard did not become ready')
}

async function waitForRpcMethod(methods: string[], method: string) {
	for (let attempt = 0; attempt < 700; attempt++) {
		if (methods.includes(method)) return
		await Bun.sleep(20)
	}
	throw new Error(`Liquidator did not call ${method}`)
}

afterEach(async () => {
	for (const child of children.splice(0)) {
		child.kill()
		await child.exited
	}
	for (const server of servers.splice(0)) server.stop(true)
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function temporaryDirectory(prefix: string) {
	const directory = await mkdtemp(join(tmpdir(), prefix))
	directories.push(directory)
	return directory
}

/** A loopback JSON-RPC endpoint that answers every request with `result(method)`. */
function jsonRpcServer(result: (method: string) => unknown) {
	const server = Bun.serve({
		async fetch(request) {
			const body = (await request.json()) as { id: unknown; method: string }
			return Response.json({ id: body.id, jsonrpc: '2.0', result: result(body.method) })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('Test RPC did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

async function reserveUiPort() {
	const reservation = Bun.serve({ fetch: () => new Response('reserved'), hostname: '127.0.0.1', port: 0 })
	const uiPort = reservation.port
	await reservation.stop(true)
	if (uiPort === undefined) throw new Error('Test dashboard reservation did not expose a port')
	return uiPort
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectField(value: Record<string, unknown>, key: string) {
	const field = value[key]
	if (!isRecord(field)) throw new Error(`Example configuration ${key} is missing`)
	return field
}

async function exampleConfiguration() {
	const configuration = (await Bun.file(join(import.meta.dir, '..', '..', 'config', 'operator.example.json')).json()) as Record<string, unknown>
	return { configuration, runtime: objectField(configuration, 'runtime') }
}

const sepoliaNetwork = { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' }

function startLiquidator(configurationPath: string) {
	const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'run.ts')], {
		cwd: join(import.meta.dir, '..', '..'),
		env: { ...process.env, ZOLTAR_LIQUIDATOR_CONFIG: configurationPath },
		stderr: 'pipe',
		stdout: 'pipe',
	})
	children.push(child)
	return child
}

async function startLiquidatorWith(directory: string, configuration: Record<string, unknown>) {
	const configurationPath = join(directory, 'operator.json')
	await writeFile(configurationPath, JSON.stringify(configuration), 'utf8')
	return { child: startLiquidator(configurationPath), configurationPath }
}

/** Waits for a liquidator that must refuse to start and returns its exit code and combined output. */
async function startupFailure(child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>, description: string) {
	const exitCode = await Promise.race([child.exited, Bun.sleep(3_000).then(() => undefined)])
	if (exitCode === undefined) throw new Error(`Liquidator did not exit after ${description} failed`)
	return { exitCode, output: `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}` }
}

function putJson(origin: string, endpoint: string, body: unknown) {
	return fetch(`${origin}${endpoint}`, { body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin }, method: 'PUT' })
}

test('keeps the dashboard available until initial chain and RPC settings are saved', async () => {
	const directory = await temporaryDirectory('zoltar-liquidator-bootstrap-')
	const rpcUrl = `${jsonRpcServer(() => '0xaa36a7')}/`
	const uiPort = await reserveUiPort()
	const { configuration, runtime } = await exampleConfiguration()
	Object.assign(runtime, { pollMilliseconds: 1_000, stateFile: join(directory, 'state.json'), uiPort })
	const { child } = await startLiquidatorWith(directory, configuration)
	const origin = `http://127.0.0.1:${uiPort.toString()}`
	const initial = await waitForJson(origin, '/api/configuration')
	expect(initial).toMatchObject({ network: { name: 'mainnet' }, networkConfigured: false })
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(true)
	for (const [endpoint, body] of [
		['/api/signer', { privateKey: '', rememberSigner: false }],
		['/api/strategy', {}],
		['/api/market-configuration', {}],
		['/api/paused', { paused: false }],
	] as const) {
		const blocked = await putJson(origin, endpoint, body)
		expect(blocked.status, `${endpoint}: ${await blocked.clone().text()}`).toBe(400)
	}
	if (child.exitCode !== null) throw new Error(`Liquidator exited before profile switch: ${await new Response(child.stderr).text()}`)
	const profileResult = await putJson(origin, '/api/network-profile', { network: 'sepolia' })
	expect(profileResult.status, await profileResult.clone().text()).toBe(200)
	for (let attempt = 0; attempt < 700; attempt++) {
		if (child.exitCode !== null) throw new Error(`Liquidator exited during profile switch: ${await new Response(child.stderr).text()}`)
		const selected = await waitForJson(origin, '/api/configuration')
		if (Reflect.get(Reflect.get(selected, 'network') as object, 'name') === 'sepolia') break
		await Bun.sleep(25)
	}
	expect(await waitForJson(origin, '/api/configuration')).toMatchObject({ network: { name: 'sepolia' }, networkConfigured: false })
	expect(child.exitCode).toBeNull()
	const response = await putJson(origin, '/api/network-connectivity', { connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }, network: 'sepolia' })
	expect(response.status, await response.clone().text()).toBe(200)
	expect(await response.json()).toMatchObject({ network: { chainId: 11_155_111, name: 'sepolia' } })
	const signerAfterConnectivity = await putJson(origin, '/api/signer', { privateKey: '', rememberSigner: false })
	expect(signerAfterConnectivity.status, await signerAfterConnectivity.clone().text()).toBe(200)
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(true)
	const backToMainnet = await putJson(origin, '/api/network-profile', { network: 'mainnet' })
	expect(backToMainnet.status, await backToMainnet.clone().text()).toBe(200)
	let restoredMainnet: Record<string, unknown> | undefined
	for (let attempt = 0; attempt < 700; attempt++) {
		restoredMainnet = await waitForJson(origin, '/api/configuration')
		const network = Reflect.get(restoredMainnet, 'network')
		if (typeof network === 'object' && network !== null && Reflect.get(network, 'name') === 'mainnet') break
		await Bun.sleep(25)
	}
	expect(restoredMainnet).toMatchObject({ network: { name: 'mainnet' }, networkConfigured: false, runtime: { stateFile: join(directory, 'state.json') } })
	expect(child.exitCode).toBeNull()
})

test('keeps the active operator running and unpaused when a dormant profile is incompatible', async () => {
	const directory = await temporaryDirectory('zoltar-liquidator-rejected-profile-')
	const rpcUrl = `${jsonRpcServer(
		method =>
			new Map([
				['eth_chainId', '0x1'],
				['eth_getCode', '0x'],
			]).get(method) ?? '0x0',
	)}/`
	const uiPort = await reserveUiPort()
	const { configuration, runtime } = await exampleConfiguration()
	Object.assign(configuration, {
		connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl, rpcQuorum: 1 },
		network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' },
		networkConfigured: true,
		paused: false,
	})
	Reflect.set(objectField(configuration, 'centralizedMarkets'), 'assetChainId', 1)
	Object.assign(runtime, { pollMilliseconds: 1_000, stateFile: join(directory, 'mainnet-state.json'), uiPort })
	const { child, configurationPath } = await startLiquidatorWith(directory, configuration)
	const origin = `http://127.0.0.1:${uiPort.toString()}`
	await Bun.sleep(200)
	if (child.exitCode !== null) throw new Error(`Liquidator exited before rejected-profile test: ${await new Response(child.stderr).text()}`)
	await waitForJson(origin, '/api/configuration', child)
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)

	const incompatibleProfile = JSON.parse(JSON.stringify(configuration)) as Record<string, unknown>
	const incompatibleRuntime = objectField(incompatibleProfile, 'runtime')
	const incompatibleMarket = objectField(incompatibleProfile, 'centralizedMarkets')
	Reflect.set(incompatibleProfile, 'network', sepoliaNetwork)
	Reflect.set(incompatibleProfile, 'networkConfigured', false)
	Reflect.deleteProperty(incompatibleProfile, 'connectivity')
	Reflect.set(incompatibleProfile, 'paused', true)
	Reflect.set(incompatibleMarket, 'assetChainId', 11_155_111)
	Reflect.set(incompatibleRuntime, 'stateFile', join(directory, 'sepolia-state.json'))
	Reflect.set(incompatibleRuntime, 'uiPort', uiPort + 1)
	await writeFile(`${configurationPath}.sepolia.profile`, JSON.stringify(incompatibleProfile), 'utf8')

	const rejected = await putJson(origin, '/api/network-profile', { network: 'sepolia' })
	expect(rejected.status, await rejected.clone().text()).toBe(400)
	await Bun.sleep(50)
	expect(child.exitCode).toBeNull()
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
	const signer = await putJson(origin, '/api/signer', { privateKey: '', rememberSigner: false })
	expect(signer.status, await signer.clone().text()).toBe(200)

	Reflect.set(incompatibleRuntime, 'uiPort', uiPort)
	Reflect.set(incompatibleProfile, 'connectivity', { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl, rpcQuorum: 1 })
	await writeFile(`${configurationPath}.sepolia.profile`, JSON.stringify(incompatibleProfile), 'utf8')
	const activeBeforeLockedSwitch = await Bun.file(configurationPath).text()
	/** Requests the incompatible dormant profile and proves the active operator and its configuration are untouched. */
	const expectRejectedSwitch = async () => {
		const switched = await putJson(origin, '/api/network-profile', { network: 'sepolia' })
		expect(switched.status, await switched.clone().text()).toBe(400)
		expect(await Bun.file(configurationPath).text()).toBe(activeBeforeLockedSwitch)
		expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
		expect(child.exitCode).toBeNull()
	}
	const targetStateLock = await acquireFileProcessLock(join(directory, 'sepolia-state.json'), 'Liquidator state')
	try {
		await expectRejectedSwitch()
	} finally {
		await targetStateLock.release()
	}

	Reflect.set(incompatibleProfile, 'networkConfigured', true)
	await writeFile(`${configurationPath}.sepolia.profile`, JSON.stringify(incompatibleProfile), 'utf8')
	await expectRejectedSwitch()

	const targetPrivateKey = `0x${'22'.repeat(32)}` as const
	const targetAccount = privateKeyToAccount(targetPrivateKey)
	const wrongBoundState = initialRuntimeState(true, targetAccount.address, 1)
	await saveDurableState(join(directory, 'sepolia-state.json'), wrongBoundState)
	Reflect.set(incompatibleProfile, 'networkConfigured', false)
	await writeFile(`${configurationPath}.sepolia.profile`, JSON.stringify(incompatibleProfile), 'utf8')
	await expectRejectedSwitch()

	const wrongChainTransaction = await targetAccount.signTransaction({ chainId: 1, gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 0n, to: '0x0000000000000000000000000000000000000020', value: 0n })
	const targetState = initialRuntimeState(true, targetAccount.address, 11_155_111)
	targetState.pendingTransactions.push({
		hash: keccak256(wrongChainTransaction),
		kind: 'fees',
		label: 'Wrong-chain dormant recovery',
		maxBlockNumber: 120n,
		mode: 'public',
		nonce: 0n,
		receiptExpectation: { type: 'transaction' },
		requiresMarketEvidence: false,
		sender: targetAccount.address,
		serializedTransaction: wrongChainTransaction,
		submissionBlock: 100n,
	})
	await saveDurableState(join(directory, 'sepolia-state.json'), targetState)
	Reflect.set(incompatibleProfile, 'networkConfigured', false)
	Reflect.set(incompatibleProfile, 'privateKey', targetPrivateKey)
	Reflect.set(incompatibleRuntime, 'execute', true)
	const wrongIntentProfile = JSON.stringify(incompatibleProfile)
	await writeFile(`${configurationPath}.sepolia.profile`, wrongIntentProfile, 'utf8')
	await expectRejectedSwitch()
	expect(await Bun.file(`${configurationPath}.sepolia.profile`).text()).toBe(wrongIntentProfile)
})

test('stops the dashboard and exits when startup network validation fails', async () => {
	const directory = await temporaryDirectory('zoltar-liquidator-startup-')
	const rpcUrl = jsonRpcServer(() => '0x1')
	const { configuration, runtime } = await exampleConfiguration()
	Object.assign(configuration, { connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }, network: sepoliaNetwork })
	Object.assign(runtime, { stateFile: join(directory, 'state.json'), ui: true, uiPort: await reserveUiPort() })
	const { child } = await startLiquidatorWith(directory, configuration)
	const { exitCode, output } = await startupFailure(child, 'startup validation')
	expect(exitCode).toBe(1)
	expect(output).toContain('does not match configured chain')
})

test('rejects a wrong-chain private relay during startup validation', async () => {
	const directory = await temporaryDirectory('zoltar-liquidator-relay-startup-')
	const rpcUrl = jsonRpcServer(() => '0xaa36a7')
	const relayUrl = jsonRpcServer(() => '0x1')
	const { configuration, runtime } = await exampleConfiguration()
	Object.assign(configuration, {
		connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl },
		network: sepoliaNetwork,
		submission: { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: [relayUrl] },
	})
	Object.assign(runtime, { stateFile: join(directory, 'state.json'), ui: true, uiPort: await reserveUiPort() })
	const { child } = await startLiquidatorWith(directory, configuration)
	const { exitCode, output } = await startupFailure(child, 'relay validation')
	expect(exitCode).toBe(1)
	expect(output).toContain('Expected chain 11155111, received 1')
})

test('pins deployment bytecode to the observed block without scanning an undeployed system', async () => {
	const directory = await temporaryDirectory('zoltar-liquidator-undeployed-')
	const methods: string[] = []
	const rpcUrl = jsonRpcServer(method => {
		methods.push(method)
		if (method === 'eth_getBlockByNumber') return { hash: `0x${'11'.repeat(32)}`, number: '0x64', timestamp: '0x7b', transactions: [] }
		return method === 'eth_chainId' ? '0xaa36a7' : '0x'
	})
	const { configuration, runtime } = await exampleConfiguration()
	Object.assign(configuration, { connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }, network: sepoliaNetwork })
	Object.assign(runtime, { pollMilliseconds: 1_000, stateFile: join(directory, 'state.json'), ui: false })
	const { child } = await startLiquidatorWith(directory, configuration)

	await waitForRpcMethod(methods, 'eth_getCode')
	expect(methods).toContain('eth_getBlockByNumber')
	const deploymentCheckIndex = methods.indexOf('eth_getCode')
	await Bun.sleep(100)
	expect(methods.slice(deploymentCheckIndex)).toEqual(['eth_getCode'])
	child.kill()
	await child.exited
	const output = await new Response(child.stdout).text()
	const summaries = output.split('\n').filter(line => line.includes('ProcessedMs='))
	expect(summaries).toHaveLength(1)
	expect(summaries[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Sepolia unknown: ProcessedMs=\d+/)
	expect(summaries[0]).toContain('status=waiting')
})
