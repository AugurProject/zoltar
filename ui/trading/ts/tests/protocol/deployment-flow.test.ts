import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, getAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE, deployTradingStep, getTradingDeploymentPlan, loadTradingDeploymentStatus, nextTradingDeploymentStep } from '../../protocol/deployment.js'

function examplePlan() {
	return getTradingDeploymentPlan(
		{
			chainId: 11_155_111,
			chainName: 'Sepolia',
			defaultRpcUrl: 'https://rpc.example',
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
			defaultRpcUrl: 'https://rpc.example',
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
			defaultRpcUrl: 'https://rpc.example',
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
				defaultRpcUrl: 'https://rpc.example',
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
		const client = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method !== 'eth_getCode' || !Array.isArray(params)) throw new Error(`Unexpected RPC method ${method}`)
					return typeof params[0] === 'string' && params[0].toLowerCase() === plan.core.securityPoolFactory.toLowerCase() ? '0x01' : '0x02'
				},
			}),
		})
		await expect(loadTradingDeploymentStatus(client, plan)).rejects.toThrow('Canonical proxy deployer has unexpected code')
	})

	test('submits the factory init code through the canonical proxy and verifies the installed contract', async () => {
		const plan = examplePlan()
		const hash = `0x${'ab'.repeat(32)}` satisfies Hash
		let factoryDeployed = false
		let delayedFactoryCodeReads = 2
		let contractReadCount = 0
		const transactions: Array<Readonly<{ data: string; to: string }>> = []
		const publicClient = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method === 'eth_getCode' && Array.isArray(params)) {
						const address = params[0]
						if (typeof address !== 'string') throw new Error('Missing code address')
						if (address.toLowerCase() === plan.core.proxyDeployer.toLowerCase()) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
						if (address.toLowerCase() === plan.core.securityPoolFactory.toLowerCase()) return '0x01'
						if (address.toLowerCase() === plan.factory.address.toLowerCase() && factoryDeployed) {
							if (delayedFactoryCodeReads > 0) {
								delayedFactoryCodeReads -= 1
								return '0x'
							}
							return '0x01'
						}
						return '0x'
					}
					if (method === 'eth_call') {
						contractReadCount += 1
						return contractReadCount % 2 === 1 ? encodeAbiParameters([{ type: 'address' }], [plan.core.securityPoolFactory]) : encodeAbiParameters([{ type: 'uint16' }], [plan.feeBps])
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
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

		expect(await deployTradingStep(walletClient, publicClient, plan, plan.factory, undefined, undefined, async () => undefined)).toBe(hash)
		expect(transactions).toEqual([{ data: plan.factory.data, to: plan.core.proxyDeployer }])
	})

	test('aborts before broadcast when the wallet context changes during preflight', async () => {
		const plan = examplePlan()
		let sendCount = 0
		const publicClient = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method !== 'eth_getCode' || !Array.isArray(params)) throw new Error(`Unexpected RPC method ${method}`)
					const address = params[0]
					if (typeof address === 'string' && address.toLowerCase() === plan.core.proxyDeployer.toLowerCase()) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
					return typeof address === 'string' && address.toLowerCase() === plan.core.securityPoolFactory.toLowerCase() ? '0x01' : '0x'
				},
			}),
		})
		const walletClient = {
			sendTransaction: async () => {
				sendCount += 1
				return `0x${'ab'.repeat(32)}` satisfies Hash
			},
			waitForTransactionReceipt: async () => ({ status: 'success' as const }),
		}

		await expect(deployTradingStep(walletClient, publicClient, plan, plan.factory, undefined, async () => await Promise.reject(new Error('Wallet context changed before deployment')))).rejects.toThrow('Wallet context changed before deployment')
		expect(sendCount).toBe(0)
	})
})
