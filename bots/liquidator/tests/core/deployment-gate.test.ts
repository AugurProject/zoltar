import { expect, test } from 'bun:test'
import { createSystemDeploymentGate, systemDeploymentStatus } from '#core/deployment-gate'

const zoltar = '0x0000000000000000000000000000000000000001' as const
const securityPoolFactory = '0x0000000000000000000000000000000000000002' as const
const weth = '0x0000000000000000000000000000000000000003' as const

test('stops deployment checks at the first contract without runtime bytecode', async () => {
	const queried: string[] = []
	const status = await systemDeploymentStatus(
		{
			getCode: async ({ address }) => {
				queried.push(address)
				return undefined
			},
		},
		{ securityPoolFactory, weth, zoltar },
	)

	expect(status).toEqual({ address: zoltar, deployed: false, name: 'Zoltar' })
	expect(queried).toEqual([zoltar])
})

test('requires runtime bytecode for every core system contract', async () => {
	const queried: string[] = []
	const status = await systemDeploymentStatus(
		{
			getCode: async ({ address }) => {
				queried.push(address)
				return address === securityPoolFactory ? '0x' : '0x6000'
			},
		},
		{ securityPoolFactory, weth, zoltar },
	)

	expect(status).toEqual({ address: securityPoolFactory, deployed: false, name: 'security-pool factory' })
	expect(queried).toEqual([zoltar, securityPoolFactory])
})

test('reports the system deployed only after all core contracts have runtime bytecode', async () => {
	const queried: string[] = []
	const status = await systemDeploymentStatus(
		{
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
		getCode: async ({ address }: { address: string }) => {
			queried.push(address)
			return deployed ? ('0x6000' as const) : undefined
		},
	}
	const checkDeployment = createSystemDeploymentGate()

	await expect(checkDeployment(client, 1, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ deployed: true })
	deployed = false
	await expect(checkDeployment(client, 2, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ address: zoltar, deployed: false, name: 'Zoltar' })
	deployed = true
	await expect(checkDeployment(client, 1, { securityPoolFactory, weth, zoltar })).resolves.toEqual({ deployed: true })
	expect(queried).toHaveLength(7)
})
