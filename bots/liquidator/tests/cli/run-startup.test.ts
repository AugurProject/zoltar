import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directories: string[] = []
const servers: Bun.Server<unknown>[] = []
const children: Bun.Subprocess[] = []

async function waitForJson(origin: string, path: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
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
	reservation.stop(true)
	if (uiPort === undefined) throw new Error('Test dashboard reservation did not expose a port')
	const configuration = (await Bun.file(join(import.meta.dir, '..', '..', 'config', 'operator.example.json')).json()) as Record<string, unknown>
	const runtime = Reflect.get(configuration, 'runtime')
	if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) throw new Error('Example runtime is missing')
	Reflect.set(runtime, 'stateFile', join(directory, 'state.json'))
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
	expect(initial['network']).toBeUndefined()
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(true)
	const rpcUrl = `http://127.0.0.1:${rpc.port.toString()}/`
	const response = await fetch(`${origin}/api/network-connectivity`, {
		body: JSON.stringify({ connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }, network: 'sepolia' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(response.status, await response.clone().text()).toBe(200)
	expect(await response.json()).toMatchObject({ network: { chainId: 11_155_111, name: 'sepolia' } })
	expect((await waitForJson(origin, '/api/state'))['paused']).toBe(true)
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
	reservation.stop(true)
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
	reservation.stop(true)
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
