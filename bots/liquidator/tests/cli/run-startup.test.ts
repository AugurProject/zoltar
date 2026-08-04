import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directories: string[] = []
const servers: Bun.Server<unknown>[] = []
const children: Bun.Subprocess[] = []

afterEach(async () => {
	for (const child of children.splice(0)) {
		child.kill()
		await child.exited
	}
	for (const server of servers.splice(0)) server.stop(true)
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
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
