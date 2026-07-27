import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateKeyToAccount, type Hex } from '@zoltar/shared/ethereum'
import { loadOperatorSettings, saveOperatorSettings } from './settings-store.js'

const executable = join(import.meta.dir, 'run')
const oracle = '--open-oracle=0x0000000000000000000000000000000000000000'
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

async function invalidStartup(argument: string) {
	const directory = await temporaryDirectory()
	const environment = { ...process.env }
	delete environment['PRIVATE_KEY']
	const child = Bun.spawn([executable, oracle, '--once', `--settings-file=${join(directory, 'settings.json')}`, argument], {
		env: environment,
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

async function waitForSnapshot(origin: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(`${origin}/api/state`)
			if (response.ok) return (await response.json()) as Record<string, unknown>
		} catch (error) {
			void error
		}
		await Bun.sleep(20)
	}
	throw new Error('Dashboard did not become ready')
}

function dashboardPut(origin: string, path: string, value: unknown) {
	const body = JSON.stringify(value)
	if (body === undefined) throw new Error('Dashboard test request must be JSON serializable')
	return fetch(`${origin}${path}`, {
		body,
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
}

describe('startup configuration', () => {
	test.each([
		['--minimum-remaining-blocks=0', 'Minimum remaining blocks must be from 1 to 1000'],
		['--minimum-remaining-seconds=86401', 'Minimum remaining seconds must be from 1 to 86400'],
		['--minimum-profit-bps=100001', 'Minimum return must be from 0 to 100000'],
		['--max-spot-twap-ticks=-1', 'Maximum spot/TWAP ticks must be a non-negative integer'],
		['--poll-ms=999', 'Poll interval must be an integer from 1000 to 3600000'],
		['--lookback-blocks=-1', 'lookback-blocks must be a non-negative integer'],
		['--submission-mode=unknown', 'Submission mode must be public or private'],
		['--relay-url=http://relay.example', 'Relay URL must use HTTPS'],
		['--execute', '--execute requires --executor-address'],
	])('rejects %s before starting RPC activity', async (argument, message) => {
		const result = await invalidStartup(argument)
		expect(result.exitCode).toBe(1)
		expect(result.output).toContain(message)
		expect(result.output).not.toContain('mode=')
	})

	test('defaults to private bundle submission', async () => {
		const directory = await temporaryDirectory()
		const dashboardPort = unusedPort()
		const rpc = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const value = (await request.json()) as { id: unknown; method: string }
				const result = value.method === 'eth_chainId' || value.method === 'eth_blockNumber' ? '0x1' : '0x'
				return Response.json({ id: value.id, jsonrpc: '2.0', result })
			},
		})
		servers.push(rpc)
		if (rpc.port === undefined) throw new Error('Mock RPC did not expose a port')
		const environment = { ...process.env }
		delete environment['PRIVATE_KEY']
		const child = Bun.spawn([executable, oracle, '--ui', `--ui-port=${dashboardPort.toString()}`, '--lookback-blocks=0', `--rpc-url=http://127.0.0.1:${rpc.port.toString()}`, `--settings-file=${join(directory, 'settings.json')}`], {
			env: environment,
			stderr: 'pipe',
			stdout: 'pipe',
		})
		children.push(child)
		const snapshot = await waitForSnapshot(`http://127.0.0.1:${dashboardPort.toString()}`)
		expect(snapshot).toMatchObject({ submission: { mode: 'private', relayUrls: ['https://relay.flashbots.net/'] } })
	})

	test('restores saved settings, preserves an overridden restart key, serializes mutations, and rejects failed writes', async () => {
		const directory = await temporaryDirectory()
		const settingsPath = join(directory, 'settings.json')
		const savedPrivateKey = `0x${'11'.repeat(32)}` as Hex
		const environmentPrivateKey = `0x${'22'.repeat(32)}` as Hex
		const rpc = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const value = (await request.json()) as { id: unknown }
				return Response.json({ id: value.id, jsonrpc: '2.0', result: '0x1' })
			},
		})
		servers.push(rpc)
		if (rpc.port === undefined) throw new Error('Mock RPC did not expose a port')
		const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}`
		await saveOperatorSettings(settingsPath, 'mainnet', {
			connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl },
			paused: true,
			privateKey: savedPrivateKey,
			strategy: {
				maxSpotTwapTicks: 77n,
				minimumProfitBps: 222n,
				minimumProfitWeth: 25n * 10n ** 15n,
				minimumRemainingBlocks: 4n,
				minimumRemainingSeconds: 48n,
				pollMilliseconds: 15_000,
				twapSeconds: 2_400,
			},
			submission: { mode: 'public', relayUrls: ['https://relay.flashbots.net/'] },
		})
		const dashboardPort = unusedPort()
		const environment = { ...process.env, PRIVATE_KEY: environmentPrivateKey }
		const child = Bun.spawn([executable, oracle, '--ui', `--ui-port=${dashboardPort.toString()}`, '--lookback-blocks=0', `--settings-file=${settingsPath}`], {
			env: environment,
			stderr: 'pipe',
			stdout: 'pipe',
		})
		children.push(child)
		const origin = `http://127.0.0.1:${dashboardPort.toString()}`
		const initial = await waitForSnapshot(origin)
		expect(initial).toMatchObject({
			paused: true,
			savedWallet: privateKeyToAccount(savedPrivateKey).address,
			settings: { maxSpotTwapTicks: '77', minimumProfitBps: '222', pollMilliseconds: 15_000 },
			wallet: privateKeyToAccount(environmentPrivateKey).address,
		})
		const [strategyResponse, submissionResponse] = await Promise.all([
			dashboardPut(origin, '/api/settings', {
				maxSpotTwapTicks: '88',
				minimumProfitBps: '333',
				minimumProfitWeth: '0.03',
				minimumRemainingBlocks: '5',
				minimumRemainingSeconds: '60',
				pollMilliseconds: 20_000,
				twapSeconds: 3_000,
			}),
			dashboardPut(origin, '/api/submission', { mode: 'public', relayUrls: ['https://relay.example'] }),
		])
		expect(strategyResponse.status).toBe(200)
		expect(submissionResponse.status).toBe(200)
		const concurrentSave = await loadOperatorSettings(settingsPath, 'mainnet')
		expect(concurrentSave?.strategy.minimumProfitBps).toBe(333n)
		expect(concurrentSave?.submission.relayUrls).toEqual(['https://relay.example/'])
		expect(concurrentSave?.privateKey).toBe(savedPrivateKey)
		const memoryOnlyPrivateKey = `0x${'33'.repeat(32)}` as Hex
		const memoryOnlyResponse = await dashboardPut(origin, '/api/signer', { privateKey: memoryOnlyPrivateKey, rememberSigner: false })
		expect(memoryOnlyResponse.status).toBe(200)
		const queued = await waitForSnapshot(origin)
		expect(queued).toMatchObject({
			queuedWallet: privateKeyToAccount(memoryOnlyPrivateKey).address,
			savedWallet: privateKeyToAccount(savedPrivateKey).address,
			wallet: privateKeyToAccount(environmentPrivateKey).address,
		})
		expect((await loadOperatorSettings(settingsPath, 'mainnet'))?.privateKey).toBe(savedPrivateKey)
		child.kill()
		await child.exited
		children.splice(children.indexOf(child), 1)
		const restartDashboardPort = unusedPort()
		const restartEnvironment = { ...process.env }
		delete restartEnvironment['PRIVATE_KEY']
		const restart = Bun.spawn([executable, oracle, '--ui', `--ui-port=${restartDashboardPort.toString()}`, '--lookback-blocks=0', `--settings-file=${settingsPath}`], {
			env: restartEnvironment,
			stderr: 'pipe',
			stdout: 'pipe',
		})
		children.push(restart)
		const restartOrigin = `http://127.0.0.1:${restartDashboardPort.toString()}`
		const restarted = await waitForSnapshot(restartOrigin)
		expect(restarted).toMatchObject({
			savedWallet: privateKeyToAccount(savedPrivateKey).address,
			wallet: privateKeyToAccount(savedPrivateKey).address,
		})
		const forgetResponse = await dashboardPut(restartOrigin, '/api/signer', { forgetSavedSigner: true })
		expect(forgetResponse.status).toBe(200)
		const forgotten = await waitForSnapshot(restartOrigin)
		expect(forgotten['wallet']).toBe(privateKeyToAccount(savedPrivateKey).address)
		expect(forgotten['savedWallet']).toBeUndefined()
		expect((await loadOperatorSettings(settingsPath, 'mainnet'))?.privateKey).toBeUndefined()
		await rm(settingsPath)
		await mkdir(settingsPath)
		const failedUpdate = await dashboardPut(restartOrigin, '/api/settings', {
			maxSpotTwapTicks: '99',
			minimumProfitBps: '444',
			minimumProfitWeth: '0.04',
			minimumRemainingBlocks: '6',
			minimumRemainingSeconds: '72',
			pollMilliseconds: 25_000,
			twapSeconds: 3_600,
		})
		expect(failedUpdate.status).toBe(400)
		const afterFailure = await waitForSnapshot(restartOrigin)
		expect(afterFailure['settings']).toMatchObject({ maxSpotTwapTicks: '88', minimumProfitBps: '333' })
	})
})
