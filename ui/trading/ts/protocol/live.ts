import { createPublicClient, createWalletClient, custom, getAddress, http, zeroAddress, type Abi, type Address, type Hash, type PublicClient, type WalletClient } from '@zoltar/shared/ethereum'
import { tradingContracts } from '../generated/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { InjectedEthereum } from './injected.js'
import { bigintToSafeNumber } from '../lib/format.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

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
	{ name: 'totalCapacityOwnershipAttoRep', type: 'uint256' },
	{ name: 'feeEligibleCapacityOwnershipAttoRep', type: 'uint256' },
	{ name: 'totalClaimableVaultFeesAttoEth', type: 'uint256' },
	{ name: 'unallocatedAccruedFeesAttoEth', type: 'uint256' },
	{ name: 'feeIndex', type: 'uint256' },
	{ name: 'feeIndexRemainder', type: 'uint256' },
	{ name: 'totalFeesOwedRemainder', type: 'uint256' },
	{ name: 'uncheckpointedFeeEligibleCapacityOwnershipAttoRep', type: 'uint256' },
	{ name: 'lastUpdatedFeeAccumulator', type: 'uint256' },
	{ name: 'currentRetentionRate', type: 'uint256' },
] as const

const securityPoolFactoryAbi = [
	{
		type: 'event',
		name: 'DeploySecurityPool',
		inputs: [
			{ indexed: true, name: 'securityPool', type: 'address' },
			{ indexed: false, name: 'truthAuction', type: 'address' },
			{ indexed: false, name: 'priceOracleManagerAndOperatorQueuer', type: 'address' },
			{ indexed: false, name: 'shareToken', type: 'address' },
			{ indexed: true, name: 'parent', type: 'address' },
			{ indexed: true, name: 'universeId', type: 'uint248' },
			{ indexed: false, name: 'questionId', type: 'uint256' },
			{ indexed: false, name: 'statoblastSecurityMultiplierBps', type: 'uint256' },
			{ indexed: false, name: 'initialReportPriorityFeeAttoEthPerGas', type: 'uint256' },
			{ indexed: false, name: 'currentRetentionRate', type: 'uint256' },
			{ indexed: false, name: 'settlementCollateralAttoEth', type: 'uint256' },
		],
	},
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
	{ type: 'function', name: 'repToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'shareTokenSupplyAttoShares', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'getCurrentMintingCapacityAttoEth', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'getPoolAccountingSnapshot', stateMutability: 'view', inputs: [], outputs: [{ name: 'snapshot', type: 'tuple', components: poolAccountingComponents }] },
	{ type: 'function', name: 'systemState', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
	{ type: 'function', name: 'awaitingForkContinuation', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
	{ type: 'function', name: 'getVaultCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'securityPoolForker', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'redeemCompleteSet', stateMutability: 'nonpayable', inputs: [{ name: 'amountAttoShares', type: 'uint256' }], outputs: [] },
	{ type: 'function', name: 'redeemShares', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const satisfies Abi

const erc20BalanceAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const satisfies Abi

const securityPoolForkerAbi = [{ type: 'function', name: 'getQuestionOutcome', stateMutability: 'view', inputs: [{ name: 'securityPool', type: 'address' }], outputs: [{ type: 'uint8' }] }] as const satisfies Abi

const zoltarAbi = [
	{ type: 'function', name: 'getForkTime', stateMutability: 'view', inputs: [{ name: 'universeId', type: 'uint248' }], outputs: [{ type: 'uint256' }] },
	{
		type: 'function',
		name: 'getDeployedChildUniverses',
		stateMutability: 'view',
		inputs: [
			{ name: 'universeId', type: 'uint248' },
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'count', type: 'uint256' },
		],
		outputs: [
			{ name: 'outcomeIndexes', type: 'uint256[]' },
			{ name: 'childUniverseIds', type: 'uint248[]' },
			{
				name: 'children',
				type: 'tuple[]',
				components: [
					{ name: 'forkTime', type: 'uint256' },
					{ name: 'forkQuestionId', type: 'uint256' },
					{ name: 'forkingOutcomeIndex', type: 'uint256' },
					{ name: 'reputationToken', type: 'address' },
					{ name: 'parentUniverseId', type: 'uint248' },
				],
			},
		],
	},
] as const satisfies Abi

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
	{
		type: 'function',
		name: 'migrate',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'fromId', type: 'uint256' },
			{ name: 'targetOutcomeIndexes', type: 'uint256[]' },
		],
		outputs: [],
	},
] as const satisfies Abi

const tradingFactory = tradingContracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
const pair = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
const UI_SLIPPAGE_BPS = 50n

export function requireTransactionSlippageBps(slippageBps: bigint) {
	if (slippageBps < 0n || slippageBps > 500n) throw new Error('Slippage must be between 0% and 5%')
}

export function minimumAfterSlippage(amount: bigint, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionSlippageBps(slippageBps)
	return (amount * (10_000n - slippageBps)) / 10_000n
}

export function maximumAfterSlippage(amount: bigint, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionSlippageBps(slippageBps)
	return (amount * (10_000n + slippageBps) + 9_999n) / 10_000n
}

async function latestBlockIdentity(client: Pick<WalletClient, 'getBlock'>) {
	const block = await client.getBlock()
	if (block.number === null || block.number === undefined || block.hash === null || block.hash === undefined) throw new Error('Latest block identity is unavailable')
	return { blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp }
}

async function stableSimulation<T>(client: Pick<WalletClient, 'getBlock'>, simulate: (block: Readonly<{ blockNumber: bigint; blockHash: Hash; blockTimestamp: bigint }>) => Promise<T>) {
	const before = await latestBlockIdentity(client)
	const result = await simulate(before)
	const after = await latestBlockIdentity(client)
	if (after.blockNumber !== before.blockNumber || after.blockHash !== before.blockHash) throw new Error('Block changed during simulation; simulate again')
	return { ...before, result }
}

type TransactionExpiry = bigint | Readonly<{ validityMinutes: bigint }>

export function requireTransactionValidityMinutes(validityMinutes: bigint) {
	if (validityMinutes < 1n || validityMinutes > 1_440n) throw new Error('Transaction validity must be between 1 and 1440 minutes')
}

function deadlineAtBlock(expiry: TransactionExpiry, blockTimestamp: bigint) {
	if (typeof expiry === 'bigint') return expiry
	requireTransactionValidityMinutes(expiry.validityMinutes)
	return blockTimestamp + expiry.validityMinutes * 60n
}

async function requireQuoteBlock(client: Pick<WalletClient, 'getBlock'>, quote: Readonly<{ blockNumber: bigint; blockHash: Hash }>) {
	const current = await latestBlockIdentity(client)
	if (current.blockNumber !== quote.blockNumber || current.blockHash !== quote.blockHash) throw new Error('Quote is stale; simulate again before submission')
}

export function retainApprovedMinimum(approved: bigint, refreshed: bigint, label: string) {
	if (refreshed < approved) throw new Error(`Refreshed quote no longer satisfies the approved minimum ${label}`)
	return approved
}

export function retainApprovedMaximum(approved: bigint, refreshed: bigint, label: string) {
	if (refreshed > approved) throw new Error(`Refreshed quote no longer satisfies the approved maximum ${label}`)
	return approved
}

export type LiveMarket = Readonly<{
	loadError?: string
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
	vaultCount: bigint
	shareTokenSupplyAttoShares: bigint
	settlementCollateralAttoEth: bigint
	currentRetentionRate: bigint
	totalCapacityOwnershipAttoRep: bigint
	feeEligibleCapacityOwnershipAttoRep: bigint
	mintingCapacityCeilingAttoEth: bigint
	availableMintingCapacityAttoEth: bigint
	feeBps: bigint
	tradingStatus: number | undefined
	questionOutcome: number
	yesReserve: bigint
	noReserve: bigint
	lpTotalSupply: bigint
}>

export type MarketLifecycle = Pick<LiveMarket, 'loadError' | 'tradingStatus' | 'systemState' | 'awaitingForkContinuation' | 'universeForkTime' | 'questionOutcome' | 'endTime'>

function resolvedOutcomeLabel(questionOutcome: number) {
	if (questionOutcome === 0) return 'Resolved INVALID'
	if (questionOutcome === 1) return 'Resolved YES'
	if (questionOutcome === 2) return 'Resolved NO'
	return 'Question resolved'
}

export function marketNewRiskBlocker(market: MarketLifecycle, nowSeconds: bigint) {
	if (market.loadError !== undefined) return 'Market data unavailable'
	if (market.tradingStatus !== undefined && market.tradingStatus !== 6) {
		if (market.tradingStatus === 1) return 'Question ended'
		if (market.tradingStatus === 2) return 'Pool inactive'
		if (market.tradingStatus === 3) return 'Awaiting fork continuation'
		if (market.tradingStatus === 4) return 'Universe forked'
		if (market.tradingStatus === 5) return resolvedOutcomeLabel(market.questionOutcome)
	}
	if (market.universeForkTime !== 0n) return 'Universe forked'
	if (market.awaitingForkContinuation) return 'Awaiting fork continuation'
	if (market.systemState !== 0) return 'Pool inactive'
	if (market.questionOutcome !== 3) return resolvedOutcomeLabel(market.questionOutcome)
	if (nowSeconds >= market.endTime) return 'Question ended'
	return undefined
}

export function marketAcceptsNewRisk(market: MarketLifecycle, nowSeconds: bigint) {
	return marketNewRiskBlocker(market, nowSeconds) === undefined
}

export function validateRpcChainId(rpcChainId: number, deploymentChainId: number) {
	if (rpcChainId !== deploymentChainId) throw new Error(`RPC chain ${rpcChainId} does not match deployment chain ${deploymentChainId}`)
}

type ShareBalanceScope = Readonly<{ pool: Address; shareToken: Address; invalidTokenId: bigint; yesTokenId: bigint; noTokenId: bigint }>

export type LiveBalances = Readonly<{ scope: ShareBalanceScope; yes: bigint; no: bigint; invalid: bigint; lp: bigint; approved: boolean; lpAllowance: bigint }>

export function shareBalanceScope(market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId'>) {
	const invalidTokenId = market.universeId << 8n
	return {
		pool: market.pool,
		shareToken: market.shareToken,
		invalidTokenId,
		yesTokenId: invalidTokenId | 1n,
		noTokenId: invalidTokenId | 2n,
	} as const
}

export function liveBalancesForMarket(balances: LiveBalances | undefined, market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId'> | undefined) {
	if (balances === undefined || market === undefined) return undefined
	const scope = shareBalanceScope(market)
	if (balances.scope.pool !== scope.pool || balances.scope.shareToken !== scope.shareToken) return undefined
	if (balances.scope.invalidTokenId !== scope.invalidTokenId || balances.scope.yesTokenId !== scope.yesTokenId || balances.scope.noTokenId !== scope.noTokenId) return undefined
	return balances
}

export type SettlementOperation = 'redeem-complete-set' | 'redeem-winning-shares' | 'migrate-shares'
export type ShareOutcome = 'INVALID' | 'YES' | 'NO'

function outcomeValue(outcome: ShareOutcome) {
	if (outcome === 'INVALID') return 0n
	return outcome === 'YES' ? 1n : 2n
}

export function normalizeForkOutcomeIndexes(targetOutcomeIndexes: readonly bigint[]) {
	if (targetOutcomeIndexes.length === 0) throw new Error('Select at least one fork target')
	const normalized = [...targetOutcomeIndexes].sort((left, right) => {
		if (left < right) return -1
		if (left > right) return 1
		return 0
	})
	for (let index = 0; index < normalized.length; index++) {
		const outcomeIndex = normalized[index]
		if (outcomeIndex === undefined || outcomeIndex < 0n || outcomeIndex >= 1n << 256n) throw new Error('Fork target is outside uint256')
		if (index > 0 && outcomeIndex === normalized[index - 1]) throw new Error('Select each fork target only once')
	}
	return normalized
}

export function settlementAvailability(market: MarketLifecycle, balances: Pick<LiveBalances, 'invalid' | 'yes' | 'no'> | undefined) {
	const completeSets = balances === undefined ? 0n : [balances.invalid, balances.yes, balances.no].reduce((minimum, balance) => (balance < minimum ? balance : minimum))
	let winningBalance = 0n
	if (balances !== undefined) {
		if (market.questionOutcome === 0) winningBalance = balances.invalid
		else if (market.questionOutcome === 1) winningBalance = balances.yes
		else if (market.questionOutcome === 2) winningBalance = balances.no
	}
	const directionalBalance = balances === undefined ? 0n : balances.invalid + balances.yes + balances.no
	return {
		completeSets,
		winningBalance,
		canRedeemCompleteSets: market.loadError === undefined && market.systemState === 0 && market.universeForkTime === 0n && completeSets > 0n,
		canRedeemWinningShares: market.loadError === undefined && market.systemState === 0 && market.questionOutcome !== 3 && winningBalance > 0n,
		canMigrateShares: market.loadError === undefined && market.universeForkTime !== 0n && directionalBalance > 0n,
	}
}

export function createTradingPublicClient(configuration: DeploymentConfiguration) {
	const backend = getActiveBackend()
	if (backend.id === 'simulation') return backend.createReadClient()
	return createPublicClient({ transport: http(configuration.rpcUrl) })
}

export function createTradingWalletClient(provider: InjectedEthereum, account: Address) {
	const backend = getActiveBackend()
	if (backend.id === 'simulation') return backend.createWriteClient(account)
	return createWalletClient({ account, transport: custom(provider) })
}

export async function loadWalletHeaderBalances(client: PublicClient, market: Pick<LiveMarket, 'pool'>, account: Address) {
	const [ethAttoEth, repToken] = await Promise.all([client.getBalance({ address: account }), client.readContract({ abi: securityPoolAbi, address: market.pool, functionName: 'repToken' })])
	const repAttoRep = await client.readContract({ abi: erc20BalanceAbi, address: getAddress(repToken), functionName: 'balanceOf', args: [account] })
	return { ethAttoEth, repAttoRep, repToken: getAddress(repToken) }
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
	if (configuredFee !== BigInt(configuration.feeBps)) throw new Error('Trading factory fee does not match the deterministic deployment')
	if (getAddress(configuredRouterFactory) !== configuration.factory) throw new Error('Router references a different trading factory')
}

export async function connectWallet(provider: InjectedEthereum) {
	const accounts = await provider.request({ method: 'eth_requestAccounts', params: [] })
	if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Wallet returned no account')
	return getAddress(accounts[0])
}

export async function connectedWalletAccount(provider: InjectedEthereum) {
	const accounts = await provider.request({ method: 'eth_accounts', params: [] })
	if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Wallet returned no connected account')
	return getAddress(accounts[0])
}

export async function walletChainId(provider: InjectedEthereum) {
	const result = await provider.request({ method: 'eth_chainId', params: [] })
	if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('Wallet returned an invalid chain ID')
	return bigintToSafeNumber(BigInt(result), 'Wallet chain ID')
}

export async function switchWalletChain(provider: InjectedEthereum, chainId: number) {
	await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] })
}

async function loadLiveSecurityPoolSettings(client: PublicClient, pool: Address) {
	const [questionData, zoltar, shareTokenSupplyAttoShares, mintingCapacityCeilingAttoEth, accounting, systemState, awaitingForkContinuation, vaultCount, forker] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'questionData' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'zoltar' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'shareTokenSupplyAttoShares' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'getCurrentMintingCapacityAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'getPoolAccountingSnapshot' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'systemState' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'awaitingForkContinuation' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'getVaultCount' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'securityPoolForker' }),
	])
	return {
		questionData,
		zoltar,
		shareTokenSupplyAttoShares,
		settlementCollateralAttoEth: accounting.settlementCollateralAttoEth,
		currentRetentionRate: accounting.currentRetentionRate,
		totalCapacityOwnershipAttoRep: accounting.totalCapacityOwnershipAttoRep,
		feeEligibleCapacityOwnershipAttoRep: accounting.feeEligibleCapacityOwnershipAttoRep,
		mintingCapacityCeilingAttoEth,
		availableMintingCapacityAttoEth: mintingCapacityCeilingAttoEth > accounting.settlementCollateralAttoEth ? mintingCapacityCeilingAttoEth - accounting.settlementCollateralAttoEth : 0n,
		systemState,
		awaitingForkContinuation,
		vaultCount,
		forker,
	}
}

export function marketDiscoveryRanges(total: bigint, pageSize = 25n) {
	if (total < 0n || pageSize <= 0n) throw new Error('Invalid market discovery range')
	const ranges: Array<Readonly<{ start: bigint; count: bigint }>> = []
	for (let start = 0n; start < total; start += pageSize) {
		const remaining = total - start
		ranges.push({ start, count: remaining < pageSize ? remaining : pageSize })
	}
	return ranges
}

export async function mapWithConcurrency<Input, Output>(items: readonly Input[], maximumConcurrency: number, mapper: (item: Input, index: number) => Promise<Output>) {
	if (!Number.isInteger(maximumConcurrency) || maximumConcurrency <= 0) throw new Error('Async concurrency limit must be a positive integer')
	const queue = items.map((item, index) => ({ item, index }))
	const completed: Array<Readonly<{ index: number; value: Output }>> = []
	let nextQueueIndex = 0
	async function worker() {
		while (true) {
			const job = queue[nextQueueIndex]
			if (job === undefined) return
			nextQueueIndex += 1
			completed.push({ index: job.index, value: await mapper(job.item, job.index) })
		}
	}
	const workerCount = Math.min(maximumConcurrency, queue.length)
	await Promise.all(Array.from({ length: workerCount }, worker))
	completed.sort((left, right) => left.index - right.index)
	return completed.map(result => result.value)
}

async function settleWithConcurrency<Input, Output>(items: readonly Input[], maximumConcurrency: number, mapper: (item: Input, index: number) => Promise<Output>) {
	return await mapWithConcurrency(items, maximumConcurrency, async (item, index): Promise<PromiseSettledResult<Output>> => {
		try {
			return { status: 'fulfilled', value: await mapper(item, index) }
		} catch (reason) {
			return { status: 'rejected', reason }
		}
	})
}

export function marketDiscoveryPage(total: bigint, requestedStart = 0n, pageSize = 25n) {
	if (total < 0n || requestedStart < 0n || pageSize <= 0n) throw new Error('Invalid market discovery page')
	if (total === 0n) return { start: 0n, count: 0n, previousStart: undefined, nextStart: undefined }
	const lastStart = ((total - 1n) / pageSize) * pageSize
	const start = requestedStart > lastStart ? lastStart : (requestedStart / pageSize) * pageSize
	const remaining = total - start
	return {
		start,
		count: remaining < pageSize ? remaining : pageSize,
		previousStart: start === 0n ? undefined : start - pageSize,
		nextStart: start + pageSize < total ? start + pageSize : undefined,
	}
}

export type SecurityPoolDeployment = Readonly<{
	securityPool: Address
	shareToken: Address
	universeId: bigint
	questionId: bigint
	statoblastSecurityMultiplierBps: bigint
	initialReportPriorityFeeAttoEthPerGas: bigint
}>

export function publicErrorMessage(error: unknown, fallback: string) {
	if (!(error instanceof Error)) return fallback
	const detail = error.message.trim()
	if (detail.length === 0) return fallback
	if (/(?<![0-9a-f])0x[0-9a-f]{40}(?![0-9a-f])|share[ -]?token|token[ _-]?id|contract address|call (?:arguments?|args)|\bargs?:/i.test(detail)) return fallback
	return detail
}

function unavailableMarket(deployment: SecurityPoolDeployment, error: unknown, feeBps: number): LiveMarket {
	return {
		loadError: publicErrorMessage(error, 'Market reads failed'),
		pool: getAddress(deployment.securityPool),
		pair: undefined,
		shareToken: getAddress(deployment.shareToken),
		universeId: deployment.universeId,
		questionId: deployment.questionId,
		title: `SecurityPool ${deployment.questionId.toString()}`,
		description: 'Live market data is temporarily unavailable.',
		endTime: 0n,
		statoblastSecurityMultiplierBps: deployment.statoblastSecurityMultiplierBps,
		initialReportPriorityFeeAttoEthPerGas: deployment.initialReportPriorityFeeAttoEthPerGas,
		systemState: -1,
		awaitingForkContinuation: false,
		universeForkTime: 0n,
		vaultCount: 0n,
		shareTokenSupplyAttoShares: 0n,
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 0n,
		totalCapacityOwnershipAttoRep: 0n,
		feeEligibleCapacityOwnershipAttoRep: 0n,
		mintingCapacityCeilingAttoEth: 0n,
		availableMintingCapacityAttoEth: 0n,
		feeBps: BigInt(feeBps),
		tradingStatus: undefined,
		questionOutcome: 3,
		yesReserve: 0n,
		noReserve: 0n,
		lpTotalSupply: 0n,
	}
}

export function collateMarketDiscoveryResults(deployments: readonly SecurityPoolDeployment[], results: readonly PromiseSettledResult<LiveMarket>[], feeBps: number) {
	if (deployments.length !== results.length) throw new Error('Market discovery result length mismatch')
	return results.map((result, index) => {
		const deployment = deployments[index]
		if (deployment === undefined) throw new Error('Market discovery result length mismatch')
		return result.status === 'fulfilled' ? result.value : unavailableMarket(deployment, result.reason, feeBps)
	})
}

async function loadLiveMarket(client: PublicClient, configuration: DeploymentConfiguration, deployment: SecurityPoolDeployment): Promise<LiveMarket> {
	const { securityPool: poolAddress, shareToken: shareTokenAddress, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas } = deployment
	const pool = getAddress(poolAddress)
	const shareToken = getAddress(shareTokenAddress)
	const [poolSettings, pairAddress] = await Promise.all([loadLiveSecurityPoolSettings(client, pool), client.readContract({ abi: tradingFactory.abi, address: configuration.factory, functionName: 'getPair', args: [pool] })])
	const { questionData, zoltar, shareTokenSupplyAttoShares, settlementCollateralAttoEth, currentRetentionRate, totalCapacityOwnershipAttoRep, feeEligibleCapacityOwnershipAttoRep, mintingCapacityCeilingAttoEth, availableMintingCapacityAttoEth, systemState, awaitingForkContinuation, vaultCount, forker } = poolSettings
	const [question, questionOutcome, universeForkTime] = await Promise.all([
		client.readContract({ abi: questionDataAbi, address: getAddress(questionData), functionName: 'questions', args: [questionId] }),
		client.readContract({ abi: securityPoolForkerAbi, address: getAddress(forker), functionName: 'getQuestionOutcome', args: [pool] }),
		client.readContract({ abi: zoltarAbi, address: getAddress(zoltar), functionName: 'getForkTime', args: [universeId] }),
	])
	const questionFields = liveQuestionFields(question)
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
		tradingStatus = bigintToSafeNumber(pairStatus, 'Pair trading status')
	}
	return {
		pool,
		pair: canonicalPair,
		shareToken,
		universeId,
		questionId,
		title: questionFields.title,
		description: questionFields.description,
		endTime: questionFields.endTime,
		statoblastSecurityMultiplierBps,
		initialReportPriorityFeeAttoEthPerGas,
		systemState: bigintToSafeNumber(systemState, 'SecurityPool system state'),
		awaitingForkContinuation,
		universeForkTime,
		vaultCount,
		shareTokenSupplyAttoShares,
		settlementCollateralAttoEth,
		currentRetentionRate,
		totalCapacityOwnershipAttoRep,
		feeEligibleCapacityOwnershipAttoRep,
		mintingCapacityCeilingAttoEth,
		availableMintingCapacityAttoEth,
		feeBps,
		tradingStatus,
		questionOutcome: bigintToSafeNumber(questionOutcome, 'Question outcome'),
		yesReserve,
		noReserve,
		lpTotalSupply,
	}
}

export function liveQuestionFields(question: readonly [title: string, description: string, startTime: bigint, endTime: bigint, ...rest: readonly unknown[]]) {
	return { title: question[0], description: question[1], endTime: question[3] }
}

export type SecurityPoolDeploymentIndex<Deployment, Anchor> = {
	key: string | undefined
	deployments: Deployment[]
	anchor: Anchor | undefined
	pending: Promise<void> | undefined
}

export function createSecurityPoolDeploymentIndex<Deployment, Anchor>(): SecurityPoolDeploymentIndex<Deployment, Anchor> {
	return { key: undefined, deployments: [], anchor: undefined, pending: undefined }
}

export async function refreshSecurityPoolDeploymentIndex<Deployment, Anchor>(
	index: SecurityPoolDeploymentIndex<Deployment, Anchor>,
	key: string,
	loadSnapshot: () => Promise<Readonly<{ anchor: Anchor; total: bigint }>>,
	isAnchorCanonical: (anchor: Anchor) => Promise<boolean>,
	loadRange: (start: bigint, count: bigint, anchor: Anchor) => Promise<readonly Deployment[]>,
	pageSize = 25n,
) {
	if (pageSize <= 0n) throw new Error('Invalid market discovery range')
	const previous = index.pending
	let snapshot: Deployment[] = []
	const refresh = (async () => {
		if (previous !== undefined) await previous.catch(() => undefined)
		if (index.key !== key) {
			index.key = key
			index.deployments = []
			index.anchor = undefined
		}
		if (index.anchor !== undefined && !(await isAnchorCanonical(index.anchor))) {
			index.deployments = []
			index.anchor = undefined
		}
		const { anchor, total } = await loadSnapshot()
		if (total < BigInt(index.deployments.length)) index.deployments = []
		const knownCount = BigInt(index.deployments.length)
		const ranges = marketDiscoveryRanges(total - knownCount, pageSize).map(range => ({ start: knownCount + range.start, count: range.count }))
		const pages = await mapWithConcurrency(ranges, 4, async range => await loadRange(range.start, range.count, anchor))
		const appended = pages.flat()
		if (BigInt(appended.length) !== total - knownCount) throw new Error('SecurityPool deployment registry returned an incomplete range')
		if (!(await isAnchorCanonical(anchor))) throw new Error('SecurityPool deployment registry changed during discovery')
		index.deployments.push(...appended)
		index.anchor = anchor
		snapshot = index.deployments.slice()
	})()
	index.pending = refresh
	try {
		await refresh
	} finally {
		if (index.pending === refresh) index.pending = undefined
	}
	return snapshot
}

export type RegistryBlockAnchor = Readonly<{ blockNumber: bigint; blockHash: Hash }>

export async function registryBlockAnchorIsCanonical(anchor: RegistryBlockAnchor, loadLatest: () => Promise<RegistryBlockAnchor>, loadByNumber?: (blockNumber: bigint) => Promise<RegistryBlockAnchor>) {
	const latest = await loadLatest()
	if (latest.blockNumber < anchor.blockNumber) return false
	if (latest.blockNumber === anchor.blockNumber) return latest.blockHash === anchor.blockHash
	if (loadByNumber === undefined) return true
	return (await loadByNumber(anchor.blockNumber)).blockHash === anchor.blockHash
}

export function registrySnapshotBlockParameters(anchor: RegistryBlockAnchor, simulation: boolean): Readonly<{ blockHash?: Hash }> {
	return simulation ? {} : { blockHash: anchor.blockHash }
}

export async function refreshSecurityPoolDeploymentEventIndex<Deployment>(
	index: SecurityPoolDeploymentIndex<Deployment, RegistryBlockAnchor>,
	key: string,
	loadLatest: () => Promise<RegistryBlockAnchor>,
	isAnchorCanonical: (anchor: RegistryBlockAnchor) => Promise<boolean>,
	loadEvents: (fromBlock: bigint, toBlock: bigint) => Promise<readonly Deployment[]>,
) {
	const previous = index.pending
	let snapshot: Deployment[] = []
	const refresh = (async () => {
		if (previous !== undefined) await previous.catch(() => undefined)
		if (index.key !== key) {
			index.key = key
			index.deployments = []
			index.anchor = undefined
		}
		if (index.anchor !== undefined && !(await isAnchorCanonical(index.anchor))) {
			index.deployments = []
			index.anchor = undefined
		}
		const anchor = await loadLatest()
		const fromBlock = index.anchor === undefined ? 0n : index.anchor.blockNumber + 1n
		if (fromBlock <= anchor.blockNumber) index.deployments.push(...(await loadEvents(fromBlock, anchor.blockNumber)))
		if (!(await isAnchorCanonical(anchor))) throw new Error('SecurityPool deployment events changed during discovery')
		index.anchor = anchor
		snapshot = index.deployments.slice()
	})()
	index.pending = refresh
	try {
		await refresh
	} finally {
		if (index.pending === refresh) index.pending = undefined
	}
	return snapshot
}

function securityPoolDeploymentFromEvent(log: Readonly<{ args?: unknown }>): SecurityPoolDeployment {
	const args = log.args
	if (typeof args !== 'object' || args === null) throw new Error('SecurityPool deployment event is missing its arguments')
	const securityPool = Reflect.get(args, 'securityPool')
	const shareToken = Reflect.get(args, 'shareToken')
	const universeId = Reflect.get(args, 'universeId')
	const questionId = Reflect.get(args, 'questionId')
	const statoblastSecurityMultiplierBps = Reflect.get(args, 'statoblastSecurityMultiplierBps')
	const initialReportPriorityFeeAttoEthPerGas = Reflect.get(args, 'initialReportPriorityFeeAttoEthPerGas')
	if (typeof securityPool !== 'string' || typeof shareToken !== 'string' || typeof universeId !== 'bigint' || typeof questionId !== 'bigint' || typeof statoblastSecurityMultiplierBps !== 'bigint' || typeof initialReportPriorityFeeAttoEthPerGas !== 'bigint') {
		throw new Error('SecurityPool deployment event is incomplete')
	}
	return {
		initialReportPriorityFeeAttoEthPerGas,
		questionId,
		securityPool: getAddress(securityPool),
		shareToken: getAddress(shareToken),
		statoblastSecurityMultiplierBps,
		universeId,
	}
}

async function loadUniverseIds(client: PublicClient, configuration: DeploymentConfiguration) {
	const universeIds = [0n]
	const seen = new Set(['0'])
	for (let universeIndex = 0; universeIndex < universeIds.length; universeIndex += 1) {
		const universeId = universeIds[universeIndex]
		if (universeId === undefined) throw new Error('Universe discovery lost its current entry')
		for (let start = 0n; ; start += 100n) {
			const [, childUniverseIds, children] = await client.readContract({ abi: zoltarAbi, address: configuration.zoltar, functionName: 'getDeployedChildUniverses', args: [universeId, start, 100n] })
			if (childUniverseIds.length !== children.length) throw new Error('Zoltar returned mismatched child universe arrays')
			for (const childUniverseId of childUniverseIds) {
				const key = childUniverseId.toString()
				if (seen.has(key)) throw new Error(`Zoltar universe ${key} appears more than once`)
				seen.add(key)
				universeIds.push(childUniverseId)
			}
			if (children.length < 100) break
		}
	}
	return universeIds
}

async function loadSecurityPoolDeploymentsInUniverse(client: PublicClient, configuration: DeploymentConfiguration, universeId: bigint, index: SecurityPoolDeploymentIndex<SecurityPoolDeployment, RegistryBlockAnchor>) {
	const canonical = async (anchor: RegistryBlockAnchor) => {
		try {
			const loadByNumber = getActiveBackend().id === 'simulation' ? undefined : async (blockNumber: bigint) => await latestBlockIdentity({ getBlock: async () => await client.getBlock({ blockNumber }) })
			return await registryBlockAnchorIsCanonical(anchor, async () => await latestBlockIdentity(client), loadByNumber)
		} catch (error) {
			if (error instanceof Error) return false
			throw error
		}
	}
	return await refreshSecurityPoolDeploymentEventIndex(
		index,
		`${configuration.chainId}:${configuration.securityPoolFactory}:${configuration.rpcUrl}:${universeId.toString()}`,
		async () => await latestBlockIdentity(client),
		canonical,
		async (fromBlock, toBlock) =>
			(
				await client.getLogs({
					address: configuration.securityPoolFactory,
					args: { universeId },
					event: securityPoolFactoryAbi[0],
					fromBlock,
					toBlock,
				})
			).map(securityPoolDeploymentFromEvent),
	)
}

export function selectUniverseDeployments<Deployment extends Readonly<{ universeId: bigint }>>(deployments: readonly Deployment[], requestedUniverseId: bigint | undefined) {
	const seen = new Set<string>()
	const universeIds: bigint[] = []
	for (const deployment of deployments) {
		const key = deployment.universeId.toString()
		if (seen.has(key)) continue
		seen.add(key)
		universeIds.push(deployment.universeId)
	}
	const selectedUniverseId = requestedUniverseId !== undefined && universeIds.includes(requestedUniverseId) ? requestedUniverseId : universeIds[0]
	const selectedDeployments = selectedUniverseId === undefined ? [] : deployments.filter(deployment => deployment.universeId === selectedUniverseId)
	return { universeIds, selectedUniverseId, selectedDeployments }
}

export async function discoverLiveUniverseMarketPage(client: PublicClient, configuration: DeploymentConfiguration, requestedUniverseId: bigint | undefined, requestedStart = 0n, pageSize = 25n, index = createSecurityPoolDeploymentIndex<SecurityPoolDeployment, RegistryBlockAnchor>()) {
	const universeIds = await loadUniverseIds(client, configuration)
	const selectedUniverseId = requestedUniverseId !== undefined && universeIds.includes(requestedUniverseId) ? requestedUniverseId : universeIds[0]
	const selectedDeployments = selectedUniverseId === undefined ? [] : await loadSecurityPoolDeploymentsInUniverse(client, configuration, selectedUniverseId, index)
	const page = marketDiscoveryPage(BigInt(selectedDeployments.length), requestedStart, pageSize)
	const pageEnd = page.start + page.count
	const pageDeployments = selectedDeployments.filter((_deployment, index) => {
		const position = BigInt(index)
		return position >= page.start && position < pageEnd
	})
	const results = await Promise.allSettled(pageDeployments.map(async deployment => await loadLiveMarket(client, configuration, deployment)))
	return { ...page, total: BigInt(selectedDeployments.length), markets: collateMarketDiscoveryResults(pageDeployments, results, configuration.feeBps), universeIds, selectedUniverseId }
}

export async function discoverAllLiveMarketsInUniverse(client: PublicClient, configuration: DeploymentConfiguration, requestedUniverseId: bigint | undefined, _pageSize = 25n, index = createSecurityPoolDeploymentIndex<SecurityPoolDeployment, RegistryBlockAnchor>()) {
	const universeIds = await loadUniverseIds(client, configuration)
	const selectedUniverseId = requestedUniverseId !== undefined && universeIds.includes(requestedUniverseId) ? requestedUniverseId : universeIds[0]
	const selectedDeployments = selectedUniverseId === undefined ? [] : await loadSecurityPoolDeploymentsInUniverse(client, configuration, selectedUniverseId, index)
	const results = await settleWithConcurrency(selectedDeployments, 6, async deployment => await loadLiveMarket(client, configuration, deployment))
	const total = BigInt(selectedDeployments.length)
	return { start: 0n, count: total, total, previousStart: undefined, nextStart: undefined, markets: collateMarketDiscoveryResults(selectedDeployments, results, configuration.feeBps), universeIds, selectedUniverseId }
}

export async function loadLiveBalances(client: PublicClient, market: LiveMarket, account: Address, routerAddress: Address): Promise<LiveBalances> {
	const scope = shareBalanceScope(market)
	const [invalid, yes, no, approved, lp, lpAllowance] = await Promise.all([
		client.readContract({ abi: shareTokenAbi, address: scope.shareToken, functionName: 'balanceOf', args: [account, scope.invalidTokenId] }),
		client.readContract({ abi: shareTokenAbi, address: scope.shareToken, functionName: 'balanceOf', args: [account, scope.yesTokenId] }),
		client.readContract({ abi: shareTokenAbi, address: scope.shareToken, functionName: 'balanceOf', args: [account, scope.noTokenId] }),
		client.readContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'isApprovedForAll', args: [account, routerAddress] }),
		market.pair === undefined ? 0n : client.readContract({ abi: pair.abi, address: market.pair, functionName: 'balanceOf', args: [account] }),
		market.pair === undefined ? 0n : client.readContract({ abi: pair.abi, address: market.pair, functionName: 'allowance', args: [account, routerAddress] }),
	])
	return { scope, invalid, yes, no, approved, lp, lpAllowance }
}

async function simulateEntryWithExpiry(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, side: 'YES' | 'NO', amount: bigint, expiry: TransactionExpiry, slippageBps: bigint) {
	requireTransactionSlippageBps(slippageBps)
	const pairAddress = market.pair
	if (pairAddress === undefined) throw new Error('Create and initialize the pair before trading')
	const {
		blockNumber,
		blockHash,
		result: { simulation, deadline },
	} = await stableSimulation(client, async block => {
		const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
		const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'enterPosition', account, args: [pairAddress, side === 'YES' ? 1 : 2, 0n, account, deadline], value: amount, blockHash: block.blockHash })
		return { simulation, deadline }
	})
	return { blockNumber, blockHash, result: simulation.result, amount, side, market, deadline, slippageBps, minimumLongShares: minimumAfterSlippage(simulation.result.totalLongShares, slippageBps) }
}

export async function simulateEntry(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, side: 'YES' | 'NO', amount: bigint, validityMinutes = 20n, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionValidityMinutes(validityMinutes)
	return await simulateEntryWithExpiry(client, configuration, market, account, side, amount, { validityMinutes }, slippageBps)
}

type GuardedWalletWrite = <T>(write: () => Promise<T>) => Promise<T>

export async function submitFreshEntry(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateEntry>>, guardedWrite: GuardedWalletWrite): Promise<Hash> {
	await requireQuoteBlock(client, quote)
	const refreshed = await simulateEntryWithExpiry(client, configuration, quote.market, account, quote.side, quote.amount, quote.deadline, quote.slippageBps)
	if (refreshed.blockNumber !== quote.blockNumber || refreshed.blockHash !== quote.blockHash) throw new Error('Quote changed blocks during revalidation')
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('Pair disappeared from the simulated market')
	const minimumLongShares = retainApprovedMinimum(quote.minimumLongShares, refreshed.result.totalLongShares, 'long shares')
	return await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'enterPosition', account, args: [pairAddress, quote.side === 'YES' ? 1 : 2, minimumLongShares, account, quote.deadline], value: quote.amount }))
}

async function simulateExitWithExpiry(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, side: 'YES' | 'NO', completeSets: bigint, expiry: TransactionExpiry, slippageBps: bigint) {
	requireTransactionSlippageBps(slippageBps)
	const pairAddress = market.pair
	if (pairAddress === undefined) throw new Error('Pair is unavailable')
	const {
		blockNumber,
		blockHash,
		result: { simulation, deadline },
	} = await stableSimulation(client, async block => {
		const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
		const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'exitPosition', account, args: [pairAddress, side === 'YES' ? 1 : 2, completeSets, (1n << 256n) - 1n, 0n, account, deadline], blockHash: block.blockHash })
		return { simulation, deadline }
	})
	return {
		blockNumber,
		blockHash,
		result: simulation.result,
		completeSets,
		side,
		market,
		deadline,
		slippageBps,
		maximumLongShares: maximumAfterSlippage(simulation.result.totalLongShares, slippageBps),
		minimumEth: minimumAfterSlippage(simulation.result.ethOut, slippageBps),
	}
}

export async function simulateExit(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, side: 'YES' | 'NO', completeSets: bigint, validityMinutes = 20n, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionValidityMinutes(validityMinutes)
	return await simulateExitWithExpiry(client, configuration, market, account, side, completeSets, { validityMinutes }, slippageBps)
}

export async function submitFreshExit(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateExit>>, guardedWrite: GuardedWalletWrite): Promise<Hash> {
	await requireQuoteBlock(client, quote)
	const refreshed = await simulateExitWithExpiry(client, configuration, quote.market, account, quote.side, quote.completeSets, quote.deadline, quote.slippageBps)
	if (refreshed.blockNumber !== quote.blockNumber || refreshed.blockHash !== quote.blockHash) throw new Error('Quote changed blocks during revalidation')
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('Pair disappeared from the simulated market')
	const maximumLongShares = retainApprovedMaximum(quote.maximumLongShares, refreshed.result.totalLongShares, 'long shares')
	const minimumEth = retainApprovedMinimum(quote.minimumEth, refreshed.result.ethOut, 'ETH output')
	return await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'exitPosition', account, args: [pairAddress, quote.side === 'YES' ? 1 : 2, quote.completeSets, maximumLongShares, minimumEth, account, quote.deadline] }))
}

export async function approveRouter(client: WalletClient, market: LiveMarket, configuration: DeploymentConfiguration, account: Address) {
	return await client.writeContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'setApprovalForAll', account, args: [configuration.router, true] })
}

export type LiquidityOperation = 'initialize' | 'add' | 'remove'

async function simulateLiquidityWithExpiry(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, operation: LiquidityOperation, amount: bigint, conditionalYesBps: bigint, expiry: TransactionExpiry, slippageBps: bigint) {
	requireTransactionSlippageBps(slippageBps)
	const pairAddress = market.pair
	if (operation === 'initialize') {
		const {
			blockNumber,
			blockHash,
			result: { simulation, deadline },
		} = await stableSimulation(client, async block => {
			const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
			const simulation =
				pairAddress === undefined
					? await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [market.pool, conditionalYesBps, 0n, account, deadline], value: amount, blockHash: block.blockHash })
					: await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [pairAddress, conditionalYesBps, 0n, account, deadline], value: amount, blockHash: block.blockHash })
			return { simulation, deadline }
		})
		return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n }
	}
	if (pairAddress === undefined) throw new Error('Pair is unavailable')
	if (operation === 'add') {
		const {
			blockNumber,
			blockHash,
			result: { simulation, deadline },
		} = await stableSimulation(client, async block => {
			const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
			const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, 0n, account, deadline], value: amount, blockHash: block.blockHash })
			return { simulation, deadline }
		})
		return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n }
	}
	const {
		blockNumber,
		blockHash,
		result: { simulation, deadline },
	} = await stableSimulation(client, async block => {
		const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
		const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'removeLiquidity', account, args: [pairAddress, amount, 0n, 0n, account, deadline], blockHash: block.blockHash })
		return { simulation, deadline }
	})
	return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: 0n, expectedYes: simulation.result[0], expectedNo: simulation.result[1] }
}

export async function simulateLiquidity(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, operation: LiquidityOperation, amount: bigint, conditionalYesBps = 5_000n, validityMinutes = 20n, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionValidityMinutes(validityMinutes)
	return await simulateLiquidityWithExpiry(client, configuration, market, account, operation, amount, conditionalYesBps, { validityMinutes }, slippageBps)
}

export async function submitFreshLiquidity(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateLiquidity>>, guardedWrite: GuardedWalletWrite) {
	await requireQuoteBlock(client, quote)
	const refreshed = await simulateLiquidityWithExpiry(client, configuration, quote.market, account, quote.operation, quote.amount, quote.conditionalYesBps, quote.deadline, quote.slippageBps)
	if (refreshed.blockNumber !== quote.blockNumber || refreshed.blockHash !== quote.blockHash) throw new Error('Quote changed blocks during revalidation')
	if (quote.operation === 'initialize') {
		const minimumLiquidity = retainApprovedMinimum(minimumAfterSlippage(quote.expectedLiquidity, quote.slippageBps), refreshed.expectedLiquidity, 'LP tokens')
		const initializedPairAddress = quote.market.pair
		return initializedPairAddress === undefined
			? await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [quote.market.pool, quote.conditionalYesBps, minimumLiquidity, account, quote.deadline], value: quote.amount }))
			: await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [initializedPairAddress, quote.conditionalYesBps, minimumLiquidity, account, quote.deadline], value: quote.amount }))
	}
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('Pair disappeared from the simulated market')
	if (quote.operation === 'add') {
		const minimumLiquidity = retainApprovedMinimum(minimumAfterSlippage(quote.expectedLiquidity, quote.slippageBps), refreshed.expectedLiquidity, 'LP tokens')
		return await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, minimumLiquidity, account, quote.deadline], value: quote.amount }))
	}
	const minimumYes = retainApprovedMinimum(minimumAfterSlippage(quote.expectedYes, quote.slippageBps), refreshed.expectedYes, 'YES')
	const minimumNo = retainApprovedMinimum(minimumAfterSlippage(quote.expectedNo, quote.slippageBps), refreshed.expectedNo, 'NO')
	return await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'removeLiquidity', account, args: [pairAddress, quote.amount, minimumYes, minimumNo, account, quote.deadline] }))
}

export async function approveLpRouter(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, amount: bigint) {
	if (market.pair === undefined) throw new Error('Pair is unavailable')
	return await client.writeContract({ abi: pair.abi, address: market.pair, functionName: 'approve', account, args: [configuration.router, amount] })
}

async function simulateSettlementWithExpiryParameters(
	client: WalletClient,
	configuration: DeploymentConfiguration,
	market: LiveMarket,
	account: Address,
	operation: SettlementOperation,
	parameters: Readonly<{ amount?: bigint; deadline?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {},
) {
	if (operation === 'redeem-complete-set') {
		requireTransactionSlippageBps(parameters.slippageBps ?? UI_SLIPPAGE_BPS)
		const amount = parameters.amount
		if (amount === undefined || amount <= 0n) throw new Error('Enter a positive complete-set share amount')
		const expiry: TransactionExpiry = parameters.deadline ?? { validityMinutes: parameters.validityMinutes ?? 20n }
		const slippageBps = parameters.slippageBps ?? UI_SLIPPAGE_BPS
		const {
			blockNumber,
			blockHash,
			result: { simulation, deadline },
		} = await stableSimulation(client, async block => {
			const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
			const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'redeemCompleteSet', account, args: [market.pool, amount, 0n, account, deadline], blockHash: block.blockHash })
			return { simulation, deadline }
		})
		if (simulation.result <= 0n) throw new Error('Complete-set redemption would return zero ETH')
		return { blockNumber, blockHash, operation, market, amount, deadline, slippageBps, expectedAttoEth: simulation.result, minimumAttoEth: minimumAfterSlippage(simulation.result, slippageBps) }
	}
	if (operation === 'redeem-winning-shares') {
		const { blockNumber, blockHash } = await stableSimulation(client, async block => await client.simulateContract({ abi: securityPoolAbi, address: market.pool, functionName: 'redeemShares', account, args: [], blockHash: block.blockHash }))
		return { blockNumber, blockHash, operation, market }
	}
	if (parameters.sourceOutcome === undefined || parameters.targetOutcomeIndexes === undefined) throw new Error('Select a source share and at least one fork target')
	const sourceOutcome = parameters.sourceOutcome
	const targetOutcomeIndexes = normalizeForkOutcomeIndexes(parameters.targetOutcomeIndexes)
	const sourceTokenId = (market.universeId << 8n) | outcomeValue(sourceOutcome)
	const { blockNumber, blockHash } = await stableSimulation(client, async block => await client.simulateContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'migrate', account, args: [sourceTokenId, targetOutcomeIndexes], blockHash: block.blockHash }))
	return { blockNumber, blockHash, operation, market, sourceOutcome, targetOutcomeIndexes }
}

export async function simulateSettlement(
	client: WalletClient,
	configuration: DeploymentConfiguration,
	market: LiveMarket,
	account: Address,
	operation: SettlementOperation,
	parameters: Readonly<{ amount?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {},
) {
	if (operation === 'redeem-complete-set') {
		const validityMinutes = parameters.validityMinutes ?? 20n
		requireTransactionValidityMinutes(validityMinutes)
		const amount = parameters.amount
		const slippageBps = parameters.slippageBps
		return await simulateSettlementWithExpiryParameters(client, configuration, market, account, operation, { ...(amount === undefined ? {} : { amount }), validityMinutes, ...(slippageBps === undefined ? {} : { slippageBps }) })
	}
	if (operation === 'migrate-shares') {
		const sourceOutcome = parameters.sourceOutcome
		const targetOutcomeIndexes = parameters.targetOutcomeIndexes
		return await simulateSettlementWithExpiryParameters(client, configuration, market, account, operation, { ...(sourceOutcome === undefined ? {} : { sourceOutcome }), ...(targetOutcomeIndexes === undefined ? {} : { targetOutcomeIndexes }) })
	}
	return await simulateSettlementWithExpiryParameters(client, configuration, market, account, operation)
}

export async function submitFreshSettlement(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateSettlement>>, guardedWrite: GuardedWalletWrite): Promise<Hash> {
	await requireQuoteBlock(client, quote)
	let parameters: Readonly<{ amount?: bigint; deadline?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {}
	if (quote.operation === 'redeem-complete-set') parameters = { amount: quote.amount, deadline: quote.deadline, slippageBps: quote.slippageBps }
	else if (quote.operation === 'migrate-shares') parameters = { sourceOutcome: quote.sourceOutcome, targetOutcomeIndexes: quote.targetOutcomeIndexes }
	const refreshed = await simulateSettlementWithExpiryParameters(client, configuration, quote.market, account, quote.operation, parameters)
	if (refreshed.blockNumber !== quote.blockNumber || refreshed.blockHash !== quote.blockHash) throw new Error('Settlement changed blocks during revalidation')
	if (quote.operation === 'redeem-complete-set') {
		if (refreshed.operation !== 'redeem-complete-set') throw new Error('Settlement operation changed during revalidation')
		const minimumEth = retainApprovedMinimum(quote.minimumAttoEth, refreshed.expectedAttoEth, 'ETH output')
		return await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'redeemCompleteSet', account, args: [quote.market.pool, quote.amount, minimumEth, account, quote.deadline] }))
	}
	if (quote.operation === 'redeem-winning-shares') {
		return await guardedWrite(async () => await client.writeContract({ abi: securityPoolAbi, address: quote.market.pool, functionName: 'redeemShares', account, args: [] }))
	}
	const sourceTokenId = (quote.market.universeId << 8n) | outcomeValue(quote.sourceOutcome)
	return await guardedWrite(async () => await client.writeContract({ abi: shareTokenAbi, address: quote.market.shareToken, functionName: 'migrate', account, args: [sourceTokenId, quote.targetOutcomeIndexes] }))
}
