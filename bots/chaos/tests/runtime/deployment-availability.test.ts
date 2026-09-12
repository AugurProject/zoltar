import { snapshotFixture } from '../operations/fixture.ts'
import { createChaosReadPool } from '../../src/runtime/canonical-scan.ts'
import { expect, test } from 'bun:test'
import example from '../../config/operator.example.json'
import { parseSettings } from '../../src/config/settings.ts'
import { checkDeploymentAvailability, recordUnavailableDeploymentScan, tradingDeploymentNotice } from '../../src/runtime/deployment-availability.ts'
import { resetRuntimeStateForProfile } from '../../src/state/operator-state.ts'
import { initialRuntimeState } from '../../src/state/initial-state.ts'

const settings = parseSettings(example)

test('disables stale operation plans without latching a safety pause or clearing recovery state', () => {
	const state = initialRuntimeState(false, undefined, 11155111)
	const obligations = state.obligations
	const workflows = state.workflows
	const pending = state.pendingTransactions
	state.error = 'old deployment error'
	recordUnavailableDeploymentScan(state, 'Waiting for deployments', { blockNumber: 100n, checkedAt: '2026-09-08T00:00:00.000Z' })
	expect(state.lastDeploymentCheckedBlock).toBe(100n)
	expect(state.lastScanAt).toBeUndefined()
	expect(state.lastScannedBlock).toBeUndefined()
	expect(state.error).toBeUndefined()
	expect(state.safetyPaused).toBe(false)
	expect(state.deploymentNotice).toBe('Waiting for deployments')
	expect(state.evaluations.length).toBeGreaterThan(0)
	expect(state.evaluations.every(evaluation => !evaluation.eligibility.eligible && evaluation.plan === undefined)).toBe(true)
	expect(state.obligations).toBe(obligations)
	expect(state.workflows).toBe(workflows)
	expect(state.pendingTransactions).toBe(pending)
	resetRuntimeStateForProfile(state, 'new-profile', true, undefined)
	expect(state.lastDeploymentCheckedBlock).toBeUndefined()
	expect(state.lastDeploymentCheckAt).toBeUndefined()
	expect(state.deploymentNotice).toBeUndefined()
})

test('rechecks canonical addresses at the agreed block and recovers when code appears', async () => {
	let deployed = false
	let missingTradingOnly = false
	let failCode = false
	const requested: unknown[][] = []
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const body: unknown = await request.json()
			if (typeof body !== 'object' || body === null) throw new Error('Expected RPC request')
			const method = Reflect.get(body, 'method')
			const params = Reflect.get(body, 'params')
			if (typeof method !== 'string' || !Array.isArray(params)) throw new Error('Invalid RPC request')
			let result: unknown
			if (method === 'eth_chainId') result = '0xaa36a7'
			else if (method === 'eth_blockNumber') result = '0x64'
			else if (method === 'eth_getBlockByNumber') result = { number: '0x64', hash: `0x${'11'.repeat(32)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, baseFeePerGas: '0x1', transactions: [], uncles: [], gasLimit: '0x100000', gasUsed: '0x0' }
			else if (method === 'eth_getCode') {
				requested.push(params)
				if (failCode) return Response.json({ id: Reflect.get(body, 'id'), jsonrpc: '2.0', error: { code: -32000, message: 'RPC unavailable' } })
				const trading = [settings.deployment.tradingFactory.toLowerCase(), settings.deployment.tradingRouter.toLowerCase()].includes(String(params[0]).toLowerCase())
				result = deployed || (missingTradingOnly && !trading) ? '0x01' : '0x'
			} else throw new Error(`Unexpected method ${method}`)
			return Response.json({ id: Reflect.get(body, 'id'), jsonrpc: '2.0', result })
		},
	})
	try {
		const url = `http://127.0.0.1:${server.port}`
		const configured = parseSettings({ ...example, networkConfigured: true, connectivity: { readRpcUrl: url, publicRpcUrls: [url], quorumRpcUrls: [], rpcQuorum: 1 } })
		configured.strategy.initializeGenesisUniverse = false
		const pool = createChaosReadPool(configured)
		expect((await checkDeploymentAvailability(configured, pool)).notice).toContain('Waiting for deployments on chain 11155111 at block 100: Zoltar')
		expect(requested.length).toBe(8)
		expect(requested.every(params => params[1] === '0x64')).toBeTrue()
		expect(requested.map(params => String(params[0]).toLowerCase())).toContain(configured.deployment.zoltar.toLowerCase())
		missingTradingOnly = true
		const partial = await checkDeploymentAvailability(configured, pool)
		expect(partial.notice).toContain('Trading factory, Trading router')
		expect(partial.blocking).toBe(false)
		configured.strategy.initializeGenesisUniverse = true
		expect((await checkDeploymentAvailability(configured, pool)).blocking).toBe(false)
		configured.strategy.initializeGenesisUniverse = false
		deployed = true
		expect((await checkDeploymentAvailability(configured, pool)).notice).toBeUndefined()
		failCode = true
		await expect(checkDeploymentAvailability(configured, pool)).rejects.toThrow()
	} finally {
		server.stop(true)
	}
})

test('keeps partial trading availability visible without claiming all operations are unavailable', () => {
	const snapshot = snapshotFixture()
	snapshot.tradingDeployment = { factory: true, router: false }
	const notice = tradingDeploymentNotice(snapshot)
	expect(notice).toContain('at block 100: Trading router')
	expect(notice).toContain('other eligible operations can continue')
	expect(notice).not.toContain('Chaos operations are unavailable')
	snapshot.tradingDeployment.router = true
	expect(tradingDeploymentNotice(snapshot)).toBeUndefined()
})
