import { createPublicClient, createWalletClient, custom, getAddress, http, zeroAddress, type Abi, type Address, type Hash, type PublicClient, type WalletClient } from '@zoltar/shared/ethereum'
import { tradingContracts } from '../generated/contractArtifact.ts'
import type { DeploymentConfiguration } from './config.ts'
import type { InjectedEthereum } from './injected.ts'

const deploymentComponents = [
	{ name: 'securityPool', type: 'address' },
	{ name: 'truthAuction', type: 'address' },
	{ name: 'priceOracleManagerAndOperatorQueuer', type: 'address' },
	{ name: 'shareToken', type: 'address' },
	{ name: 'parent', type: 'address' },
	{ name: 'universeId', type: 'uint248' },
	{ name: 'questionId', type: 'uint256' },
	{ name: 'statoblastSecurityMultiplierBps', type: 'uint256' },
	{ name: 'initialReportPriorityFeeAttoEthPerGas', type: 'uint256' },
	{ name: 'currentRetentionRate', type: 'uint256' },
	{ name: 'settlementCollateralAttoEth', type: 'uint256' },
] as const

const poolAccountingComponents = [
	{ name: 'settlementCollateralAttoEth', type: 'uint256' },
	{ name: 'totalCoverageCommitmentAttoEth', type: 'uint256' },
	{ name: 'feeEligibleCoverageCommitmentAttoEth', type: 'uint256' },
	{ name: 'totalClaimableVaultFeesAttoEth', type: 'uint256' },
	{ name: 'unallocatedAccruedFeesAttoEth', type: 'uint256' },
	{ name: 'feeIndex', type: 'uint256' },
	{ name: 'feeIndexRemainder', type: 'uint256' },
	{ name: 'totalFeesOwedRemainder', type: 'uint256' },
	{ name: 'uncheckpointedFeeEligibleCoverageCommitmentAttoEth', type: 'uint256' },
	{ name: 'lastUpdatedFeeAccumulator', type: 'uint256' },
	{ name: 'currentRetentionRate', type: 'uint256' },
] as const

const securityPoolFactoryAbi = [
	{ type: 'function', name: 'securityPoolDeploymentCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{
		type: 'function',
		name: 'securityPoolDeploymentsRange',
		stateMutability: 'view',
		inputs: [
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'count', type: 'uint256' },
		],
		outputs: [{ name: 'deployments', type: 'tuple[]', components: deploymentComponents }],
	},
] as const satisfies Abi

const securityPoolAbi = [
	{ type: 'function', name: 'questionData', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'zoltar', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'shareToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'shareTokenSupplyAttoShares', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'getPoolAccountingSnapshot', stateMutability: 'view', inputs: [], outputs: [{ name: 'snapshot', type: 'tuple', components: poolAccountingComponents }] },
	{ type: 'function', name: 'systemState', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
	{ type: 'function', name: 'awaitingForkContinuation', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
	{ type: 'function', name: 'getActiveVaultCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'securityPoolForker', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const satisfies Abi

const securityPoolForkerAbi = [{ type: 'function', name: 'getQuestionOutcome', stateMutability: 'view', inputs: [{ name: 'securityPool', type: 'address' }], outputs: [{ type: 'uint8' }] }] as const satisfies Abi

const zoltarAbi = [{ type: 'function', name: 'getForkTime', stateMutability: 'view', inputs: [{ name: 'universeId', type: 'uint248' }], outputs: [{ type: 'uint256' }] }] as const satisfies Abi

const questionDataAbi = [
	{
		type: 'function',
		name: 'questions',
		stateMutability: 'view',
		inputs: [{ name: 'questionId', type: 'uint256' }],
		outputs: [
			{ name: 'title', type: 'string' },
			{ name: 'description', type: 'string' },
			{ name: 'startTime', type: 'uint256' },
			{ name: 'endTime', type: 'uint256' },
			{ name: 'numTicks', type: 'uint120' },
			{ name: 'displayValueMin', type: 'int256' },
			{ name: 'displayValueMax', type: 'int256' },
			{ name: 'answerUnit', type: 'string' },
		],
	},
] as const satisfies Abi

const shareTokenAbi = [
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [
			{ name: 'account', type: 'address' },
			{ name: 'id', type: 'uint256' },
		],
		outputs: [{ type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'isApprovedForAll',
		stateMutability: 'view',
		inputs: [
			{ name: 'account', type: 'address' },
			{ name: 'operator', type: 'address' },
		],
		outputs: [{ type: 'bool' }],
	},
	{
		type: 'function',
		name: 'setApprovalForAll',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'operator', type: 'address' },
			{ name: 'approved', type: 'bool' },
		],
		outputs: [],
	},
] as const satisfies Abi

const tradingFactory = tradingContracts['trading/contracts/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
const pair = tradingContracts['trading/contracts/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
const router = tradingContracts['trading/contracts/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
export const UI_SLIPPAGE_BPS = 50n

export function minimumAfterSlippage(amount: bigint) {
	return (amount * (10_000n - UI_SLIPPAGE_BPS)) / 10_000n
}

export function maximumAfterSlippage(amount: bigint) {
	return (amount * (10_000n + UI_SLIPPAGE_BPS) + 9_999n) / 10_000n
}

async function stableSimulation<T>(client: Pick<WalletClient, 'getBlockNumber'>, simulate: () => Promise<T>) {
	const blockNumber = await client.getBlockNumber()
	const result = await simulate()
	if ((await client.getBlockNumber()) !== blockNumber) throw new Error('Block changed during simulation; simulate again')
	return { blockNumber, result }
}

export type LiveMarket = Readonly<{
	pool: Address
	pair: Address | undefined
	shareToken: Address
	universeId: bigint
	questionId: bigint
	title: string
	description: string
	endTime: bigint
	statoblastSecurityMultiplierBps: bigint
	initialReportPriorityFeeAttoEthPerGas: bigint
	systemState: number
	awaitingForkContinuation: boolean
	universeForkTime: bigint
	activeVaultCount: bigint
	shareTokenSupplyAttoShares: bigint
	settlementCollateralAttoEth: bigint
	currentRetentionRate: bigint
	totalCoverageCommitmentAttoEth: bigint
	feeEligibleCoverageCommitmentAttoEth: bigint
	feeBps: bigint
	tradingStatus: number | undefined
	questionOutcome: number
	yesReserve: bigint
	noReserve: bigint
	lpTotalSupply: bigint
}>

export function marketAcceptsNewRisk(market: Pick<LiveMarket, 'tradingStatus' | 'systemState' | 'awaitingForkContinuation' | 'universeForkTime' | 'questionOutcome' | 'endTime'>, nowSeconds: bigint) {
	if (market.tradingStatus !== undefined && market.tradingStatus !== 6) return market.tradingStatus === 0
	return market.systemState === 0 && !market.awaitingForkContinuation && market.universeForkTime === 0n && market.questionOutcome === 3 && nowSeconds < market.endTime
}

export function validateRpcChainId(rpcChainId: number, deploymentChainId: number) {
	if (rpcChainId !== deploymentChainId) throw new Error(`RPC chain ${rpcChainId} does not match deployment chain ${deploymentChainId}`)
}

export type LiveBalances = Readonly<{ yes: bigint; no: bigint; invalid: bigint; lp: bigint; approved: boolean; lpAllowance: bigint }>

export function createTradingPublicClient(configuration: DeploymentConfiguration) {
	return createPublicClient({ transport: http(configuration.rpcUrl) })
}

export function createTradingWalletClient(provider: InjectedEthereum, account: Address) {
	return createWalletClient({ account, transport: custom(provider) })
}

export async function validateLiveDeployment(client: PublicClient, configuration: DeploymentConfiguration) {
	const [rpcChainId, configuredCoreFactory, configuredFee, configuredRouterFactory] = await Promise.all([
		client.getChainId(),
		client.readContract({ abi: tradingFactory.abi, address: configuration.factory, functionName: 'securityPoolFactory' }),
		client.readContract({ abi: tradingFactory.abi, address: configuration.factory, functionName: 'feeBps' }),
		client.readContract({ abi: router.abi, address: configuration.router, functionName: 'factory' }),
	])
	validateRpcChainId(rpcChainId, configuration.chainId)
	if (getAddress(configuredCoreFactory) !== configuration.securityPoolFactory) throw new Error('Trading factory references a different SecurityPoolFactory')
	if (configuredFee !== BigInt(configuration.feeBps)) throw new Error('Trading factory fee does not match deployment.json')
	if (getAddress(configuredRouterFactory) !== configuration.factory) throw new Error('Router references a different trading factory')
}

export async function connectWallet(provider: InjectedEthereum) {
	const accounts = await provider.request({ method: 'eth_requestAccounts', params: [] })
	if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Wallet returned no account')
	return getAddress(accounts[0])
}

export async function walletChainId(provider: InjectedEthereum) {
	const result = await provider.request({ method: 'eth_chainId', params: [] })
	if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('Wallet returned an invalid chain ID')
	return Number(BigInt(result))
}

export async function switchWalletChain(provider: InjectedEthereum, chainId: number) {
	await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] })
}

export async function loadLiveSecurityPoolSettings(client: PublicClient, pool: Address) {
	const [questionData, zoltar, shareTokenSupplyAttoShares, accounting, systemState, awaitingForkContinuation, activeVaultCount, forker] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'questionData' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'zoltar' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'shareTokenSupplyAttoShares' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'getPoolAccountingSnapshot' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'systemState' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'awaitingForkContinuation' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'getActiveVaultCount' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'securityPoolForker' }),
	])
	return {
		questionData,
		zoltar,
		shareTokenSupplyAttoShares,
		settlementCollateralAttoEth: accounting.settlementCollateralAttoEth,
		currentRetentionRate: accounting.currentRetentionRate,
		totalCoverageCommitmentAttoEth: accounting.totalCoverageCommitmentAttoEth,
		feeEligibleCoverageCommitmentAttoEth: accounting.feeEligibleCoverageCommitmentAttoEth,
		systemState,
		awaitingForkContinuation,
		activeVaultCount,
		forker,
	}
}

export async function discoverLiveMarkets(client: PublicClient, configuration: DeploymentConfiguration): Promise<LiveMarket[]> {
	const count = await client.readContract({ abi: securityPoolFactoryAbi, address: configuration.securityPoolFactory, functionName: 'securityPoolDeploymentCount' })
	if (count === 0n) return []
	const deployments = await client.readContract({ abi: securityPoolFactoryAbi, address: configuration.securityPoolFactory, functionName: 'securityPoolDeploymentsRange', args: [0n, count] })
	return await Promise.all(
		deployments.map(async deployment => {
			const { securityPool: poolAddress, shareToken: shareTokenAddress, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas } = deployment
			const pool = getAddress(poolAddress)
			const shareToken = getAddress(shareTokenAddress)
			const [poolSettings, pairAddress] = await Promise.all([loadLiveSecurityPoolSettings(client, pool), client.readContract({ abi: tradingFactory.abi, address: configuration.factory, functionName: 'getPair', args: [pool] })])
			const { questionData, zoltar, shareTokenSupplyAttoShares, settlementCollateralAttoEth, currentRetentionRate, totalCoverageCommitmentAttoEth, feeEligibleCoverageCommitmentAttoEth, systemState, awaitingForkContinuation, activeVaultCount, forker } = poolSettings
			const [question, questionOutcome, universeForkTime] = await Promise.all([
				client.readContract({ abi: questionDataAbi, address: getAddress(questionData), functionName: 'questions', args: [questionId] }),
				client.readContract({ abi: securityPoolForkerAbi, address: getAddress(forker), functionName: 'getQuestionOutcome', args: [pool] }),
				client.readContract({ abi: zoltarAbi, address: getAddress(zoltar), functionName: 'getForkTime', args: [universeId] }),
			])
			const canonicalPair = pairAddress === zeroAddress ? undefined : getAddress(pairAddress)
			let yesReserve = 0n
			let noReserve = 0n
			let lpTotalSupply = 0n
			let feeBps = BigInt(configuration.feeBps)
			let tradingStatus: number | undefined
			if (canonicalPair !== undefined) {
				const [reserves, supply, pairFee, pairStatus] = await Promise.all([
					client.readContract({ abi: pair.abi, address: canonicalPair, functionName: 'getEffectiveReserves' }),
					client.readContract({ abi: pair.abi, address: canonicalPair, functionName: 'totalSupply' }),
					client.readContract({ abi: pair.abi, address: canonicalPair, functionName: 'feeBps' }),
					client.readContract({ abi: pair.abi, address: canonicalPair, functionName: 'tradingStatus' }),
				])
				yesReserve = reserves[0]
				noReserve = reserves[1]
				lpTotalSupply = supply
				feeBps = pairFee
				tradingStatus = Number(pairStatus)
			}
			return {
				pool,
				pair: canonicalPair,
				shareToken,
				universeId,
				questionId,
				title: question.title,
				description: question.description,
				endTime: question.endTime,
				statoblastSecurityMultiplierBps,
				initialReportPriorityFeeAttoEthPerGas,
				systemState: Number(systemState),
				awaitingForkContinuation,
				universeForkTime,
				activeVaultCount,
				shareTokenSupplyAttoShares,
				settlementCollateralAttoEth,
				currentRetentionRate,
				totalCoverageCommitmentAttoEth,
				feeEligibleCoverageCommitmentAttoEth,
				feeBps,
				tradingStatus,
				questionOutcome: Number(questionOutcome),
				yesReserve,
				noReserve,
				lpTotalSupply,
			}
		}),
	)
}

export async function loadLiveBalances(client: PublicClient, market: LiveMarket, account: Address, routerAddress: Address): Promise<LiveBalances> {
	const invalidId = market.universeId << 8n
	const [invalid, yes, no, approved, lp, lpAllowance] = await Promise.all([
		client.readContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'balanceOf', args: [account, invalidId] }),
		client.readContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'balanceOf', args: [account, invalidId | 1n] }),
		client.readContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'balanceOf', args: [account, invalidId | 2n] }),
		client.readContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'isApprovedForAll', args: [account, routerAddress] }),
		market.pair === undefined ? 0n : client.readContract({ abi: pair.abi, address: market.pair, functionName: 'balanceOf', args: [account] }),
		market.pair === undefined ? 0n : client.readContract({ abi: pair.abi, address: market.pair, functionName: 'allowance', args: [account, routerAddress] }),
	])
	return { invalid, yes, no, approved, lp, lpAllowance }
}

export async function simulateEntry(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, side: 'YES' | 'NO', amount: bigint, deadline = BigInt(Math.floor(Date.now() / 1_000) + 1_200)) {
	const pairAddress = market.pair
	if (pairAddress === undefined) throw new Error('Create and initialize the pair before trading')
	const { blockNumber, result: simulation } = await stableSimulation(client, async () => await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'enterPosition', account, args: [pairAddress, side === 'YES' ? 1 : 2, 0n, account, deadline], value: amount }))
	return { blockNumber, result: simulation.result, amount, side, market, deadline, minimumLongShares: minimumAfterSlippage(simulation.result.totalLongShares) }
}

export async function submitFreshEntry(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateEntry>>): Promise<Hash> {
	if ((await client.getBlockNumber()) !== quote.blockNumber) throw new Error('Quote is stale; simulate again before submission')
	const refreshed = await simulateEntry(client, configuration, quote.market, account, quote.side, quote.amount, quote.deadline)
	if (refreshed.blockNumber !== quote.blockNumber) throw new Error('Quote changed blocks during revalidation')
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('Pair disappeared from the simulated market')
	return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'enterPosition', account, args: [pairAddress, quote.side === 'YES' ? 1 : 2, refreshed.minimumLongShares, account, quote.deadline], value: quote.amount })
}

export async function simulateExit(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, side: 'YES' | 'NO', completeSets: bigint, deadline = BigInt(Math.floor(Date.now() / 1_000) + 1_200)) {
	const pairAddress = market.pair
	if (pairAddress === undefined) throw new Error('Pair is unavailable')
	const { blockNumber, result: simulation } = await stableSimulation(client, async () => await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'exitPosition', account, args: [pairAddress, side === 'YES' ? 1 : 2, completeSets, (1n << 256n) - 1n, 0n, account, deadline] }))
	return {
		blockNumber,
		result: simulation.result,
		completeSets,
		side,
		market,
		deadline,
		maximumLongShares: maximumAfterSlippage(simulation.result.totalLongShares),
		minimumEth: minimumAfterSlippage(simulation.result.ethOut),
	}
}

export async function submitFreshExit(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateExit>>): Promise<Hash> {
	if ((await client.getBlockNumber()) !== quote.blockNumber) throw new Error('Quote is stale; simulate again before submission')
	const refreshed = await simulateExit(client, configuration, quote.market, account, quote.side, quote.completeSets, quote.deadline)
	if (refreshed.blockNumber !== quote.blockNumber) throw new Error('Quote changed blocks during revalidation')
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('Pair disappeared from the simulated market')
	return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'exitPosition', account, args: [pairAddress, quote.side === 'YES' ? 1 : 2, quote.completeSets, refreshed.maximumLongShares, refreshed.minimumEth, account, quote.deadline] })
}

export async function createPair(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address) {
	return await client.writeContract({ abi: tradingFactory.abi, address: configuration.factory, functionName: 'createPair', account, args: [market.pool] })
}

export async function approveRouter(client: WalletClient, market: LiveMarket, configuration: DeploymentConfiguration, account: Address) {
	return await client.writeContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'setApprovalForAll', account, args: [configuration.router, true] })
}

export type LiquidityOperation = 'initialize' | 'add' | 'remove'

export async function simulateLiquidity(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, operation: LiquidityOperation, amount: bigint, conditionalYesBps = 5_000n) {
	const deadline = BigInt(Math.floor(Date.now() / 1_000) + 1_200)
	const pairAddress = market.pair
	if (operation === 'initialize') {
		const { blockNumber, result: simulation } = await stableSimulation(client, async () =>
			pairAddress === undefined
				? await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [market.pool, conditionalYesBps, 0n, account, deadline], value: amount })
				: await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [pairAddress, conditionalYesBps, 0n, account, deadline], value: amount }),
		)
		return { blockNumber, operation, amount, conditionalYesBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n }
	}
	if (pairAddress === undefined) throw new Error('Pair is unavailable')
	if (operation === 'add') {
		const { blockNumber, result: simulation } = await stableSimulation(client, async () => await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, 0n, account, deadline], value: amount }))
		return { blockNumber, operation, amount, conditionalYesBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n }
	}
	const { blockNumber, result: simulation } = await stableSimulation(client, async () => await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'removeLiquidity', account, args: [pairAddress, amount, 0n, 0n, account, deadline] }))
	return { blockNumber, operation, amount, conditionalYesBps, market, result: simulation.result, expectedLiquidity: 0n, expectedYes: simulation.result[0], expectedNo: simulation.result[1] }
}

export async function submitFreshLiquidity(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateLiquidity>>) {
	if ((await client.getBlockNumber()) !== quote.blockNumber) throw new Error('Quote is stale; simulate again before submission')
	const refreshed = await simulateLiquidity(client, configuration, quote.market, account, quote.operation, quote.amount, quote.conditionalYesBps)
	if (refreshed.blockNumber !== quote.blockNumber) throw new Error('Quote changed blocks during revalidation')
	const deadline = BigInt(Math.floor(Date.now() / 1_000) + 1_200)
	if (quote.operation === 'initialize') {
		return quote.market.pair === undefined
			? await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [quote.market.pool, quote.conditionalYesBps, minimumAfterSlippage(refreshed.expectedLiquidity), account, deadline], value: quote.amount })
			: await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [quote.market.pair, quote.conditionalYesBps, minimumAfterSlippage(refreshed.expectedLiquidity), account, deadline], value: quote.amount })
	}
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('Pair disappeared from the simulated market')
	if (quote.operation === 'add') return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, minimumAfterSlippage(refreshed.expectedLiquidity), account, deadline], value: quote.amount })
	return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'removeLiquidity', account, args: [pairAddress, quote.amount, minimumAfterSlippage(refreshed.expectedYes), minimumAfterSlippage(refreshed.expectedNo), account, deadline] })
}

export async function approveLpRouter(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, amount: bigint) {
	if (market.pair === undefined) throw new Error('Pair is unavailable')
	return await client.writeContract({ abi: pair.abi, address: market.pair, functionName: 'approve', account, args: [configuration.router, amount] })
}
