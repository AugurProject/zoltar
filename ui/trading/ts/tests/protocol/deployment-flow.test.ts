import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE, getTradingDeploymentPlan, loadTradingDeploymentStatus, nextTradingDeploymentStep, resolveInstalledTradingDeployment } from '../../protocol/deployment.js'
import { tradingContracts } from '../../generated/contractArtifact.js'

function examplePlan() {
	return getTradingDeploymentPlan(
		{
			chainId: 11_155_111,
			chainName: 'Sepolia',
			defaultRpcUrl: 'https://rpc.example',
			id: 'sepolia',
			proxyDeployer: getAddress(`0x${'12'.repeat(20)}`),
			securityPoolFactory: getAddress(`0x${'34'.repeat(20)}`),
			zoltar: getAddress(`0x${'56'.repeat(20)}`),
		},
		30,
	)
}

const factoryAbi = tradingContracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory.abi
const routerAbi = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter.abi

function installedDeploymentClient(core: ReturnType<typeof examplePlan>['core'], state: 'complete' | 'factory-only' | 'missing', wrongFactoryLink = false) {
	const plan = getTradingDeploymentPlan(core, 30)
	return createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method === 'eth_getCode' && Array.isArray(params)) {
					const address = params[0]
					if (typeof address !== 'string') throw new Error('Missing code address')
					if (address.toLowerCase() === core.proxyDeployer.toLowerCase()) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
					if (address.toLowerCase() === core.securityPoolFactory.toLowerCase()) return '0x01'
					if (state !== 'missing' && address.toLowerCase() === plan.factory.address.toLowerCase()) return '0x01'
					if (state === 'complete' && address.toLowerCase() === plan.router.address.toLowerCase()) return '0x01'
					return '0x'
				}
				if (method === 'eth_call' && Array.isArray(params)) {
					const transaction = params[0]
					if (typeof transaction !== 'object' || transaction === null || !('data' in transaction) || typeof transaction.data !== 'string') throw new Error('Malformed deployment validation call')
					const decoded = decodeFunctionData({ abi: [...factoryAbi, ...routerAbi], data: transaction.data })
					if (decoded.functionName === 'securityPoolFactory') return encodeAbiParameters([{ type: 'address' }], [core.securityPoolFactory])
					if (decoded.functionName === 'feeBps') return encodeAbiParameters([{ type: 'uint256' }], [30n])
					if (decoded.functionName === 'factory') return encodeAbiParameters([{ type: 'address' }], [wrongFactoryLink ? core.securityPoolFactory : plan.factory.address])
					throw new Error(`Unexpected deployment validation call ${decoded.functionName}`)
				}
				throw new Error(`Unexpected RPC method ${method}`)
			},
		}),
	})
}

describe('wallet trading deployment plan', () => {
	test('derives one stable factory and router from the canonical proxy', () => {
		const first = examplePlan()
		const second = getTradingDeploymentPlan(first.core, first.feeBps)
		expect(first.factory.address).toBe(second.factory.address)
		expect(first.router.address).toBe(second.router.address)
		expect(first.factory.address).not.toBe(first.router.address)
		expect(first.factory.dependencies).toEqual([])
		expect(first.router.dependencies).toEqual(['factory'])
	})

	test('changes deterministic deployment when the immutable fee changes', () => {
		const plan = examplePlan()
		expect(getTradingDeploymentPlan(plan.core, 30).factory.address).not.toBe(getTradingDeploymentPlan(plan.core, 25).factory.address)
	})

	test('resumes at the first missing dependency', () => {
		const plan = examplePlan()
		expect(nextTradingDeploymentStep(plan, { factory: false, router: false })?.id).toBe('factory')
		expect(nextTradingDeploymentStep(plan, { factory: true, router: false })?.id).toBe('router')
		expect(nextTradingDeploymentStep(plan, { factory: true, router: true })).toBeUndefined()
	})

	test('accepts only the complete canonical deployment', async () => {
		const plan = examplePlan()
		const installed = await resolveInstalledTradingDeployment(installedDeploymentClient(plan.core, 'complete'), plan.core, 30, plan.core.defaultRpcUrl)
		expect(installed.factory).toBe(plan.factory.address)
		expect(installed.router).toBe(plan.router.address)
		await expect(resolveInstalledTradingDeployment(installedDeploymentClient(plan.core, 'factory-only'), plan.core, 30, plan.core.defaultRpcUrl)).rejects.toThrow('trading deployment is incomplete')
		await expect(resolveInstalledTradingDeployment(installedDeploymentClient(plan.core, 'missing'), plan.core, 30, plan.core.defaultRpcUrl)).rejects.toThrow('Trading contracts have not been deployed')
		await expect(resolveInstalledTradingDeployment(installedDeploymentClient(plan.core, 'complete', true), plan.core, 30, plan.core.defaultRpcUrl)).rejects.toThrow('different factory')
	})

	test('rejects a network without the exact canonical proxy runtime', async () => {
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
})
