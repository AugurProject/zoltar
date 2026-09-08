import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, getAddress, type Address, type Hash, type WalletClient } from '@zoltar/shared/ethereum'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE, deployTradingStep, getTradingDeploymentPlan, loadTradingDeploymentStatus, nextTradingDeploymentStep, resolveInstalledTradingDeployment } from '../../protocol/deployment.js'
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
			zoltar: getAddress(`0x${'56'.repeat(20)}`),
		},
		30,
		1,
	)
}

const factoryV1Abi = tradingContracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory.abi
const factoryV2Abi = tradingContracts['contracts/trading/TwoWayConstantProductFactoryV2.sol'].TwoWayConstantProductFactoryV2.abi
const routerV1Abi = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter.abi
const routerV2Abi = tradingContracts['contracts/trading/TwoWayConstantProductRouterV2.sol'].TwoWayConstantProductRouterV2.abi

function installedDeploymentClient(core: ReturnType<typeof examplePlan>['core'], installedVersions: readonly (1 | 2)[], options: Readonly<{ partialV2?: boolean; wrongFactoryLink?: boolean; wrongVersion?: boolean }> = {}) {
	const plans = { 1: getTradingDeploymentPlan(core, 30, 1), 2: getTradingDeploymentPlan(core, 30, 2) }
	const codeAddresses = new Set<string>()
	for (const version of installedVersions) {
		const plan = plans[version]
		codeAddresses.add(plan.factory.address.toLowerCase())
		if (version !== 2 || !options.partialV2) codeAddresses.add(plan.router.address.toLowerCase())
		if (version === 2 && !options.partialV2 && plan.receiveRouter !== undefined) codeAddresses.add(plan.receiveRouter.address.toLowerCase())
	}
	return createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method === 'eth_getCode' && Array.isArray(params)) {
					const address = params[0]
					if (typeof address !== 'string') throw new Error('Missing code address')
					if (address.toLowerCase() === core.proxyDeployer.toLowerCase()) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
					if (address.toLowerCase() === core.securityPoolFactory.toLowerCase() || codeAddresses.has(address.toLowerCase())) return '0x01'
					return '0x'
				}
				if (method === 'eth_call' && Array.isArray(params)) {
					const transaction = params[0]
					if (typeof transaction !== 'object' || transaction === null || !('to' in transaction) || !('data' in transaction) || typeof transaction.to !== 'string' || typeof transaction.data !== 'string') throw new Error('Malformed deployment validation call')
					const target = transaction.to.toLowerCase()
					const version = target === plans[2].factory.address.toLowerCase() || target === plans[2].router.address.toLowerCase() || target === plans[2].receiveRouter?.address.toLowerCase() ? 2 : 1
					const decoded = decodeFunctionData({ abi: version === 2 ? [...factoryV2Abi, ...routerV2Abi] : [...factoryV1Abi, ...routerV1Abi], data: transaction.data })
					if (decoded.functionName === 'securityPoolFactory') return encodeAbiParameters([{ type: 'address' }], [core.securityPoolFactory])
					if (decoded.functionName === 'feeBps') return encodeAbiParameters([{ type: 'uint256' }], [30n])
					if (decoded.functionName === 'IMPLEMENTATION_VERSION') return encodeAbiParameters([{ type: 'uint256' }], [options.wrongVersion ? 1n : 2n])
					if (decoded.functionName === 'factory') return encodeAbiParameters([{ type: 'address' }], [options.wrongFactoryLink ? plans[1].factory.address : plans[version].factory.address])
					throw new Error(`Unexpected deployment validation call ${decoded.functionName}`)
				}
				throw new Error(`Unexpected RPC method ${method}`)
			},
		}),
	})
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
		const first = getTradingDeploymentPlan(core, 30, 2)
		const second = getTradingDeploymentPlan(core, 30, 2)

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
			zoltar: getAddress(`0x${'9a'.repeat(20)}`),
		}
		expect(getTradingDeploymentPlan(core, 30, 2).factory.address).not.toBe(getTradingDeploymentPlan(core, 25, 2).factory.address)
	})

	test('keeps explicitly selected V1 and V2 venues independently predictable', () => {
		const legacyFixture = examplePlan()
		const plan = getTradingDeploymentPlan(legacyFixture.core, legacyFixture.feeBps, 2)
		const legacy = getTradingDeploymentPlan(plan.core, plan.feeBps, 1)
		expect(plan.version).toBe(2)
		expect(legacy.version).toBe(1)
		expect(plan.factory.address).not.toBe(legacy.factory.address)
		expect(plan.router.address).not.toBe(legacy.router.address)
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
				zoltar: getAddress(`0x${'de'.repeat(20)}`),
			},
			30,
			2,
		)
		expect(nextTradingDeploymentStep(plan, { factory: false, router: false })?.id).toBe('factory')
		expect(nextTradingDeploymentStep(plan, { factory: true, router: false })?.id).toBe('router')
		expect(nextTradingDeploymentStep(plan, { factory: true, router: true })?.id).toBe('receiveRouter')
		expect(nextTradingDeploymentStep(plan, { factory: true, router: true, receiveRouter: true })).toBeUndefined()
	})

	test('selects only complete authoritative V2 deployments and falls back to complete V1', async () => {
		const core = examplePlan().core
		expect((await resolveInstalledTradingDeployment(installedDeploymentClient(core, [2]), core, 30, core.defaultRpcUrl)).version).toBe(2)
		const legacy = await resolveInstalledTradingDeployment(installedDeploymentClient(core, [1]), core, 30, core.defaultRpcUrl)
		expect(legacy.version).toBe(1)
		expect(legacy.receiveRouter).toBeUndefined()
		expect((await resolveInstalledTradingDeployment(installedDeploymentClient(core, [1, 2], { partialV2: true }), core, 30, core.defaultRpcUrl)).version).toBe(1)
		await expect(resolveInstalledTradingDeployment(installedDeploymentClient(core, [2], { partialV2: true }), core, 30, core.defaultRpcUrl)).rejects.toThrow('V2 trading deployment is incomplete')
	})

	test('classifies a deployment with no V1 or V2 contracts as not deployed', async () => {
		const core = examplePlan().core
		await expect(resolveInstalledTradingDeployment(installedDeploymentClient(core, []), core, 30, core.defaultRpcUrl)).rejects.toThrow('Trading contracts have not been deployed')
	})

	test('rejects false V2 capability claims and wrong router factory links', async () => {
		const core = examplePlan().core
		await expect(resolveInstalledTradingDeployment(installedDeploymentClient(core, [2], { wrongVersion: true }), core, 30, core.defaultRpcUrl)).rejects.toThrow('implementation version is not V2')
		await expect(resolveInstalledTradingDeployment(installedDeploymentClient(core, [2], { wrongFactoryLink: true }), core, 30, core.defaultRpcUrl)).rejects.toThrow('different factory')
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
		const replacementHash = `0x${'ac'.repeat(32)}` satisfies Hash
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
			waitForTransactionReceipt: async (parameters: Parameters<WalletClient['waitForTransactionReceipt']>[0]) => {
				factoryDeployed = true
				parameters.onReplaced?.({
					reason: 'repriced',
					replacedTransaction: { hash } as never,
					transaction: { hash: replacementHash } as never,
					transactionReceipt: { status: 'success' } as never,
				})
				return { status: 'success' as const }
			},
		}
		const submittedHashes: Hash[] = []

		expect(
			await deployTradingStep(
				walletClient,
				publicClient,
				plan,
				plan.factory,
				submittedHash => submittedHashes.push(submittedHash),
				undefined,
				async () => undefined,
			),
		).toBe(replacementHash)
		expect(submittedHashes).toEqual([hash, replacementHash])
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
