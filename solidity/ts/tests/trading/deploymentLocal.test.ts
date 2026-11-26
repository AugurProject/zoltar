import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useSecurityPoolFixture } from '../statoblast/securityPoolFixture'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { requireCoreFactoryRuntime } from '../../trading/deploy/core-runtime'
import { encodeAbiParameters } from '@zoltar/core-shared/evm/ethereum'

const root = path.resolve(import.meta.dir, '../../../..')

describe('local Trading deployment preflight and output', () => {
	const fixture = useSecurityPoolFixture()
	test('#1718 authenticates factory bytecode and protocol generation before deployment', async () => {
		const reader = fixture.owner()
		const factory = getInfraContractAddresses().securityPoolFactory
		const code = await reader.getCode({ address: factory })
		const manifest = { zoltar: getZoltarAddress() }
		await expect(
			requireCoreFactoryRuntime(manifest, '0x60006000', factory, async () => {
				throw new Error('Must reject unrelated runtime before calling it')
			}),
		).rejects.toThrow('runtime code')
		const rpc = async (_method: string, params: readonly unknown[]) => {
			const call = params[0]
			if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string' || !call.data.startsWith('0x')) throw new Error('Expected call data')
			// Use the actual node to verify the immutable generation bindings.
			return await fixture.base.mockWindow.request({ method: 'eth_call', params })
		}
		await expect(requireCoreFactoryRuntime(manifest, code, factory, rpc)).resolves.toBeUndefined()
		await expect(requireCoreFactoryRuntime({ zoltar: '0x0000000000000000000000000000000000000001' }, code, factory, rpc)).rejects.toThrow('generation')
		await expect(requireCoreFactoryRuntime(manifest, code, factory, async () => encodeAbiParameters([{ type: 'address' }], [getZoltarAddress()]))).rejects.toThrow('generation')
	})
	test.each(['credentials', 'unrelated runtime'])('#1719/#1718 deployment protects %s', async mode => {
		const directory = await mkdtemp(path.join(tmpdir(), 'trading-deploy-'))
		const output = path.join(root, 'solidity/deployments/trading/local.json')
		const previous = await readFile(output, 'utf8').catch(() => undefined)
		const factory = getInfraContractAddresses().securityPoolFactory
		const owner = fixture.owner().account.address
		const manifest = path.join(directory, 'core.json')
		await writeFile(manifest, JSON.stringify({ chainId: 1, securityPoolFactory: factory, zoltar: getZoltarAddress() }))
		let deployments = 0
		const unrelatedRuntime = mode === 'unrelated runtime'
		const server = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const body: unknown = await request.json()
				if (typeof body !== 'object' || body === null || !('method' in body) || !('id' in body) || !('params' in body) || !Array.isArray(body.params)) throw new Error('Invalid RPC request')
				let result: unknown
				if (body.method === 'eth_getCode' && unrelatedRuntime) result = '0x60006000'
				else if (body.method === 'eth_chainId') result = '0x1'
				else if (body.method === 'eth_accounts') result = [owner]
				else if (body.method === 'eth_sendTransaction') {
					deployments += 1
					result = `0x${deployments.toString(16).padStart(64, '0')}`
				} else if (body.method === 'eth_getTransactionReceipt') result = { status: '0x1', contractAddress: `0x${deployments.toString(16).padStart(40, '0')}`, blockNumber: '0x1' }
				else if (typeof body.method === 'string') result = await fixture.base.mockWindow.request({ method: body.method, params: body.params })
				else throw new Error('Invalid RPC method')
				return Response.json({ jsonrpc: '2.0', id: body.id, result })
			},
		})
		try {
			const credential = 'dummy-private-rpc-credential-1719'
			const child = Bun.spawn(['bun', path.join(root, 'solidity/ts/trading/deploy/deploy-local.mts')], { cwd: root, env: { ...process.env, TRADING_RPC_URL: new URL(`/private/${credential}?key=${credential}`, server.url).href, ZOLTAR_DEPLOYMENT_MANIFEST: manifest }, stdout: 'pipe', stderr: 'pipe' })
			const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
			if (unrelatedRuntime) {
				expect(exit).not.toBe(0)
				expect(deployments).toBe(0)
			} else {
				expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
				expect(deployments).toBe(2)
				expect(stdout).not.toContain(credential)
				expect(await readFile(output, 'utf8')).not.toContain(credential)
			}
		} finally {
			await server.stop(true)
			if (previous === undefined) await rm(output, { force: true })
			else {
				await mkdir(path.dirname(output), { recursive: true })
				await writeFile(output, previous)
			}
			await rm(directory, { recursive: true, force: true })
		}
	})
})
