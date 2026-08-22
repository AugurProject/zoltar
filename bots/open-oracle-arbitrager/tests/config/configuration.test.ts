import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keccak256, privateKeyToAccount, type Hex } from '#ethereum'
import { loadOperatorSettings, operatorProfilePath, saveOperatorSettings, type PersistedOperatorSettings } from '#config/settings-store'
import { assertDistinctPersistentPaths } from '#config/configuration'
import { deterministicDeploymentProxy, executorDeploymentPlan } from '#execution/create2-executor'
import { clearExecutorDeploymentIntent, executorDeploymentIntentPath, saveExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { acquirePositionJournalLock } from '#state/position-store'

const executable = process.execPath
const runSource = join(import.meta.dir, '..', '..', 'src', 'cli', 'run.ts')
const deployExecutorSource = join(import.meta.dir, '..', '..', 'src', 'cli', 'deploy-executor.ts')
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
			minimumAskDepthAttoEth: 0n,
			minimumBidDepthAttoEth: 0n,
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
		networkConfigured: true,
		paused: false,
		privateKey,
		rpcQuorum: 2,
		runtime: {
			execute: false,
			historyFile: '.state/history.jsonl',
			lookbackBlocks: 0n,
			maxHedgeSlippageBps: 50n,
			once: false,
			positionFile: '.state/positions.json',
			priceHistoryFile: '.state/prices.jsonl',
			riskLimits: {
				lifecycleGasReserveAttoWeth: 10n ** 16n,
				maxConcurrentPositions: 1,
				maxDailyGasSpendAttoWeth: 5n * 10n ** 16n,
				maxPositionNotionalAttoWeth: 5n * 10n ** 18n,
				maxTotalLockedAttoWeth: 10n * 10n ** 18n,
			},
			ui: true,
			uiHost: '127.0.0.1',
			uiPort,
		},
		strategy: {
			maxSpotTwapTicks: 100n,
			minimumProfitBps: 100n,
			minimumProfitAttoWeth: 10n ** 16n,
			minimumRemainingBlocks: 3n,
			minimumRemainingSeconds: 36n,
			pollMilliseconds: 1_000,
			twapSeconds: 1_800,
		},
		submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
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

async function unusedPort() {
	const server = Bun.serve({ fetch: () => new Response('reserved'), hostname: '127.0.0.1', port: 0 })
	const port = server.port
	await server.stop(true)
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

async function waitForStateValue(origin: string, key: string, expected: unknown) {
	for (let attempt = 0; attempt < 1_000; attempt++) {
		const state = await waitForJson(origin, '/api/state')
		if (state[key] === expected) return state
		await Bun.sleep(20)
	}
	throw new Error(`Dashboard state ${key} did not become ${String(expected)} at a scan boundary`)
}

describe('file-only startup configuration', () => {
	test('documents the saved default and opt-in executor RPC policies', async () => {
		const child = Bun.spawn([executable, deployExecutorSource, '--help'], { env: { ...process.env }, stderr: 'pipe', stdout: 'pipe' })
		const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
		expect(exitCode, stderr).toBe(0)
		expect(stdout).toContain('Optional; saved quorum 2 requires two')
		expect(stdout).toContain('defaults to one reader')
	})

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

	test('starts from saved RPC settings without an operational environment', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		await saveOperatorSettings(path, settings('https://saved.example/', 4173))
		const child = Bun.spawn([executable, '-e', "const { loadConfiguration } = await import('./src/config/configuration.ts'); const value = await loadConfiguration(); console.log(JSON.stringify({ connectivity: value.connectivity, quorumRpcUrls: value.quorumRpcUrls, rpcQuorum: value.rpcQuorum }))"], {
			cwd: join(import.meta.dir, '..', '..'),
			env: { OPEN_ORACLE_ARBITRAGER_CONFIG: path, PATH: process.env['PATH'] },
			stderr: 'pipe',
			stdout: 'pipe',
		})
		const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
		expect(exitCode, stderr).toBe(0)
		expect(JSON.parse(stdout)).toEqual({
			connectivity: {
				publicRpcUrls: ['https://saved.example/'],
				readRpcUrl: 'https://saved.example/',
			},
			quorumRpcUrls: [],
			rpcQuorum: 2,
		})
	})

	test('makes the saved quorum authoritative for runtime reads despite a conflicting environment', async () => {
		const directory = await temporaryDirectory()
		for (const [rpcQuorum, environmentQuorum, expectedStatus] of [
			[1, '2', 'resolved'],
			[2, '1', 'rejected'],
		] as const) {
			const path = join(directory, `operator-${rpcQuorum.toString()}.json`)
			await saveOperatorSettings(path, { ...settings('https://saved.example/', 4173), rpcQuorum })
			const child = Bun.spawn(
				[
					executable,
					'-e',
					"const { loadConfiguration } = await import('./src/config/configuration.ts'); const { settledQuorumValue } = await import('@zoltar/bot-shared/monitoring/read-quorum'); await loadConfiguration(); try { const value = await settledQuorumValue('saved quorum', [Promise.resolve({ endpoint: 'one', value: 7 })]); console.log(JSON.stringify({ status: 'resolved', value })) } catch (error) { console.log(JSON.stringify({ status: 'rejected', message: error instanceof Error ? error.message : String(error) })) }",
				],
				{
					cwd: join(import.meta.dir, '..', '..'),
					env: { ...process.env, OPEN_ORACLE_ARBITRAGER_CONFIG: path, ZOLTAR_BOT_RPC_QUORUM: environmentQuorum },
					stderr: 'pipe',
					stdout: 'pipe',
				},
			)
			const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
			expect(exitCode, stderr).toBe(0)
			const result = JSON.parse(stdout) as { message?: string; status: string }
			expect(result.status).toBe(expectedStatus)
			if (rpcQuorum === 2) expect(result.message).toContain('two available independent RPC endpoints')
		}
	})

	test('makes the selected chain profile quorum authoritative for deploy-executor endpoint validation', async () => {
		const directory = await temporaryDirectory()
		for (const [activeRpcQuorum, sepoliaRpcQuorum, environmentQuorum] of [
			[1, 2, '1'],
			[2, 1, '2'],
		] as const) {
			const path = join(directory, `deploy-${activeRpcQuorum.toString()}-${sepoliaRpcQuorum.toString()}.json`)
			await saveOperatorSettings(path, { ...settings('http://127.0.0.1:1/', 4173), rpcQuorum: activeRpcQuorum })
			const sepoliaSettings = settings('http://127.0.0.1:1/', 4173)
			sepoliaSettings.centralizedMarkets = { ...sepoliaSettings.centralizedMarkets, assetChainId: 11_155_111 }
			sepoliaSettings.network = 'sepolia'
			sepoliaSettings.rpcQuorum = sepoliaRpcQuorum
			await saveOperatorSettings(operatorProfilePath(path, 'sepolia'), sepoliaSettings)
			const child = Bun.spawn([executable, deployExecutorSource, '--network=sepolia', '--rpc-url=http://127.0.0.1:1'], {
				env: {
					...process.env,
					OPEN_ORACLE_ARBITRAGER_CONFIG: path,
					PRIVATE_KEY: `0x${'11'.repeat(32)}`,
					ZOLTAR_BOT_RPC_QUORUM: environmentQuorum,
				},
				stderr: 'pipe',
				stdout: 'pipe',
			})
			const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
			const output = `${stdout}${stderr}`
			expect(exitCode).toBe(1)
			if (sepoliaRpcQuorum === 1) expect(output).not.toContain('does not satisfy the saved RPC agreement requirement')
			else expect(output).toContain('does not satisfy the saved RPC agreement requirement')
		}
		const mismatchedPath = join(directory, 'deploy-mismatched-profile.json')
		await saveOperatorSettings(mismatchedPath, settings('http://127.0.0.1:1/', 4173))
		await saveOperatorSettings(operatorProfilePath(mismatchedPath, 'sepolia'), settings('http://127.0.0.1:1/', 4173))
		const mismatched = Bun.spawn([executable, deployExecutorSource, '--network=sepolia', '--rpc-url=http://127.0.0.1:1'], {
			env: { ...process.env, OPEN_ORACLE_ARBITRAGER_CONFIG: mismatchedPath, PRIVATE_KEY: `0x${'11'.repeat(32)}` },
			stderr: 'pipe',
			stdout: 'pipe',
		})
		const [mismatchedExitCode, mismatchedStderr] = await Promise.all([mismatched.exited, new Response(mismatched.stderr).text()])
		expect(mismatchedExitCode).toBe(1)
		expect(mismatchedStderr).toContain('The sepolia profile contains mainnet settings')
	})

	test('defaults deploy-executor to one reader when the operator file is missing', async () => {
		const directory = await temporaryDirectory()
		const child = Bun.spawn([executable, deployExecutorSource, '--network=sepolia', '--rpc-url=http://127.0.0.1:1'], {
			env: {
				...process.env,
				OPEN_ORACLE_ARBITRAGER_CONFIG: join(directory, 'missing.json'),
				PRIVATE_KEY: `0x${'11'.repeat(32)}`,
			},
			stderr: 'pipe',
			stdout: 'pipe',
		})
		const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
		expect(exitCode).toBe(1)
		expect(stdout).toContain('predicted=')
		expect(`${stdout}${stderr}`).not.toContain('does not satisfy the saved RPC agreement requirement')
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

	test('keeps the dashboard running when the configured RPC is offline at startup', async () => {
		const directory = await temporaryDirectory()
		const dashboardPort = await unusedPort()
		const rpcPort = await unusedPort()
		const value = settings(`http://127.0.0.1:${rpcPort.toString()}/`, dashboardPort)
		value.runtime.historyFile = join(directory, 'history.jsonl')
		value.runtime.positionFile = join(directory, 'positions.json')
		value.runtime.priceHistoryFile = join(directory, 'prices.jsonl')
		const path = join(directory, 'operator.json')
		await saveOperatorSettings(path, value)
		const child = Bun.spawn([executable, runSource], { env: { ...process.env, OPEN_ORACLE_ARBITRAGER_CONFIG: path }, stderr: 'pipe', stdout: 'pipe' })
		children.push(child)
		const origin = `http://127.0.0.1:${dashboardPort.toString()}`
		let snapshot = await waitForJson(origin, '/api/state')
		for (let attempt = 0; attempt < 100 && snapshot['status'] !== 'connectivity-degraded'; attempt++) {
			await Bun.sleep(20)
			snapshot = await waitForJson(origin, '/api/state')
		}
		expect(snapshot['status'], JSON.stringify(snapshot)).toBe('connectivity-degraded')
		expect(child.exitCode).toBeNull()
	})

	test('keeps the dashboard available until initial chain and RPC settings are saved', async () => {
		const directory = await temporaryDirectory()
		const dashboardPort = await unusedPort()
		const rpc = Bun.serve({
			async fetch(request) {
				const body = (await request.json()) as { id: unknown }
				return Response.json({ id: body.id, jsonrpc: '2.0', result: '0xaa36a7' })
			},
			hostname: '127.0.0.1',
			port: 0,
		})
		servers.push(rpc)
		if (rpc.port === undefined) throw new Error('Mock RPC did not expose a port')
		const configuration = (await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json()) as Record<string, unknown>
		const runtime = Reflect.get(configuration, 'runtime')
		if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) throw new Error('Example runtime is missing')
		Reflect.set(runtime, 'historyFile', join(directory, 'history.jsonl'))
		Reflect.set(runtime, 'positionFile', join(directory, 'positions.json'))
		Reflect.set(runtime, 'priceHistoryFile', join(directory, 'prices.jsonl'))
		Reflect.set(runtime, 'uiPort', dashboardPort)
		const strategy = Reflect.get(configuration, 'strategy')
		if (typeof strategy !== 'object' || strategy === null || Array.isArray(strategy)) throw new Error('Example strategy is missing')
		Reflect.set(strategy, 'pollMilliseconds', 1_000)
		Reflect.set(configuration, 'submission', { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })
		const path = join(directory, 'operator.json')
		await writeFile(path, JSON.stringify(configuration), 'utf8')
		const child = Bun.spawn([executable, runSource], { env: { ...process.env, OPEN_ORACLE_ARBITRAGER_CONFIG: path }, stderr: 'pipe', stdout: 'pipe' })
		children.push(child)
		const origin = `http://127.0.0.1:${dashboardPort.toString()}`
		const initial = await waitForJson(origin, '/api/configuration')
		const initialConfiguration = initial['configuration']
		expect(initialConfiguration).toMatchObject({ network: 'mainnet', networkConfigured: false })
		expect((await waitForJson(origin, '/api/state'))['status']).toBe('paused')
		for (const [endpoint, body] of [
			['/api/signer', { privateKey: '', rememberSigner: false }],
			['/api/settings', {}],
			['/api/deployment', {}],
			['/api/paused', { paused: false }],
		] as const) {
			const blocked = await fetch(`${origin}${endpoint}`, { body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin }, method: 'PUT' })
			expect(blocked.status, `${endpoint}: ${await blocked.clone().text()}`).toBe(400)
		}
		const deploymentPrivateKey = `0x${'33'.repeat(32)}` as Hex
		const deploymentAccount = privateKeyToAccount(deploymentPrivateKey)
		const deploymentSalt = `0x${'44'.repeat(32)}` as Hex
		const deploymentPlan = executorDeploymentPlan(deploymentSalt)
		const serializedDeployment = await deploymentAccount.signTransaction({ chainId: 1, data: deploymentPlan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const deploymentIntentPath = executorDeploymentIntentPath(path, 'mainnet')
		await saveExecutorDeploymentIntent(deploymentIntentPath, { account: deploymentAccount.address, address: deploymentPlan.address, chainId: 1, salt: deploymentSalt, serializedTransaction: serializedDeployment, transactionHash: keccak256(serializedDeployment), version: 1 })
		const activeBeforeBlockedSwitch = await Bun.file(path).text()
		const blockedProfile = await fetch(`${origin}/api/network-profile`, {
			body: JSON.stringify({ network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(blockedProfile.status).toBe(400)
		expect(await Bun.file(path).text()).toBe(activeBeforeBlockedSwitch)
		expect(await Bun.file(operatorProfilePath(path, 'mainnet')).exists()).toBe(false)
		expect(await Bun.file(operatorProfilePath(path, 'sepolia')).exists()).toBe(false)
		await clearExecutorDeploymentIntent(deploymentIntentPath)
		const dormantDeploymentIntentPath = executorDeploymentIntentPath(path, 'sepolia')
		await saveExecutorDeploymentIntent(dormantDeploymentIntentPath, {
			account: deploymentAccount.address,
			address: deploymentPlan.address,
			chainId: 1,
			salt: deploymentSalt,
			serializedTransaction: serializedDeployment,
			transactionHash: keccak256(serializedDeployment),
			version: 1,
		})
		expect((await waitForJson(origin, '/api/state'))['status']).toBe('paused')
		expect(child.exitCode).toBeNull()
		await clearExecutorDeploymentIntent(dormantDeploymentIntentPath)
		const profileResponse = await fetch(`${origin}/api/network-profile`, {
			body: JSON.stringify({ network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(profileResponse.status, await profileResponse.clone().text()).toBe(200)
		let selectedProfile: Record<string, unknown> | undefined
		for (let attempt = 0; attempt < 700; attempt++) {
			selectedProfile = await waitForJson(origin, '/api/configuration')
			const selected = Reflect.get(selectedProfile, 'configuration')
			if (typeof selected === 'object' && selected !== null && Reflect.get(selected, 'network') === 'sepolia') break
			await Bun.sleep(25)
		}
		expect(selectedProfile).toMatchObject({ configuration: { network: 'sepolia', networkConfigured: false } })
		expect(child.exitCode).toBeNull()
		await waitForStateValue(origin, 'network', 'sepolia')
		const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}/`
		if (typeof initialConfiguration !== 'object' || initialConfiguration === null || Array.isArray(initialConfiguration)) throw new Error('Initial configuration document is missing')
		const initialStrategy = Reflect.get(initialConfiguration, 'strategy')
		if (typeof initialStrategy !== 'object' || initialStrategy === null || Array.isArray(initialStrategy)) throw new Error('Initial strategy document is missing')
		const initialMinimumProfitBps = Reflect.get(initialStrategy, 'minimumProfitBps')
		const response = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl }, network: 'sepolia', rpcQuorum: 1 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(response.status, await response.clone().text()).toBe(200)
		expect(await response.json()).toMatchObject({ network: 'sepolia', rpcQuorum: 1 })
		expect(await loadOperatorSettings(path)).toMatchObject({ networkConfigured: true, rpcQuorum: 1 })
		await waitForStateValue(origin, 'networkConfigured', true)
		expect(await waitForJson(origin, '/api/state')).toMatchObject({ expectedChainId: 11_155_111, network: 'sepolia', networkConfigured: true })
		let configuredState = await waitForJson(origin, '/api/state')
		const rpcOrigin = new URL(rpcUrl).origin
		for (let attempt = 0; attempt < 100 && !(JSON.stringify(configuredState['rpcEndpointHealth']) ?? '').includes(rpcOrigin); attempt++) {
			await Bun.sleep(20)
			configuredState = await waitForJson(origin, '/api/state')
		}
		expect(JSON.stringify(configuredState['rpcEndpointHealth']) ?? '').toContain(rpcOrigin)
		const configuredEnvelopeForStrategy = await waitForJson(origin, '/api/configuration')
		const configuredDocumentForStrategy = configuredEnvelopeForStrategy['configuration']
		if (typeof configuredDocumentForStrategy !== 'object' || configuredDocumentForStrategy === null || Array.isArray(configuredDocumentForStrategy)) throw new Error('Configured strategy document is missing')
		const configuredStrategy = Reflect.get(configuredDocumentForStrategy, 'strategy')
		if (typeof configuredStrategy !== 'object' || configuredStrategy === null || Array.isArray(configuredStrategy)) throw new Error('Configured strategy settings are missing')
		const sepoliaStrategy = { ...configuredStrategy, minimumProfitBps: '901' }
		const savedSepoliaStrategy = await fetch(`${origin}/api/settings`, {
			body: JSON.stringify(sepoliaStrategy),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(savedSepoliaStrategy.status, await savedSepoliaStrategy.clone().text()).toBe(200)
		const resume = await fetch(`${origin}/api/paused`, {
			body: JSON.stringify({ paused: false }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(resume.status, await resume.clone().text()).toBe(200)
		expect(await resume.json()).toEqual({ paused: false })
		const noOpConfiguration = await waitForJson(origin, '/api/configuration')
		const noOpSave = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(noOpConfiguration),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(noOpSave.status, await noOpSave.clone().text()).toBe(200)
		const resumedState = await waitForStateValue(origin, 'paused', false)
		expect(resumedState['paused']).toBe(false)
		expect(resumedState['operationLog']).toEqual(expect.arrayContaining([expect.objectContaining({ message: 'Operator resume queued', reason: 'Saved and queued for the next scan boundary' })]))
		const configuredContents = await Bun.file(path).text()
		const mainnetProfilePath = operatorProfilePath(path, 'mainnet')
		const compatibleMainnetProfile = await Bun.file(mainnetProfilePath).text()
		const incompatibleMainnetProfile = JSON.parse(compatibleMainnetProfile) as Record<string, unknown>
		const incompatibleMainnetRuntime = Reflect.get(incompatibleMainnetProfile, 'runtime')
		if (typeof incompatibleMainnetRuntime !== 'object' || incompatibleMainnetRuntime === null || Array.isArray(incompatibleMainnetRuntime)) throw new Error('Mainnet profile runtime is missing')
		Reflect.set(incompatibleMainnetRuntime, 'uiPort', dashboardPort + 1)
		await writeFile(mainnetProfilePath, JSON.stringify(incompatibleMainnetProfile), 'utf8')
		const incompatibleSwitch = await fetch(`${origin}/api/network-profile`, {
			body: JSON.stringify({ network: 'mainnet' }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(incompatibleSwitch.status, await incompatibleSwitch.clone().text()).toBe(400)
		expect(await Bun.file(path).text()).toBe(configuredContents)
		await Bun.sleep(50)
		expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
		const mutationAfterRejectedSwitch = await fetch(`${origin}/api/settings`, {
			body: JSON.stringify(sepoliaStrategy),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(mutationAfterRejectedSwitch.status, await mutationAfterRejectedSwitch.clone().text()).toBe(200)
		await writeFile(mainnetProfilePath, compatibleMainnetProfile, 'utf8')
		const targetJournalLock = await acquirePositionJournalLock(join(directory, 'positions.json'))
		try {
			const lockedSwitch = await fetch(`${origin}/api/network-profile`, {
				body: JSON.stringify({ network: 'mainnet' }),
				headers: { 'content-type': 'application/json', origin },
				method: 'PUT',
			})
			expect(lockedSwitch.status, await lockedSwitch.clone().text()).toBe(400)
			expect(await Bun.file(path).text()).toBe(configuredContents)
			expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
			expect(child.exitCode).toBeNull()
		} finally {
			await targetJournalLock.release()
		}
		const executableMainnetProfile = JSON.parse(compatibleMainnetProfile) as Record<string, unknown>
		const executableRuntime = Reflect.get(executableMainnetProfile, 'runtime')
		const executableDeployment = Reflect.get(executableMainnetProfile, 'deployment')
		if (typeof executableRuntime !== 'object' || executableRuntime === null || Array.isArray(executableRuntime) || typeof executableDeployment !== 'object' || executableDeployment === null || Array.isArray(executableDeployment)) throw new Error('Executable Mainnet profile fixture is invalid')
		const executionAddress = '0x0000000000000000000000000000000000000001'
		Reflect.set(executableRuntime, 'execute', true)
		Reflect.set(executableMainnetProfile, 'privateKey', `0x${'11'.repeat(32)}`)
		Reflect.set(executableDeployment, 'executor', executionAddress)
		Reflect.set(executableDeployment, 'uniswapRouter', executionAddress)
		Reflect.set(executableDeployment, 'coordinatorAddresses', [executionAddress])
		Reflect.set(executableDeployment, 'deploymentManifest', {
			chainId: 1,
			contracts: [{ address: executionAddress, role: 'open-oracle', runtimeCodeHash: `0x${'00'.repeat(32)}` }],
			network: 'mainnet',
			version: 1,
		})
		for (const [field, missingValue] of [
			['executor', undefined],
			['uniswapRouter', undefined],
			['coordinatorAddresses', []],
			['deploymentManifest', undefined],
		] as const) {
			const invalidProfile = structuredClone(executableMainnetProfile)
			const invalidDeployment = Reflect.get(invalidProfile, 'deployment')
			if (typeof invalidDeployment !== 'object' || invalidDeployment === null || Array.isArray(invalidDeployment)) throw new Error('Executable deployment fixture is missing')
			if (missingValue === undefined) Reflect.deleteProperty(invalidDeployment, field)
			else Reflect.set(invalidDeployment, field, missingValue)
			await writeFile(mainnetProfilePath, JSON.stringify(invalidProfile), 'utf8')
			const rejectedExecutableSwitch = await fetch(`${origin}/api/network-profile`, {
				body: JSON.stringify({ network: 'mainnet' }),
				headers: { 'content-type': 'application/json', origin },
				method: 'PUT',
			})
			expect(rejectedExecutableSwitch.status, await rejectedExecutableSwitch.clone().text()).toBe(400)
			expect(await Bun.file(path).text()).toBe(configuredContents)
			expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
			expect(child.exitCode).toBeNull()
		}
		await writeFile(mainnetProfilePath, compatibleMainnetProfile, 'utf8')
		const mainnetIntentPath = executorDeploymentIntentPath(path, 'mainnet')
		await writeFile(mainnetIntentPath, '{', 'utf8')
		const malformedIntentSwitch = await fetch(`${origin}/api/network-profile`, {
			body: JSON.stringify({ network: 'mainnet' }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(malformedIntentSwitch.status, await malformedIntentSwitch.clone().text()).toBe(400)
		expect(await Bun.file(path).text()).toBe(configuredContents)
		expect(await Bun.file(mainnetProfilePath).text()).toBe(compatibleMainnetProfile)
		expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
		expect(child.exitCode).toBeNull()
		const wrongChainDeployment = await deploymentAccount.signTransaction({ chainId: 11_155_111, data: deploymentPlan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		await saveExecutorDeploymentIntent(mainnetIntentPath, {
			account: deploymentAccount.address,
			address: deploymentPlan.address,
			chainId: 11_155_111,
			salt: deploymentSalt,
			serializedTransaction: wrongChainDeployment,
			transactionHash: keccak256(wrongChainDeployment),
			version: 1,
		})
		const wrongChainIntentSwitch = await fetch(`${origin}/api/network-profile`, {
			body: JSON.stringify({ network: 'mainnet' }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(wrongChainIntentSwitch.status, await wrongChainIntentSwitch.clone().text()).toBe(400)
		expect(await Bun.file(path).text()).toBe(configuredContents)
		expect(await Bun.file(mainnetProfilePath).text()).toBe(compatibleMainnetProfile)
		expect((await waitForJson(origin, '/api/state'))['paused']).toBe(false)
		expect(child.exitCode).toBeNull()
		await clearExecutorDeploymentIntent(mainnetIntentPath)
		const oppositeChain = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl }, network: 'mainnet', rpcQuorum: 2 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(oppositeChain.status).toBe(400)
		expect(await Bun.file(path).text()).toBe(configuredContents)
		const configuredEnvelope = await waitForJson(origin, '/api/configuration')
		const configuredDocument = configuredEnvelope['configuration']
		if (typeof configuredDocument !== 'object' || configuredDocument === null || Array.isArray(configuredDocument)) throw new Error('Configured document is missing')
		Reflect.deleteProperty(configuredDocument, 'network')
		Reflect.deleteProperty(configuredDocument, 'connectivity')
		const removal = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(configuredEnvelope),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(removal.status).toBe(400)
		expect(await Bun.file(path).text()).toBe(configuredContents)
		const mainnetProfileRequest = fetch(`${origin}/api/network-profile`, {
			body: JSON.stringify({ network: 'mainnet' }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		await Bun.sleep(5)
		const racingStrategyRequest = fetch(`${origin}/api/settings`, {
			body: JSON.stringify(sepoliaStrategy),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		const opposingProfileRequest = fetch(`${origin}/api/network-profile`, {
			body: JSON.stringify({ network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		const [mainnetProfileResult, racingStrategyResult, opposingProfileResult] = await Promise.allSettled([mainnetProfileRequest, racingStrategyRequest, opposingProfileRequest])
		if (mainnetProfileResult.status !== 'fulfilled') throw mainnetProfileResult.reason
		expect(mainnetProfileResult.value.status, await mainnetProfileResult.value.clone().text()).toBe(200)
		if (racingStrategyResult.status === 'fulfilled') expect(racingStrategyResult.value.status, await racingStrategyResult.value.clone().text()).toBe(400)
		else expect(racingStrategyResult.reason).toBeInstanceOf(Error)
		if (opposingProfileResult.status === 'fulfilled') expect(opposingProfileResult.value.status, await opposingProfileResult.value.clone().text()).toBe(400)
		else expect(opposingProfileResult.reason).toBeInstanceOf(Error)
		await waitForStateValue(origin, 'network', 'mainnet')
		let restoredProfile: Record<string, unknown> | undefined
		for (let attempt = 0; attempt < 700; attempt++) {
			restoredProfile = await waitForJson(origin, '/api/configuration')
			const restored = Reflect.get(restoredProfile, 'configuration')
			if (typeof restored === 'object' && restored !== null && Reflect.get(restored, 'network') === 'mainnet') break
			await Bun.sleep(25)
		}
		expect(restoredProfile).toMatchObject({
			configuration: { network: 'mainnet', networkConfigured: false, runtime: { historyFile: join(directory, 'history.jsonl'), positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl') }, strategy: { minimumProfitBps: initialMinimumProfitBps } },
		})
		expect(child.exitCode).toBeNull()
	})

	test('rejects RPC settings for a chain other than the selected profile', async () => {
		const directory = await temporaryDirectory()
		const dashboardPort = await unusedPort()
		const rpc = Bun.serve({
			async fetch(request) {
				const body = (await request.json()) as { id: unknown }
				return Response.json({ id: body.id, jsonrpc: '2.0', result: '0xaa36a7' })
			},
			hostname: '127.0.0.1',
			port: 0,
		})
		servers.push(rpc)
		if (rpc.port === undefined) throw new Error('Mock RPC did not expose a port')
		const configuration = (await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json()) as Record<string, unknown>
		const runtime = Reflect.get(configuration, 'runtime')
		if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) throw new Error('Example runtime is missing')
		Reflect.set(runtime, 'historyFile', join(directory, 'history.jsonl'))
		Reflect.set(runtime, 'positionFile', join(directory, 'positions.json'))
		Reflect.set(runtime, 'priceHistoryFile', join(directory, 'prices.jsonl'))
		Reflect.set(runtime, 'uiPort', dashboardPort)
		Reflect.set(configuration, 'submission', { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })
		const path = join(directory, 'operator.json')
		await writeFile(path, JSON.stringify(configuration), 'utf8')
		const child = Bun.spawn([executable, runSource], { env: { ...process.env, OPEN_ORACLE_ARBITRAGER_CONFIG: path }, stderr: 'pipe', stdout: 'pipe' })
		children.push(child)
		const origin = `http://127.0.0.1:${dashboardPort.toString()}`
		expect(await waitForJson(origin, '/api/state')).toMatchObject({ expectedChainId: 1, network: 'mainnet', networkConfigured: false })
		const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}/`
		const response = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl }, network: 'sepolia', rpcQuorum: 1 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Select the chain profile before saving its RPC settings' })
		expect(await loadOperatorSettings(path)).toMatchObject({ network: 'mainnet', networkConfigured: false })
		expect(await waitForJson(origin, '/api/state')).toMatchObject({ expectedChainId: 1, network: 'mainnet', networkConfigured: false })
	})

	test('keeps executor deployment guarded while a newly saved quorum applies live', async () => {
		const directory = await temporaryDirectory()
		const dashboardPort = await unusedPort()
		const rpc = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const requestValue = (await request.json()) as { id: unknown; method: string }
				const result = requestValue.method === 'eth_chainId' ? '0x1' : requestValue.method === 'eth_blockNumber' ? '0x1' : '0x'
				return Response.json({ id: requestValue.id, jsonrpc: '2.0', result })
			},
		})
		servers.push(rpc)
		if (rpc.port === undefined) throw new Error('Mock RPC did not expose a port')
		const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}/`
		const path = join(directory, 'operator.json')
		const configured = settings(rpcUrl, dashboardPort, `0x${'11'.repeat(32)}`)
		await saveOperatorSettings(path, {
			...configured,
			paused: true,
			rpcQuorum: 1,
			runtime: {
				...configured.runtime,
				historyFile: join(directory, 'history.jsonl'),
				positionFile: join(directory, 'positions.json'),
				priceHistoryFile: join(directory, 'prices.jsonl'),
			},
		})
		const child = Bun.spawn([executable, runSource], {
			env: { ...process.env, OPEN_ORACLE_ARBITRAGER_CONFIG: path },
			stderr: 'pipe',
			stdout: 'pipe',
		})
		children.push(child)
		const origin = `http://127.0.0.1:${dashboardPort.toString()}`
		await waitForJson(origin, '/api/state')
		const saveResponse = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl }, network: 'mainnet', rpcQuorum: 2 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(saveResponse.status, await saveResponse.clone().text()).toBe(200)
		expect((await loadOperatorSettings(path))?.rpcQuorum).toBe(2)
		const deploymentResponse = await fetch(`${origin}/api/executor-deployment`, {
			body: JSON.stringify({ salt: `0x${'00'.repeat(32)}` }),
			headers: { 'content-type': 'application/json', origin },
			method: 'POST',
		})
		expect(deploymentResponse.status).toBe(400)
		expect(await deploymentResponse.json()).toEqual({ error: 'Executor deployment could not be completed. Review chain state and protected bot logs.' })
	})

	test('serves and updates the complete redacted configuration while ignoring operational environment variables', async () => {
		const directory = await temporaryDirectory()
		const dashboardPort = await unusedPort()
		let rpcChainId = '0x1'
		const rpc = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const requestValue = (await request.json()) as { id: unknown; method: string }
				const result = requestValue.method === 'eth_chainId' ? rpcChainId : requestValue.method === 'eth_blockNumber' ? '0x1' : '0x'
				return Response.json({ id: requestValue.id, jsonrpc: '2.0', result })
			},
		})
		servers.push(rpc)
		if (rpc.port === undefined) throw new Error('Mock RPC did not expose a port')
		let quorumChainId = '0xaa36a7'
		const quorumRpc = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const requestValue = (await request.json()) as { id: unknown; method: string }
				return requestValue.method === 'eth_chainId' ? Response.json({ id: requestValue.id, jsonrpc: '2.0', result: quorumChainId }) : Response.json({ error: { code: -32602, message: 'invalid params' }, id: requestValue.id, jsonrpc: '2.0' })
			},
		})
		servers.push(quorumRpc)
		if (quorumRpc.port === undefined) throw new Error('Mock quorum RPC did not expose a port')
		const secondQuorumRpc = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const requestValue = (await request.json()) as { id: unknown; method: string }
				return requestValue.method === 'eth_chainId' ? Response.json({ id: requestValue.id, jsonrpc: '2.0', result: quorumChainId }) : Response.json({ error: { code: -32602, message: 'invalid params' }, id: requestValue.id, jsonrpc: '2.0' })
			},
		})
		servers.push(secondQuorumRpc)
		if (secondQuorumRpc.port === undefined) throw new Error('Second mock quorum RPC did not expose a port')
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
		const activeRpcUrl = `http://127.0.0.1:${rpc.port.toString()}/`
		const developmentQuorumResponse = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: [activeRpcUrl], readRpcUrl: activeRpcUrl }, network: 'mainnet', rpcQuorum: 1 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(developmentQuorumResponse.status, await developmentQuorumResponse.clone().text()).toBe(200)
		expect(await developmentQuorumResponse.json()).toEqual({ connectivity: { publicRpcUrls: [activeRpcUrl], readRpcUrl: activeRpcUrl }, network: 'mainnet', rpcQuorum: 1 })
		expect((await loadOperatorSettings(path))?.rpcQuorum).toBe(1)
		const restoreProductionQuorumResponse = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: [activeRpcUrl], readRpcUrl: activeRpcUrl }, network: 'mainnet', rpcQuorum: 2 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(restoreProductionQuorumResponse.status, await restoreProductionQuorumResponse.clone().text()).toBe(200)
		expect((await loadOperatorSettings(path))?.rpcQuorum).toBe(2)
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

		let currentEnvelope = await waitForJson(origin, '/api/configuration')
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

		const beforeWrongChainQuorum = await Bun.file(path).text()
		const wrongChainEnvelope = structuredClone(currentEnvelope)
		const wrongChainConfiguration = wrongChainEnvelope['configuration']
		if (typeof wrongChainConfiguration !== 'object' || wrongChainConfiguration === null || Array.isArray(wrongChainConfiguration)) throw new Error('Wrong-chain configuration document is missing')
		const wrongChainDeployment = Reflect.get(wrongChainConfiguration, 'deployment')
		if (typeof wrongChainDeployment !== 'object' || wrongChainDeployment === null || Array.isArray(wrongChainDeployment)) throw new Error('Wrong-chain deployment document is missing')
		Reflect.set(wrongChainDeployment, 'quorumRpcUrls', [`http://127.0.0.1:${quorumRpc.port.toString()}/`])
		const wrongChainResponse = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(wrongChainEnvelope),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(wrongChainResponse.status).toBe(400)
		expect(await wrongChainResponse.json()).toEqual({ error: expect.stringContaining('returned chain 11155111; expected chain 1') })
		expect(await Bun.file(path).text()).toBe(beforeWrongChainQuorum)
		expect((await waitForJson(origin, '/api/configuration'))['revision']).toBe(currentEnvelope['revision'])

		const wrongRelayEnvelope = structuredClone(currentEnvelope)
		const wrongRelayConfiguration = wrongRelayEnvelope['configuration']
		if (typeof wrongRelayConfiguration !== 'object' || wrongRelayConfiguration === null || Array.isArray(wrongRelayConfiguration)) throw new Error('Wrong-relay configuration document is missing')
		Reflect.set(wrongRelayConfiguration, 'submission', { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: [`http://127.0.0.1:${quorumRpc.port.toString()}/`] })
		const wrongRelayResponse = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(wrongRelayEnvelope),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(wrongRelayResponse.status).toBe(400)
		expect(await Bun.file(path).text()).toBe(beforeWrongChainQuorum)
		expect((await waitForJson(origin, '/api/configuration'))['revision']).toBe(currentEnvelope['revision'])

		const liveSwitchEnvelope = structuredClone(currentEnvelope)
		const liveSwitchConfiguration = liveSwitchEnvelope['configuration']
		if (typeof liveSwitchConfiguration !== 'object' || liveSwitchConfiguration === null || Array.isArray(liveSwitchConfiguration)) throw new Error('Live-switch configuration document is missing')
		Reflect.set(liveSwitchConfiguration, 'network', 'sepolia')
		const liveSwitchMarkets = Reflect.get(liveSwitchConfiguration, 'centralizedMarkets')
		const liveSwitchRuntime = Reflect.get(liveSwitchConfiguration, 'runtime')
		const liveSwitchDeployment = Reflect.get(liveSwitchConfiguration, 'deployment')
		if (
			typeof liveSwitchMarkets !== 'object' ||
			liveSwitchMarkets === null ||
			Array.isArray(liveSwitchMarkets) ||
			typeof liveSwitchRuntime !== 'object' ||
			liveSwitchRuntime === null ||
			Array.isArray(liveSwitchRuntime) ||
			typeof liveSwitchDeployment !== 'object' ||
			liveSwitchDeployment === null ||
			Array.isArray(liveSwitchDeployment)
		)
			throw new Error('Live-switch dependent configuration is missing')
		Reflect.set(liveSwitchMarkets, 'assetChainId', 11_155_111)
		Reflect.set(liveSwitchRuntime, 'execute', true)
		Reflect.set(liveSwitchDeployment, 'quorumRpcUrls', [`http://127.0.0.1:${quorumRpc.port.toString()}/`, `http://127.0.0.1:${secondQuorumRpc.port.toString()}/`])
		const liveSwitchResponse = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(liveSwitchEnvelope),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(liveSwitchResponse.status).toBe(400)
		expect(await liveSwitchResponse.json()).toEqual({ error: 'Switch chain profiles with the Chain selector before editing that profile' })
		expect(await Bun.file(path).text()).toBe(beforeWrongChainQuorum)

		const executeEnvelope = structuredClone(currentEnvelope)
		quorumChainId = '0x1'
		const executeConfiguration = executeEnvelope['configuration']
		if (typeof executeConfiguration !== 'object' || executeConfiguration === null || Array.isArray(executeConfiguration)) throw new Error('Execute configuration document is missing')
		const executeRuntime = Reflect.get(executeConfiguration, 'runtime')
		const executeDeployment = Reflect.get(executeConfiguration, 'deployment')
		if (typeof executeRuntime !== 'object' || executeRuntime === null || Array.isArray(executeRuntime) || typeof executeDeployment !== 'object' || executeDeployment === null || Array.isArray(executeDeployment)) throw new Error('Execute runtime or deployment configuration is missing')
		Reflect.set(executeRuntime, 'execute', true)
		Reflect.set(executeDeployment, 'quorumRpcUrls', [`http://127.0.0.1:${quorumRpc.port.toString()}/`, `http://127.0.0.1:${secondQuorumRpc.port.toString()}/`])
		const noSignerEnvelope = structuredClone(executeEnvelope)
		const noSignerConfiguration = noSignerEnvelope['configuration']
		if (typeof noSignerConfiguration !== 'object' || noSignerConfiguration === null || Array.isArray(noSignerConfiguration)) throw new Error('No-signer configuration document is missing')
		Reflect.deleteProperty(noSignerConfiguration, 'privateKey')
		const noSignerResponse = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(noSignerEnvelope),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(noSignerResponse.status).toBe(400)
		expect(await noSignerResponse.json()).toEqual({ error: 'Configuration could not be saved. Review the submitted values and protected bot logs.' })
		const executeResponse = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(executeEnvelope),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(executeResponse.status, await executeResponse.clone().text()).toBe(200)
		const executeSavedEnvelope = (await executeResponse.json()) as Record<string, unknown>
		const queuedReplacementSigner = await fetch(`${origin}/api/signer`, {
			body: JSON.stringify({ privateKey: `0x${'44'.repeat(32)}`, rememberSigner: false }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(queuedReplacementSigner.status, await queuedReplacementSigner.clone().text()).toBe(200)
		const queuedSignerClear = await fetch(`${origin}/api/signer`, {
			body: JSON.stringify({ privateKey: null, rememberSigner: false }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(queuedSignerClear.status).toBe(400)
		expect(await queuedSignerClear.json()).toEqual({ error: 'Signer settings could not be changed. Review the submitted action and protected bot logs.' })
		const beforePersistedLiveSwitch = await Bun.file(path).text()
		const persistedLiveSwitchResponse = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://sepolia.example/'], readRpcUrl: 'https://sepolia.example/' }, network: 'sepolia', rpcQuorum: 2 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(persistedLiveSwitchResponse.status).toBe(400)
		expect(await persistedLiveSwitchResponse.json()).toEqual({ error: 'Select the chain profile before saving its RPC settings' })
		expect(await Bun.file(path).text()).toBe(beforePersistedLiveSwitch)
		const executeSavedConfiguration = executeSavedEnvelope['configuration']
		if (typeof executeSavedConfiguration !== 'object' || executeSavedConfiguration === null || Array.isArray(executeSavedConfiguration)) throw new Error('Saved execute configuration document is missing')
		const savedExecuteRuntime = Reflect.get(executeSavedConfiguration, 'runtime')
		const savedExecuteDeployment = Reflect.get(executeSavedConfiguration, 'deployment')
		if (typeof savedExecuteRuntime !== 'object' || savedExecuteRuntime === null || Array.isArray(savedExecuteRuntime) || typeof savedExecuteDeployment !== 'object' || savedExecuteDeployment === null || Array.isArray(savedExecuteDeployment)) throw new Error('Saved execute runtime or deployment configuration is missing')
		Reflect.set(savedExecuteRuntime, 'execute', false)
		Reflect.set(savedExecuteDeployment, 'quorumRpcUrls', [])
		const restoreResponse = await fetch(`${origin}/api/configuration`, {
			body: JSON.stringify(executeSavedEnvelope),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(restoreResponse.status, await restoreResponse.clone().text()).toBe(200)
		currentEnvelope = (await restoreResponse.json()) as Record<string, unknown>

		const currentConfiguration = currentEnvelope['configuration']
		if (typeof currentConfiguration !== 'object' || currentConfiguration === null || Array.isArray(currentConfiguration)) throw new Error('Current configuration document is missing')
		const currentRuntime = Reflect.get(currentConfiguration, 'runtime')
		if (typeof currentRuntime !== 'object' || currentRuntime === null || Array.isArray(currentRuntime)) throw new Error('Current runtime configuration is missing')
		Reflect.set(currentRuntime, 'lookbackBlocks', '123')
		const currentRiskLimits = Reflect.get(currentRuntime, 'riskLimits')
		if (typeof currentRiskLimits !== 'object' || currentRiskLimits === null || Array.isArray(currentRiskLimits)) throw new Error('Current risk limits are missing')
		Reflect.set(currentRiskLimits, 'maxConcurrentPositions', 2)
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
		const queuedState = await waitForJson(origin, '/api/state')
		expect(queuedState['paused']).toBe(true)
		const queuedRisk = queuedState['risk']
		if (typeof queuedRisk !== 'object' || queuedRisk === null || Array.isArray(queuedRisk)) throw new Error('Queued state risk is missing')
		const queuedLimits = Reflect.get(queuedRisk, 'limits')
		if (typeof queuedLimits !== 'object' || queuedLimits === null || Array.isArray(queuedLimits)) throw new Error('Queued state risk limits are missing')
		expect(Reflect.get(queuedLimits, 'maxConcurrentPositions')).toBe(1)
		const appliedState = await waitForStateValue(origin, 'paused', false)
		const appliedRisk = appliedState['risk']
		if (typeof appliedRisk !== 'object' || appliedRisk === null || Array.isArray(appliedRisk)) throw new Error('Applied state risk is missing')
		const appliedLimits = Reflect.get(appliedRisk, 'limits')
		if (typeof appliedLimits !== 'object' || appliedLimits === null || Array.isArray(appliedLimits)) throw new Error('Applied state risk limits are missing')
		expect(Reflect.get(appliedLimits, 'maxConcurrentPositions')).toBe(2)
		expect((await waitForJson(origin, '/api/state'))['savedWallet']).toBe(privateKeyToAccount(replacementPrivateKey).address)

		const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}/`
		const relayUrl = `http://127.0.0.1:${quorumRpc.port.toString()}/`
		const privateSubmissionResponse = await fetch(`${origin}/api/submission`, {
			body: JSON.stringify({ minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: [relayUrl] }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(privateSubmissionResponse.status, await privateSubmissionResponse.clone().text()).toBe(200)
		rpcChainId = '0xaa36a7'
		const beforeRelayBlockedSwitch = await Bun.file(path).text()
		const relayBlockedSwitch = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl }, network: 'sepolia', rpcQuorum: 2 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(relayBlockedSwitch.status).toBe(400)
		expect(await Bun.file(path).text()).toBe(beforeRelayBlockedSwitch)
		const publicSubmissionResponse = await fetch(`${origin}/api/submission`, {
			body: JSON.stringify({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(publicSubmissionResponse.status, await publicSubmissionResponse.clone().text()).toBe(200)
		const beforeDryRunSwitch = await Bun.file(path).text()
		const networkResponse = await fetch(`${origin}/api/connectivity`, {
			body: JSON.stringify({ connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl }, network: 'sepolia', rpcQuorum: 2 }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(networkResponse.status).toBe(400)
		expect(await networkResponse.json()).toEqual({ error: 'Select the chain profile before saving its RPC settings' })
		expect(await Bun.file(path).text()).toBe(beforeDryRunSwitch)
		rpcChainId = '0x1'

		const rememberedBeforeBoundary = `0x${'55'.repeat(32)}` as Hex
		const rememberBeforeBoundaryResponse = await fetch(`${origin}/api/signer`, {
			body: JSON.stringify({ privateKey: rememberedBeforeBoundary, rememberSigner: true }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(rememberBeforeBoundaryResponse.status, await rememberBeforeBoundaryResponse.clone().text()).toBe(200)
		const forgetBeforeBoundaryResponse = await fetch(`${origin}/api/signer`, {
			body: JSON.stringify({ forgetSavedSigner: true }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(forgetBeforeBoundaryResponse.status, await forgetBeforeBoundaryResponse.clone().text()).toBe(200)
		expect((await loadOperatorSettings(path))?.privateKey).toBeUndefined()
		await waitForStateValue(origin, 'wallet', privateKeyToAccount(rememberedBeforeBoundary).address)

		const memoryOnlySigner = `0x${'66'.repeat(32)}` as Hex
		const memoryOnlySignerResponse = await fetch(`${origin}/api/signer`, {
			body: JSON.stringify({ privateKey: memoryOnlySigner, rememberSigner: false }),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
		expect(memoryOnlySignerResponse.status, await memoryOnlySignerResponse.clone().text()).toBe(200)
		expect((await loadOperatorSettings(path))?.privateKey).toBeUndefined()

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
