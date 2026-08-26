import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialRuntimeState, saveDurableState } from '../../src/state/operator-state.ts'
import { keccak256, privateKeyToAccount } from '../helpers/ethereum.ts'
import { acquireFileProcessLock } from '../helpers/process-lock.ts'

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

test('keeps the dashboard available until initial chain and RPC settings are saved', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-bootstrap-'))
	directories.push(directory)
	const rpc = Bun.serve({
		async fetch(request) {
			const body = (await request.json()) as { id: unknown }
			return Response.json({ id: body.id, jsonrpc: '2.0', result: '0xaa36a7' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(rpc)
	if (rpc.port === undefined) throw new Error('Test RPC did not expose a port')
	const reservation = Bun.serve({ fetch: () => new Response('reserved'), hostname: '127.0.0.1', port: 0 })
	const uiPort = reservation.port
	await reservation.stop(true)
	if (uiPort === undefined) throw new Error('Test dashboard reservation did not expose a port')
	const configuration = (await Bun.file(join(import.meta.dir, '..', '..', 'config', 'operator.example.json')).json()) as Record<string, unknown>
	const runtime = Reflect.get(configuration, 'runtime')
	if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) throw new Error('Example runtime is missing')
	Reflect.set(runtime, 'stateFile', join(directory, 'state.json'))
	Reflect.set(runtime, 'pollMilliseconds', 1_000)
	Reflect.set(runtime, 'uiPort', uiPort)
	const configurationPath = join(directory, 'operator.json')
	await writeFile(configurationPath, JSON.stringify(configuration), 'utf8')
	const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'run.ts')], {
		cwd: join(import.meta.dir, '..', '..'),
		env: { ...process.env, ZOLTAR_LIQUIDATOR_CONFIG: configurationPath },
		stderr: 'pipe',
		stdout: 'pipe',
	})
	children.push(child)
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
		const blocked = await fetch(`${origin}${endpoint}`, { body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin }, method: 'PUT' })
		expect(blocked.status, `${endpoint}: ${await blocked.clone().text()}`).toBe(400)
	}
	if (child.exitCode !== null) throw new Error(`Liquidator exited before profile switch: ${await new Response(child.stderr).text()}`)
	const profileResult = await fetch(`${origin}/api/network-profile`, {
		body: JSON.stringify({ network: 'sepolia' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(profileResult.status, await profileResult.clone().text()).toBe(200)
	for (let attempt = 0; attempt < 700; attempt++) {
		if (child.exitCode !== null) throw new Error(`Liquidator exited during profile switch: ${await new Response(child.stderr).text()}`)
		const selected = await waitForJson(origin, '/api/configuration')
		if (Reflect.get(Reflect.get(selected, 'network') as object, 'name') === 'sepolia') break
		await Bun.sleep(25)
	}
	expect(await waitForJson(origin, '/api/configuration')).toMatchObject({ network: { name: 'sepolia' }, networkConfigured: false })
	expect(child.exitCode).toBeNull()
	const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}/`
	const response = await fetch(`${origin}/api/network-connectivity`, {
		body: JSON.stringify({ connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }, network: 'sepolia' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(response.status, await response.clone().text()).toBe(200)
	expect(await response.json()).toMatchObject({ network: { chainId: 11_155_111, name: 'sepolia' } })
	const signerAfterConnectivity = await fetch(`${origin}/api/signer`, {
		body: JSON.stringify({ privateKey: '', rememberSigner: false }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(signerAfterConnectivity.status, await signerAfterConnectivity.clone().text()).toBe(200)
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(true)
	const backToMainnet = await fetch(`${origin}/api/network-profile`, {
		body: JSON.stringify({ network: 'mainnet' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
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
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-rejected-profile-'))
	directories.push(directory)
	const rpc = Bun.serve({
		async fetch(request) {
			const body = (await request.json()) as { id: unknown; method: string }
			const result = body.method === 'eth_chainId' ? '0x1' : body.method === 'eth_getCode' ? '0x' : '0x0'
			return Response.json({ id: body.id, jsonrpc: '2.0', result })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(rpc)
	if (rpc.port === undefined) throw new Error('Test RPC did not expose a port')
	const reservation = Bun.serve({ fetch: () => new Response('reserved'), hostname: '127.0.0.1', port: 0 })
	const uiPort = reservation.port
	await reservation.stop(true)
	if (uiPort === undefined) throw new Error('Test dashboard reservation did not expose a port')
	const configuration = (await Bun.file(join(import.meta.dir, '..', '..', 'config', 'operator.example.json')).json()) as Record<string, unknown>
	const runtime = Reflect.get(configuration, 'runtime')
	if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) throw new Error('Example runtime is missing')
	const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}/`
	Reflect.set(configuration, 'connectivity', { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl, rpcQuorum: 1 })
	Reflect.set(configuration, 'network', { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' })
	Reflect.set(configuration, 'networkConfigured', true)
	Reflect.set(configuration, 'paused', false)
	const activeMarket = Reflect.get(configuration, 'centralizedMarkets')
	if (typeof activeMarket !== 'object' || activeMarket === null || Array.isArray(activeMarket)) throw new Error('Example centralized market is missing')
	Reflect.set(activeMarket, 'assetChainId', 1)
	Reflect.set(runtime, 'pollMilliseconds', 1_000)
	Reflect.set(runtime, 'stateFile', join(directory, 'mainnet-state.json'))
	Reflect.set(runtime, 'uiPort', uiPort)
	const configurationPath = join(directory, 'operator.json')
	await writeFile(configurationPath, JSON.stringify(configuration), 'utf8')
	const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'run.ts')], {
		cwd: join(import.meta.dir, '..', '..'),
		env: { ...process.env, ZOLTAR_LIQUIDATOR_CONFIG: configurationPath },
		stderr: 'pipe',
		stdout: 'pipe',
	})
	children.push(child)
	const origin = `http://127.0.0.1:${uiPort.toString()}`
	await Bun.sleep(200)
	if (child.exitCode !== null) throw new Error(`Liquidator exited before rejected-profile test: ${await new Response(child.stderr).text()}`)
	await waitForJson(origin, '/api/configuration', child)
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)

	const incompatibleProfile = JSON.parse(JSON.stringify(configuration)) as Record<string, unknown>
	const incompatibleRuntime = Reflect.get(incompatibleProfile, 'runtime')
	const incompatibleMarket = Reflect.get(incompatibleProfile, 'centralizedMarkets')
	if (typeof incompatibleRuntime !== 'object' || incompatibleRuntime === null || Array.isArray(incompatibleRuntime) || typeof incompatibleMarket !== 'object' || incompatibleMarket === null || Array.isArray(incompatibleMarket)) throw new Error('Expected mutable profile fixture')
	Reflect.set(incompatibleProfile, 'network', { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' })
	Reflect.set(incompatibleProfile, 'networkConfigured', false)
	Reflect.deleteProperty(incompatibleProfile, 'connectivity')
	Reflect.set(incompatibleProfile, 'paused', true)
	Reflect.set(incompatibleMarket, 'assetChainId', 11_155_111)
	Reflect.set(incompatibleRuntime, 'stateFile', join(directory, 'sepolia-state.json'))
	Reflect.set(incompatibleRuntime, 'uiPort', uiPort + 1)
	await writeFile(`${configurationPath}.sepolia.profile`, JSON.stringify(incompatibleProfile), 'utf8')

	const rejected = await fetch(`${origin}/api/network-profile`, {
		body: JSON.stringify({ network: 'sepolia' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(rejected.status, await rejected.clone().text()).toBe(400)
	await Bun.sleep(50)
	expect(child.exitCode).toBeNull()
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
	const signer = await fetch(`${origin}/api/signer`, {
		body: JSON.stringify({ privateKey: '', rememberSigner: false }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(signer.status, await signer.clone().text()).toBe(200)

	Reflect.set(incompatibleRuntime, 'uiPort', uiPort)
	Reflect.set(incompatibleProfile, 'connectivity', { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl, rpcQuorum: 1 })
	await writeFile(`${configurationPath}.sepolia.profile`, JSON.stringify(incompatibleProfile), 'utf8')
	const activeBeforeLockedSwitch = await Bun.file(configurationPath).text()
	const targetStateLock = await acquireFileProcessLock(join(directory, 'sepolia-state.json'), 'Liquidator state')
	try {
		const locked = await fetch(`${origin}/api/network-profile`, {
			body: JSON.stringify({ network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(locked.status, await locked.clone().text()).toBe(400)
		expect(await Bun.file(configurationPath).text()).toBe(activeBeforeLockedSwitch)
		expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
		expect(child.exitCode).toBeNull()
	} finally {
		await targetStateLock.release()
	}

	Reflect.set(incompatibleProfile, 'networkConfigured', true)
	await writeFile(`${configurationPath}.sepolia.profile`, JSON.stringify(incompatibleProfile), 'utf8')
	const wrongChain = await fetch(`${origin}/api/network-profile`, {
		body: JSON.stringify({ network: 'sepolia' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(wrongChain.status, await wrongChain.clone().text()).toBe(400)
	expect(await Bun.file(configurationPath).text()).toBe(activeBeforeLockedSwitch)
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
	expect(child.exitCode).toBeNull()

	const targetPrivateKey = `0x${'22'.repeat(32)}` as const
	const targetAccount = privateKeyToAccount(targetPrivateKey)
	const wrongBoundState = initialRuntimeState(true, targetAccount.address, 1)
	await saveDurableState(join(directory, 'sepolia-state.json'), wrongBoundState)
	Reflect.set(incompatibleProfile, 'networkConfigured', false)
	await writeFile(`${configurationPath}.sepolia.profile`, JSON.stringify(incompatibleProfile), 'utf8')
	const wrongBoundProfile = await fetch(`${origin}/api/network-profile`, {
		body: JSON.stringify({ network: 'sepolia' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(wrongBoundProfile.status, await wrongBoundProfile.clone().text()).toBe(400)
	expect(await Bun.file(configurationPath).text()).toBe(activeBeforeLockedSwitch)
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
	expect(child.exitCode).toBeNull()

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
	const wrongIntent = await fetch(`${origin}/api/network-profile`, {
		body: JSON.stringify({ network: 'sepolia' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(wrongIntent.status, await wrongIntent.clone().text()).toBe(400)
	expect(await Bun.file(configurationPath).text()).toBe(activeBeforeLockedSwitch)
	expect(await Bun.file(`${configurationPath}.sepolia.profile`).text()).toBe(wrongIntentProfile)
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
	expect(child.exitCode).toBeNull()
})

test('stops the dashboard and exits when startup network validation fails', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-startup-'))
	directories.push(directory)
	const rpc = Bun.serve({
		fetch: async request => {
			const body = (await request.json()) as { id: unknown }
			return Response.json({ id: body.id, jsonrpc: '2.0', result: '0x1' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(rpc)
	if (rpc.port === undefined) throw new Error('Test RPC did not expose a port')
	const reservation = Bun.serve({ fetch: () => new Response('reserved'), hostname: '127.0.0.1', port: 0 })
	const uiPort = reservation.port
	await reservation.stop(true)
	if (uiPort === undefined) throw new Error('Test dashboard reservation did not expose a port')
	const examplePath = join(import.meta.dir, '..', '..', 'config', 'operator.example.json')
	const configuration = JSON.parse(await Bun.file(examplePath).text()) as {
		connectivity: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl: string }
		runtime: { stateFile: string; ui: boolean; uiPort: number }
	}
	const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}`
	configuration.connectivity = { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }
	Reflect.set(configuration, 'network', { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' })
	configuration.runtime.stateFile = join(directory, 'state.json')
	configuration.runtime.ui = true
	configuration.runtime.uiPort = uiPort
	const configurationPath = join(directory, 'operator.json')
	await writeFile(configurationPath, JSON.stringify(configuration), 'utf8')
	const runSource = join(import.meta.dir, '..', '..', 'src', 'cli', 'run.ts')
	const child = Bun.spawn([process.execPath, runSource], {
		cwd: join(import.meta.dir, '..', '..'),
		env: { ...process.env, ZOLTAR_LIQUIDATOR_CONFIG: configurationPath },
		stderr: 'pipe',
		stdout: 'pipe',
	})
	children.push(child)
	const exitCode = await Promise.race([child.exited, Bun.sleep(3_000).then(() => undefined)])
	if (exitCode === undefined) throw new Error('Liquidator did not exit after startup validation failed')
	const output = `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`
	expect(exitCode).toBe(1)
	expect(output).toContain('does not match configured chain')
})

test('rejects a wrong-chain private relay during startup validation', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-relay-startup-'))
	directories.push(directory)
	const rpc = Bun.serve({
		async fetch(request) {
			const body = (await request.json()) as { id: unknown }
			return Response.json({ id: body.id, jsonrpc: '2.0', result: '0xaa36a7' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	const relay = Bun.serve({
		async fetch(request) {
			const body = (await request.json()) as { id: unknown }
			return Response.json({ id: body.id, jsonrpc: '2.0', result: '0x1' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(rpc, relay)
	if (rpc.port === undefined || relay.port === undefined) throw new Error('Test RPC did not expose a port')
	const reservation = Bun.serve({ fetch: () => new Response('reserved'), hostname: '127.0.0.1', port: 0 })
	const uiPort = reservation.port
	await reservation.stop(true)
	if (uiPort === undefined) throw new Error('Test dashboard reservation did not expose a port')
	const examplePath = join(import.meta.dir, '..', '..', 'config', 'operator.example.json')
	const configuration = JSON.parse(await Bun.file(examplePath).text()) as {
		connectivity: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl: string }
		runtime: { stateFile: string; ui: boolean; uiPort: number }
		submission: { minimumBundleRelaySuccesses: number; mode: string; relayUrls: string[] }
	}
	const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}`
	configuration.connectivity = { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }
	Reflect.set(configuration, 'network', { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' })
	configuration.submission = { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: [`http://127.0.0.1:${relay.port.toString()}`] }
	configuration.runtime.stateFile = join(directory, 'state.json')
	configuration.runtime.ui = true
	configuration.runtime.uiPort = uiPort
	const configurationPath = join(directory, 'operator.json')
	await writeFile(configurationPath, JSON.stringify(configuration), 'utf8')
	const runSource = join(import.meta.dir, '..', '..', 'src', 'cli', 'run.ts')
	const child = Bun.spawn([process.execPath, runSource], {
		cwd: join(import.meta.dir, '..', '..'),
		env: { ...process.env, ZOLTAR_LIQUIDATOR_CONFIG: configurationPath },
		stderr: 'pipe',
		stdout: 'pipe',
	})
	children.push(child)
	const exitCode = await Promise.race([child.exited, Bun.sleep(3_000).then(() => undefined)])
	if (exitCode === undefined) throw new Error('Liquidator did not exit after relay validation failed')
	const output = `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`
	expect(exitCode).toBe(1)
	expect(output).toContain('Expected chain 11155111, received 1')
})

test('queries only deployment bytecode when the configured system is undeployed', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-undeployed-'))
	directories.push(directory)
	const methods: string[] = []
	const rpc = Bun.serve({
		async fetch(request) {
			const body = (await request.json()) as { id: unknown; method: string }
			methods.push(body.method)
			return Response.json({ id: body.id, jsonrpc: '2.0', result: body.method === 'eth_chainId' ? '0xaa36a7' : '0x' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(rpc)
	if (rpc.port === undefined) throw new Error('Test RPC did not expose a port')
	const examplePath = join(import.meta.dir, '..', '..', 'config', 'operator.example.json')
	const configuration = JSON.parse(await Bun.file(examplePath).text()) as {
		connectivity: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl: string }
		runtime: { pollMilliseconds: number; stateFile: string; ui: boolean }
	}
	const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}`
	configuration.connectivity = { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }
	Reflect.set(configuration, 'network', { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' })
	configuration.runtime.pollMilliseconds = 1_000
	configuration.runtime.stateFile = join(directory, 'state.json')
	configuration.runtime.ui = false
	const configurationPath = join(directory, 'operator.json')
	await writeFile(configurationPath, JSON.stringify(configuration), 'utf8')
	const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'run.ts')], {
		cwd: join(import.meta.dir, '..', '..'),
		env: { ...process.env, ZOLTAR_LIQUIDATOR_CONFIG: configurationPath },
		stderr: 'pipe',
		stdout: 'pipe',
	})
	children.push(child)

	await waitForRpcMethod(methods, 'eth_getCode')
	const deploymentCheckIndex = methods.indexOf('eth_getCode')
	await Bun.sleep(100)
	expect(methods.slice(deploymentCheckIndex)).toEqual(['eth_getCode'])
})
