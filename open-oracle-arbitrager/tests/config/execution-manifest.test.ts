import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keccak256, type Hex } from '#ethereum'

const executable = join(import.meta.dir, '..', '..', 'bin', 'execution-manifest')
const directories: string[] = []
const servers: Bun.Server<unknown>[] = []

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true)
	await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

function rpc(runtimeCode: Hex) {
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const value = await request.json()
			if (typeof value !== 'object' || value === null || !('method' in value) || !('id' in value)) throw new Error('Invalid test RPC request')
			let result: Hex = '0x0'
			if (value['method'] === 'eth_chainId') result = '0xaa36a7'
			if (value['method'] === 'eth_getCode') result = runtimeCode
			return Response.json({ id: value['id'], jsonrpc: '2.0', result })
		},
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('Test RPC did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

async function run(arguments_: readonly string[]) {
	const child = Bun.spawn([executable, ...arguments_], { stderr: 'pipe', stdout: 'pipe' })
	const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
	return { exitCode, output: `${stdout}${stderr}` }
}

test('generates and verifies every execution-manifest bytecode identity', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-execution-manifest-'))
	directories.push(directory)
	const manifest = join(directory, 'manifest.json')
	const address = '0x0000000000000000000000000000000000000001'
	const code = '0x6001' as Hex
	const generate = await run(['generate', '--network=sepolia', `--rpc-url=${rpc(code)}`, `--contract=executor:${address}`, `--output=${manifest}`])
	expect(generate.exitCode, generate.output).toBe(0)
	const parsed = JSON.parse(await readFile(manifest, 'utf8')) as { contracts: { runtimeCodeHash: string }[] }
	expect(parsed.contracts[0]?.runtimeCodeHash).toBe(keccak256(code))
	const verify = await run(['verify', `--rpc-url=${rpc(code)}`, `--manifest=${manifest}`])
	expect(verify.exitCode, verify.output).toBe(0)
	const mismatch = await run(['verify', `--rpc-url=${rpc('0x6002')}`, `--manifest=${manifest}`])
	expect(mismatch.exitCode).toBe(1)
	expect(mismatch.output).toContain('runtime bytecode hash')
})
