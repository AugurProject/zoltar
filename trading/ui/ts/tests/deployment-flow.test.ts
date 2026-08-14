import { describe, expect, test } from 'bun:test'
import { getAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE, deployTradingStep, getTradingDeploymentPlan, loadTradingDeploymentStatus, nextTradingDeploymentStep } from '../protocol/deployment.ts'

function examplePlan() {
	return getTradingDeploymentPlan(
		{
			chainId: 11_155_111,
			chainName: 'Sepolia',
			id: 'sepolia',
			proxyDeployer: getAddress(`0x${'12'.repeat(20)}`),
			securityPoolFactory: getAddress(`0x${'34'.repeat(20)}`),
		},
		30,
	)
}

describe('wallet trading deployment plan', () => {
	test('derives stable factory and router addresses from the canonical proxy', () => {
		const core = {
			chainId: 11_155_111,
			chainName: 'Sepolia',
			id: 'sepolia',
			proxyDeployer: getAddress(`0x${'12'.repeat(20)}`),
			securityPoolFactory: getAddress(`0x${'34'.repeat(20)}`),
		}
		const first = getTradingDeploymentPlan(core, 30)
		const second = getTradingDeploymentPlan(core, 30)

		expect(first.factory.address).toBe(second.factory.address)
		expect(first.router.address).toBe(second.router.address)
		expect(first.factory.address).not.toBe(first.router.address)
		expect(first.factory.dependencies).toEqual([])
		expect(first.router.dependencies).toEqual(['factory'])
	})

	test('changes the deterministic deployment when its immutable fee changes', () => {
		const core = {
			chainId: 1,
			chainName: 'Ethereum Mainnet',
			id: 'mainnet',
			proxyDeployer: getAddress(`0x${'56'.repeat(20)}`),
			securityPoolFactory: getAddress(`0x${'78'.repeat(20)}`),
		}
		expect(getTradingDeploymentPlan(core, 30).factory.address).not.toBe(getTradingDeploymentPlan(core, 25).factory.address)
	})

	test('resumes at the first missing dependency', () => {
		const plan = getTradingDeploymentPlan(
			{
				chainId: 1,
				chainName: 'Ethereum Mainnet',
				id: 'mainnet',
				proxyDeployer: getAddress(`0x${'9a'.repeat(20)}`),
				securityPoolFactory: getAddress(`0x${'bc'.repeat(20)}`),
			},
			30,
		)
		expect(nextTradingDeploymentStep(plan, { factory: false, router: false })?.id).toBe('factory')
		expect(nextTradingDeploymentStep(plan, { factory: true, router: false })?.id).toBe('router')
		expect(nextTradingDeploymentStep(plan, { factory: true, router: true })).toBeUndefined()
	})

	test('rejects a network without the exact canonical proxy deployer runtime', async () => {
		const plan = examplePlan()
		const client = {
			getCode: async ({ address }: { address: Address }) => (address === plan.core.securityPoolFactory ? '0x01' : '0x02'),
			readContract: async () => 0n,
		}
		await expect(loadTradingDeploymentStatus(client, plan)).rejects.toThrow('Canonical proxy deployer has unexpected code')
	})

	test('submits the factory init code through the canonical proxy and verifies the installed contract', async () => {
		const plan = examplePlan()
		const hash = `0x${'ab'.repeat(32)}` satisfies Hash
		let factoryDeployed = false
		const transactions: Array<Readonly<{ data: string; to: Address }>> = []
		const publicClient = {
			getCode: async ({ address }: { address: Address }) => {
				if (address === plan.core.proxyDeployer) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
				if (address === plan.core.securityPoolFactory) return '0x01'
				if (address === plan.factory.address && factoryDeployed) return '0x01'
				return '0x'
			},
			readContract: async ({ functionName }: { functionName: string }) => {
				if (functionName === 'securityPoolFactory') return plan.core.securityPoolFactory
				if (functionName === 'feeBps') return BigInt(plan.feeBps)
				throw new Error(`Unexpected read ${functionName}`)
			},
		}
		const walletClient = {
			sendTransaction: async (transaction: Readonly<{ data?: string; to?: Address }>) => {
				if (transaction.data === undefined || transaction.to === undefined) throw new Error('Missing deployment transaction fields')
				transactions.push({ data: transaction.data, to: transaction.to })
				return hash
			},
			waitForTransactionReceipt: async () => {
				factoryDeployed = true
				return { status: 'success' as const }
			},
		}

		expect(await deployTradingStep(walletClient, publicClient, plan, plan.factory)).toBe(hash)
		expect(transactions).toEqual([{ data: plan.factory.data, to: plan.core.proxyDeployer }])
	})
})
