import { isErrorCode } from '../src/infrastructure/error-code.ts'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { privateKeyToAccount } from '../src/ethereum.ts'
import { acquireExecutionSignerLock, type ExclusiveProcessLock } from '../src/execution/process-lock.ts'

const processes: ReturnType<typeof Bun.spawn>[] = []
const locks: ExclusiveProcessLock[] = []
const directories: string[] = []
const servers: Bun.Server<unknown>[] = []
afterEach(async () => {
	for (const child of processes.splice(0)) {
		child.kill('SIGKILL')
		await child.exited
	}
	for (const lock of locks.splice(0)) await lock.release()
	for (const server of servers.splice(0)) await server.stop(true)
	for (const directory of directories.splice(0)) await rm(directory, { force: true, recursive: true })
})

for (const [name, variable] of [
	['chaos', 'ZOLTAR_CHAOS_CONFIG'],
	['liquidator', 'ZOLTAR_LIQUIDATOR_CONFIG'],
	['open-oracle-arbitrager', 'OPEN_ORACLE_ARBITRAGER_CONFIG'],
]) {
	test(`${name} opens its dashboard paused on signer contention and saves disabled execution`, async () => {
		if (name === undefined || variable === undefined) throw new Error('Missing bot fixture')
		const directory = await mkdtemp(join(tmpdir(), 'bot-dashboard-conflict-'))
		directories.push(directory)
		const privateKey = `0x${'73'.repeat(32)}` as const
		const root = resolve(import.meta.dir, '../..', name)
		const example = await Bun.file(join(root, 'config/operator.example.json')).json()
		let submissions = 0
		const urls = Array.from({ length: 3 }, () => {
			const server = Bun.serve({
				hostname: '127.0.0.1',
				port: 0,
				fetch: async request => {
					const body = await request.json()
					if (body.method === 'eth_sendRawTransaction') submissions += 1
					if (body.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: body.id, result: '0xaa36a7' })
					if (body.method === 'eth_blockNumber') return Response.json({ jsonrpc: '2.0', id: body.id, result: '0x64' })
					return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Fixture RPC unavailable' } })
				},
			})
			servers.push(server)
			return server.url.href
		})
		const reserved = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
		const port = reserved.port
		await reserved.stop(true)
		const runtime = { ...example.runtime, execute: true, uiPort: port }
		if (name === 'open-oracle-arbitrager') {
			runtime.historyFile = join(directory, 'history.jsonl')
			runtime.positionFile = join(directory, 'positions.json')
			runtime.priceHistoryFile = join(directory, 'prices.jsonl')
		} else runtime.stateFile = join(directory, 'state.json')
		const configuration = {
			...example,
			networkConfigured: true,
			paused: false,
			privateKey,
			runtime,
			connectivity: { readRpcUrl: urls[0], publicRpcUrls: [urls[0]], ...(name === 'open-oracle-arbitrager' ? {} : { quorumRpcUrls: urls.slice(1), rpcQuorum: 2 }) },
			network: name === 'open-oracle-arbitrager' ? 'sepolia' : { name: 'sepolia', chainId: 11155111, explorerUrl: 'https://sepolia.etherscan.io', ...(name === 'chaos' ? { maximumBlockIntervalSeconds: 60 } : {}) },
			...(name === 'open-oracle-arbitrager' ? { deployment: { ...example.deployment, quorumRpcUrls: urls.slice(1) } } : {}),
		}
		const path = join(directory, 'operator.json')
		await writeFile(path, JSON.stringify(configuration), { mode: 0o600 })
		locks.push(await acquireExecutionSignerLock(11155111, privateKeyToAccount(privateKey).address, 'liquidator', join(directory, 'locks')))
		if (name === 'chaos') {
			for (const arguments_ of [
				['src/cli/deployment-upgrade.ts', 'prepare'],
				['src/cli/doctor.ts', '--if-live-capable'],
			]) {
				const preflight = Bun.spawn([process.execPath, ...arguments_], { cwd: root, env: { ...process.env, [variable]: path, ZOLTAR_BOT_SIGNER_LOCK_ROOT: join(directory, 'locks') }, stderr: 'pipe', stdout: 'pipe' })
				processes.push(preflight)
				const [output, errors, exitCode] = await Promise.all([new Response(preflight.stdout).text(), new Response(preflight.stderr).text(), preflight.exited])
				expect(exitCode).toBe(0)
				expect(output + errors).toContain('Signer is already in use by liquidator')
			}
		}
		const child = Bun.spawn([process.execPath, 'src/cli/run.ts'], { cwd: root, env: { ...process.env, [variable]: path, ZOLTAR_BOT_SIGNER_LOCK_ROOT: join(directory, 'locks') }, stderr: 'pipe', stdout: 'pipe' })
		processes.push(child)
		const url = `http://127.0.0.1:${port}/`
		let snapshot: Record<string, unknown> | undefined
		for (let attempt = 0; attempt < 100; attempt += 1) {
			if (child.exitCode !== null) throw new Error(await new Response(child.stderr).text())
			try {
				const response = await fetch(`${url}api/state`)
				if (response.ok) {
					snapshot = await response.json()
					break
				}
			} catch (error) {
				if (!isErrorCode(error, 'ConnectionRefused', 'ECONNREFUSED')) throw error
				/* Dashboard has not bound its port yet. */
			}
			await Bun.sleep(50)
		}
		expect(snapshot).toBeDefined()
		expect(snapshot?.['execute']).toBe(false)
		expect(snapshot?.['paused']).toBe(true)
		expect(JSON.stringify(snapshot)).toContain('Signer is already in use by liquidator')
		expect(JSON.stringify(snapshot)).not.toContain(join(directory, 'locks'))
		expect((await fetch(url)).status).toBe(200)
		const saved = JSON.parse(await readFile(path, 'utf8'))
		expect(saved.runtime.execute).toBe(false)
		expect(saved.paused).toBe(true)
		expect(submissions).toBe(0)
	}, 15_000)
}
