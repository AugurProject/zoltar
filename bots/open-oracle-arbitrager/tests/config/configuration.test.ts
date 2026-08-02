import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateKeyToAccount, type Hex } from '#ethereum'
import { loadOperatorSettings, saveOperatorSettings, type PersistedOperatorSettings } from '#config/settings-store'
import { assertDistinctPersistentPaths } from '#config/configuration'

const executable = process.execPath
const runSource = join(import.meta.dir, '..', '..', 'src', 'cli', 'run.ts')
const temporaryDirectories: string[] = []
const children: Bun.Subprocess[] = []
const servers: Bun.Server<unknown>[] = []

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true)
	for (const child of children.splice(0)) {
		child.kill()
		await child.exited
	}
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function temporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-configuration-'))
	temporaryDirectories.push(directory)
	return directory
}

function settings(rpcUrl: string, uiPort: number, privateKey?: Hex): PersistedOperatorSettings {
	const address = '0x0000000000000000000000000000000000000001'
	return {
		centralizedMarkets: {
			assetAddress: address,
			assetChainId: 1,
			assetSymbol: 'REP',
			depthBps: 500n,
			maximumDexDeviationBps: 1_000n,
			maximumObservationAgeMilliseconds: 30_000,
			maximumVenueDispersionBps: 500n,
			minimumAskDepthEth: 0n,
			minimumBidDepthEth: 0n,
			minimumSourceCount: 1,
			orderBookLimit: 20,
			requestTimeoutMilliseconds: 5_000,
			requiredForExecution: false,
			sources: [],
		},
		connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl },
		deployment: {
			coordinatorAddresses: [],
			deploymentManifest: undefined,
			executor: undefined,
			openOracle: '0x0000000000000000000000000000000000000000',
			quorumRpcUrls: [],
			rep: address,
			uniswapFactory: address,
			uniswapQuoter: address,
			uniswapRouter: undefined,
			uniswapV2Router: undefined,
			uniswapV4PoolManager: undefined,
			uniswapV4Quoter: undefined,
			weth: address,
		},
		network: 'mainnet',
		paused: false,
		privateKey,
		runtime: {
			execute: false,
			historyFile: '.state/history.jsonl',
			lookbackBlocks: 0n,
			maxHedgeSlippageBps: 50n,
			once: false,
			positionFile: '.state/positions.json',
			priceHistoryFile: '.state/prices.jsonl',
			riskLimits: {
				lifecycleGasReserveWeth: 10n ** 16n,
				maxConcurrentPositions: 1,
				maxDailyGasSpendWeth: 5n * 10n ** 16n,
				maxPositionNotionalWeth: 5n * 10n ** 18n,
				maxTotalLockedWeth: 10n * 10n ** 18n,
			},
			ui: true,
			uiHost: '127.0.0.1',
			uiPort,
		},
		strategy: {
			maxSpotTwapTicks: 100n,
			minimumProfitBps: 100n,
			minimumProfitWeth: 10n ** 16n,
			minimumRemainingBlocks: 3n,
			minimumRemainingSeconds: 36n,
			pollMilliseconds: 1_000,
			twapSeconds: 1_800,
		},
		submission: { minimumBundleSimulations: 1, mode: 'private', relayUrls: ['https://relay.flashbots.net/'] },
		tokenAddresses: [],
	}
}

async function runToExit(configurationPath: string, arguments_: readonly string[] = [], extraEnvironment: Record<string, string> = {}) {
	const child = Bun.spawn([executable, runSource, ...arguments_], {
		env: { ...process.env, ...extraEnvironment, OPEN_ORACLE_ARBITRAGER_CONFIG: configurationPath },
		stderr: 'pipe',
		stdout: 'pipe',
	})
	const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
	return { exitCode, output: `${stdout}${stderr}` }
}

function unusedPort() {
	const server = Bun.serve({ fetch: () => new Response('reserved'), hostname: '127.0.0.1', port: 0 })
	const port = server.port
	server.stop(true)
	if (port === undefined) throw new Error('Temporary server did not expose a port')
	return port
}

async function waitForJson(origin: string, path: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(`${origin}${path}`)
			if (response.ok) return (await response.json()) as Record<string, unknown>
		} catch (error) {
			// The server may still be starting.
			void error
		}
		await Bun.sleep(20)
	}
	throw new Error('Dashboard did not become ready')
}

describe('file-only startup configuration', () => {
	test('rejects an operator file reused as a runtime persistence file', () => {
		expect(() => assertDistinctPersistentPaths('/state/operator.json', { historyFile: '/state/history.jsonl', positionFile: '/state/positions.json', priceHistoryFile: '/state/nested/../operator.json' })).toThrow('must use distinct paths')
	})

	test('rejects every command-line argument', async () => {
		const directory = await temporaryDirectory()
		const result = await runToExit(join(directory, 'missing.json'), ['--help'])
		expect(result.exitCode).toBe(1)
		expect(result.output).toContain('accepts no command-line arguments')
	})

	test('explains how to create the required configuration file', async () => {
		const directory = await temporaryDirectory()
		const result = await runToExit(join(directory, 'missing.json'))
		expect(result.exitCode).toBe(1)
		expect(result.output).toContain('Missing operator configuration')
		expect(result.output).toContain('config/operator.example.json')
	})

	test('rejects invalid file settings before RPC activity', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		const value = settings('http://127.0.0.1:1/', 4173)
		await saveOperatorSettings(path, value)
		const document = JSON.parse(await Bun.file(path).text()) as { runtime: { maxHedgeSlippageBps: string } }
		document.runtime.maxHedgeSlippageBps = '1001'
		await writeFile(path, JSON.stringify(document), 'utf8')
		const result = await runToExit(path)
		expect(result.exitCode).toBe(1)
		expect(result.output).toContain('maxHedgeSlippageBps must be from 0 to 1000')
	})

	test('serves and updates the complete redacted configuration while ignoring operational environment variables', async () => {
		const directory = await temporaryDirectory()
		const dashboardPort = unusedPort()
		const rpc = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const requestValue = (await request.json()) as { id: unknown; method: string }
				const result = requestValue.method === 'eth_chainId' || requestValue.method === 'eth_blockNumber' ? '0x1' : '0x'
				return Response.json({ id: requestValue.id, jsonrpc: '2.0', result })
			},
		})
		servers.push(rpc)
		if (rpc.port === undefined) throw new Error('Mock RPC did not expose a port')
		const savedPrivateKey = `0x${'11'.repeat(32)}` as Hex
		const ignoredEnvironmentKey = `0x${'22'.repeat(32)}` as Hex
		const path = join(directory, 'operator.json')
		await saveOperatorSettings(path, settings(`http://127.0.0.1:${rpc.port.toString()}/`, dashboardPort, savedPrivateKey))
		const child = Bun.spawn([executable, runSource], {
			env: { ...process.env, OPEN_ORACLE_ARBITRAGER_CONFIG: path, PRIVATE_KEY: ignoredEnvironmentKey },
			stderr: 'pipe',
			stdout: 'pipe',
		})
		children.push(child)
		const origin = `http://127.0.0.1:${dashboardPort.toString()}`
		const snapshot = await waitForJson(origin, '/api/state')
		expect(snapshot['wallet']).toBe(privateKeyToAccount(savedPrivateKey).address)
		const staleEnvelope = await waitForJson(origin, '/api/configuration')
		const configuration = staleEnvelope['configuration']
		if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) throw new Error('Configuration document is missing')
		expect(Reflect.get(configuration, 'privateKey')).toBe('__PRESERVE_SAVED_PRIVATE_KEY__')
		expect(JSON.stringify(staleEnvelope)).not.toContain(savedPrivateKey)
		const runtime = Reflect.get(configuration, 'runtime')
		if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) throw new Error('Configuration runtime is missing')
		expect(Reflect.get(runtime, 'historyFile')).toBe('.state/history.jsonl')
		Reflect.set(runtime, 'lookbackBlocks', '123')
		const pauseResponse = await fetch(`${origin}/api/paused`, {
			body: JSON.stringify({ paused: true }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(pauseResponse.status).toBe(200)
		const staleBody = JSON.stringify(staleEnvelope)
		if (staleBody === undefined) throw new Error('Configuration must serialize')
		const staleResponse = await fetch(`${origin}/api/configuration`, {
			body: staleBody,
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(staleResponse.status, await staleResponse.clone().text()).toBe(409)
		expect((await loadOperatorSettings(path))?.paused).toBe(true)

		const currentEnvelope = await waitForJson(origin, '/api/configuration')
		const beforeCollision = await Bun.file(path).text()
		const collisionEnvelope = structuredClone(currentEnvelope)
		const collisionConfiguration = collisionEnvelope['configuration']
		if (typeof collisionConfiguration !== 'object' || collisionConfiguration === null || Array.isArray(collisionConfiguration)) throw new Error('Collision configuration document is missing')
		const collisionRuntime = Reflect.get(collisionConfiguration, 'runtime')
		if (typeof collisionRuntime !== 'object' || collisionRuntime === null || Array.isArray(collisionRuntime)) throw new Error('Collision runtime configuration is missing')
		Reflect.set(collisionRuntime, 'positionFile', path)
		const collisionResponse = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(collisionEnvelope),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(collisionResponse.status).toBe(400)
		expect(await collisionResponse.json()).toEqual({ error: 'Operator settings and runtime persistence files must use distinct paths' })
		expect(await Bun.file(path).text()).toBe(beforeCollision)
		expect((await waitForJson(origin, '/api/configuration'))['revision']).toBe(currentEnvelope['revision'])

		const currentConfiguration = currentEnvelope['configuration']
		if (typeof currentConfiguration !== 'object' || currentConfiguration === null || Array.isArray(currentConfiguration)) throw new Error('Current configuration document is missing')
		const currentRuntime = Reflect.get(currentConfiguration, 'runtime')
		if (typeof currentRuntime !== 'object' || currentRuntime === null || Array.isArray(currentRuntime)) throw new Error('Current runtime configuration is missing')
		Reflect.set(currentRuntime, 'lookbackBlocks', '123')
		const replacementPrivateKey = `0x${'33'.repeat(32)}` as Hex
		Reflect.set(currentConfiguration, 'privateKey', replacementPrivateKey)
		Reflect.set(currentConfiguration, 'paused', false)
		const currentBody = JSON.stringify(currentEnvelope)
		if (currentBody === undefined) throw new Error('Current configuration must serialize')
		const response = await fetch(`${origin}/api/configuration`, {
			body: currentBody,
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(response.status, await response.clone().text()).toBe(200)
		const replacementEnvelope = (await response.json()) as Record<string, unknown>
		const replacementConfiguration = replacementEnvelope['configuration']
		if (typeof replacementConfiguration !== 'object' || replacementConfiguration === null || Array.isArray(replacementConfiguration)) throw new Error('Replacement configuration document is missing')
		const replacementStrategy = Reflect.get(replacementConfiguration, 'strategy')
		if (typeof replacementStrategy !== 'object' || replacementStrategy === null || Array.isArray(replacementStrategy)) throw new Error('Replacement strategy is missing')
		Reflect.set(replacementStrategy, 'minimumProfitBps', '101')
		const replacementStrategyBody = JSON.stringify(replacementStrategy)
		if (replacementStrategyBody === undefined) throw new Error('Replacement strategy must serialize')
		const strategyResponse = await fetch(`${origin}/api/settings`, {
			body: replacementStrategyBody,
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(strategyResponse.status, await strategyResponse.clone().text()).toBe(200)
		const saved = await loadOperatorSettings(path)
		expect(saved?.runtime.lookbackBlocks).toBe(123n)
		expect(saved?.runtime.historyFile).toBe('.state/history.jsonl')
		expect(saved?.privateKey).toBe(replacementPrivateKey)
		expect(saved?.paused).toBe(false)
		expect(saved?.strategy.minimumProfitBps).toBe(101n)
		expect((await waitForJson(origin, '/api/state'))['paused']).toBe(true)
		expect((await waitForJson(origin, '/api/state'))['savedWallet']).toBe(privateKeyToAccount(replacementPrivateKey).address)

		const removalEnvelope = await waitForJson(origin, '/api/configuration')
		const removalConfiguration = removalEnvelope['configuration']
		if (typeof removalConfiguration !== 'object' || removalConfiguration === null || Array.isArray(removalConfiguration)) throw new Error('Removal configuration document is missing')
		Reflect.deleteProperty(removalConfiguration, 'privateKey')
		const removalBody = JSON.stringify(removalEnvelope)
		if (removalBody === undefined) throw new Error('Removal configuration must serialize')
		const removalResponse = await fetch(`${origin}/api/configuration`, {
			body: removalBody,
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(removalResponse.status, await removalResponse.clone().text()).toBe(200)
		expect((await loadOperatorSettings(path))?.privateKey).toBeUndefined()
		expect((await waitForJson(origin, '/api/state'))['savedWallet']).toBeUndefined()
	})
})
