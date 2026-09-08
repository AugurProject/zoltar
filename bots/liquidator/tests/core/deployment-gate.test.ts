import { recordSystemDeploymentCheck } from '../../src/core/deployment-observation.ts'
import { initialRuntimeState, operatorSnapshot } from '../../src/state/operator-state.ts'
import { blockStatusText, scanStatusText } from '../../src/dashboard/block-status.ts'
import { expect, test } from 'bun:test'
import { createSystemDeploymentGate, systemDeploymentStatus } from '#core/deployment-gate'

const block = { number: 42n, timestamp: 123n }
const zoltar = '0x0000000000000000000000000000000000000001' as const
const securityPoolFactory = '0x0000000000000000000000000000000000000002' as const
const weth = '0x0000000000000000000000000000000000000003' as const

test('stops deployment checks at the first contract without runtime bytecode', async () => {
	const queried: string[] = []
	const status = await systemDeploymentStatus(
		{
			getBlock: async () => block,
			getCode: async ({ address }) => {
				queried.push(address)
				return undefined
			},
		},
		{ securityPoolFactory, weth, zoltar },
	)

	expect(status).toEqual({ address: zoltar, deployed: false, name: 'Zoltar', block })
	expect(queried).toEqual([zoltar])
})

test('requires runtime bytecode for every core system contract', async () => {
	const queried: string[] = []
	const status = await systemDeploymentStatus(
		{
			getBlock: async () => block,
			getCode: async ({ address }) => {
				queried.push(address)
				return address === securityPoolFactory ? '0x' : '0x6000'
			},
		},
		{ securityPoolFactory, weth, zoltar },
	)

	expect(status).toEqual({ address: securityPoolFactory, deployed: false, name: 'security-pool factory', block })
	expect(queried).toEqual([zoltar, securityPoolFactory])
})

test('reports the system deployed only after all core contracts have runtime bytecode', async () => {
	const queried: string[] = []
	const status = await systemDeploymentStatus(
		{
			getBlock: async () => block,
			getCode: async ({ address }) => {
				queried.push(address)
				return '0x6000'
			},
		},
		{ securityPoolFactory, weth, zoltar },
	)

	expect(status).toEqual({ deployed: true })
	expect(queried).toEqual([zoltar, securityPoolFactory, weth])
})

test('caches a verified deployment across scan cycles and resets for another chain', async () => {
	const queried: string[] = []
	const client = {
		getBlock: async () => block,
		getCode: async ({ address }: { address: string }) => {
			queried.push(address)
			return '0x6000' as const
		},
	}
	const checkDeployment = createSystemDeploymentGate()

	await expect(checkDeployment(client, 1, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ deployed: true })
	await expect(checkDeployment(client, 1, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ deployed: true })
	expect(queried).toHaveLength(3)

	await expect(checkDeployment(client, 2, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ deployed: true })
	expect(queried).toHaveLength(6)
})

test('does not reuse readiness after an intervening undeployed identity', async () => {
	const queried: string[] = []
	let deployed = true
	const client = {
		getBlock: async () => block,
		getCode: async ({ address }: { address: string }) => {
			queried.push(address)
			return deployed ? ('0x6000' as const) : undefined
		},
	}
	const checkDeployment = createSystemDeploymentGate()

	await expect(checkDeployment(client, 1, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ deployed: true })
	deployed = false
	await expect(checkDeployment(client, 2, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ address: zoltar, deployed: false, name: 'Zoltar', block })
	deployed = true
	await expect(checkDeployment(client, 1, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ deployed: true })
	expect(queried).toHaveLength(7)
})

test('pins missing-deployment reads to the reported observed block', async () => {
	const reads: unknown[] = []
	const status = await systemDeploymentStatus(
		{
			getBlock: async () => ({ number: 100n, timestamp: 123n }),
			getCode: async parameters => {
				reads.push(parameters)
				return '0x'
			},
		},
		{ securityPoolFactory, weth, zoltar },
	)
	expect(reads).toEqual([{ address: zoltar, blockNumber: 100n }])
	expect(status).toMatchObject({ deployed: false, block: { number: 100n, timestamp: 123n } })
})

test('publishes the checked block without claiming a completed or executable scan', () => {
	const state = initialRuntimeState(false, undefined, 11155111)
	state.error = 'Previous RPC failure'
	const first = recordSystemDeploymentCheck(state, { deployed: false, address: zoltar, name: 'Zoltar', block: { number: 100n, timestamp: 123n } }, undefined)
	recordSystemDeploymentCheck(state, { deployed: false, address: zoltar, name: 'Zoltar', block: { number: 101n, timestamp: 135n } }, first)
	const snapshot = operatorSnapshot(state, false)
	expect(snapshot.error).toBeUndefined()
	expect(snapshot.lastScannedBlock).toBeUndefined()
	expect(snapshot.lastScanAt).toBeUndefined()
	expect(snapshot.operatorCapable).toBeFalse()
	expect(snapshot.activities).toHaveLength(1)
	expect(snapshot).toMatchObject({ deploymentCheckedBlock: '101', deploymentCheckedTimestamp: '135', deploymentMissingName: 'Zoltar' })
	expect(blockStatusText(snapshot, 140000)).toBe('Block 101 · seen 5s ago')
	expect(scanStatusText(snapshot)).toBe('Deployments checked at block 101')
	recordSystemDeploymentCheck(state, { deployed: true }, first)
	expect(state.deploymentCheckedBlock).toBeUndefined()
	expect(state.deploymentMissingName).toBeUndefined()
	expect(blockStatusText(operatorSnapshot(state, false))).toBe('Block — · waiting for first observation')
})
