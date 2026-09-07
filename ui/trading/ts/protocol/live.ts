import { getAddress, zeroAddress, type Address, type Hash, type PublicClient, type WalletClient } from '@zoltar/shared/ethereum'
import { tradingContracts } from '../generated/contractArtifact.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_SecurityPool_SecurityPool, ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import { bigintToSafeNumber } from '../lib/format.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { fetchLogsWithAdaptiveRanges } from '@zoltar/shared/logScan'
export { connectWallet, connectedWalletAccount, switchWalletChain, walletChainId } from './wallet.js'
import { SECURITY_POOL_QUESTION_OUTCOME_ABI } from '@zoltar/ui-core-shared/protocol/securityPoolAbi.js'
import { shareBalanceScope, type LiveBalances, type LiveMarket } from './liveMarket.js'
import { deadlineAtBlock, latestBlockIdentity, maximumAfterSlippage, minimumAfterSlippage, requireQuoteBlock, requireTransactionSlippageBps, requireTransactionValidityMinutes, retainApprovedMaximum, retainApprovedMinimum, stableSimulation, UI_SLIPPAGE_BPS, type TransactionExpiry } from './tradeQuote.js'
import { capabilitiesForTradingVersion } from '@zoltar/ui-trading-domain/capabilities.js'
import { configuredFactory, configuredPair, configuredShareOperationRouter, receiveBasedExitArguments, shareTokenAbi } from './versionedAuthorization.js'

export { createTradingPublicClient, createTradingWalletClient, loadWalletHeaderBalances, validateLiveDeployment, validateRpcChainId } from './runtimeClients.js'
export { publicErrorMessage } from './publicError.js'
export { settlementAvailability, simulateSettlement, submitFreshSettlement, type SettlementOperation, type ShareOutcome } from './settlement.js'
export { simulateLiquidity, submitFreshLiquidity, type LiquidityOperation } from './liquidity.js'
import { publicErrorMessage } from './publicError.js'

export { liveBalancesForMarket, marketAcceptsNewRisk, marketNewRiskBlocker, shareBalanceScope, type LiveBalances, type LiveMarket } from './liveMarket.js'
export { maximumAfterSlippage, minimumAfterSlippage, requireTransactionSlippageBps, requireTransactionValidityMinutes, retainApprovedMaximum, retainApprovedMinimum } from './tradeQuote.js'

const securityPoolFactoryAbi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
const securityPoolAbi = statoblast_SecurityPool_SecurityPool.abi
const zoltarAbi = Zoltar_Zoltar.abi
const questionDataAbi = ZoltarQuestionData_ZoltarQuestionData.abi
const deploySecurityPoolEvent = securityPoolFactoryAbi.find((entry: (typeof securityPoolFactoryAbi)[number]) => entry.type === 'event' && entry.name === 'DeploySecurityPool')
if (deploySecurityPoolEvent === undefined) throw new Error('DeploySecurityPool event missing from ABI')

const MAXIMUM_DEPLOYMENT_LOG_RANGE = 10_000n

const pair = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
async function loadLiveSecurityPoolSettings(client: PublicClient, pool: Address) {
	const [questionData, zoltar, parent, shareTokenSupplyAttoShares, mintingCapacityCeilingAttoEth, accounting, systemState, awaitingForkContinuation, vaultCount, forker] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'questionData' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'zoltar' }),
		client.readContract({ abi: securityPoolAbi, address: pool, functionName: 'parent' }),
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
		parent,
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

async function loadOriginUniverseId(client: PublicClient, parent: Address, currentUniverseId: bigint) {
	let originUniverseId = currentUniverseId
	let ancestor = parent
	const visited = new Set<string>()
	while (ancestor !== zeroAddress) {
		const key = ancestor.toLowerCase()
		if (visited.has(key)) throw new Error('SecurityPool parent lineage contains a cycle')
		visited.add(key)
		const [universeId, nextParent] = await Promise.all([client.readContract({ abi: securityPoolAbi, address: ancestor, functionName: 'universeId' }), client.readContract({ abi: securityPoolAbi, address: ancestor, functionName: 'parent' })])
		originUniverseId = universeId
		ancestor = getAddress(nextParent)
	}
	return originUniverseId
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
	const factoryArtifact = configuredFactory(configuration)
	const pairArtifact = configuredPair(configuration)
	const [poolSettings, pairAddress] = await Promise.all([loadLiveSecurityPoolSettings(client, pool), client.readContract({ abi: factoryArtifact.abi, address: configuration.factory, functionName: 'getPair', args: [pool] })])
	const { questionData, zoltar, parent, shareTokenSupplyAttoShares, settlementCollateralAttoEth, currentRetentionRate, totalCapacityOwnershipAttoRep, feeEligibleCapacityOwnershipAttoRep, mintingCapacityCeilingAttoEth, availableMintingCapacityAttoEth, systemState, awaitingForkContinuation, vaultCount, forker } =
		poolSettings
	const [question, questionOutcome, universeForkTime, originUniverseId] = await Promise.all([
		client.readContract({ abi: questionDataAbi, address: getAddress(questionData), functionName: 'questions', args: [questionId] }),
		client.readContract({ abi: SECURITY_POOL_QUESTION_OUTCOME_ABI, address: getAddress(forker), functionName: 'getQuestionOutcome', args: [pool] }),
		client.readContract({ abi: zoltarAbi, address: getAddress(zoltar), functionName: 'getForkTime', args: [universeId] }),
		loadOriginUniverseId(client, getAddress(parent), universeId),
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
			client.readContract({ abi: pairArtifact.abi, address: canonicalPair, functionName: 'getEffectiveReserves' }),
			client.readContract({ abi: pairArtifact.abi, address: canonicalPair, functionName: 'totalSupply' }),
			client.readContract({ abi: pairArtifact.abi, address: canonicalPair, functionName: 'feeBps' }),
			client.readContract({ abi: pairArtifact.abi, address: canonicalPair, functionName: 'tradingStatus' }),
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
		originUniverseId,
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

function clearSecurityPoolDeploymentIndex<Deployment, Anchor>(index: SecurityPoolDeploymentIndex<Deployment, Anchor>, key: string) {
	index.key = key
	index.deployments = []
	index.anchor = undefined
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
		if (index.key !== key) clearSecurityPoolDeploymentIndex(index, key)
		let currentDeployments = index.deployments
		let currentAnchor = index.anchor
		if (currentAnchor !== undefined && !(await isAnchorCanonical(currentAnchor))) {
			clearSecurityPoolDeploymentIndex(index, key)
			currentDeployments = []
			currentAnchor = undefined
		}
		const { anchor, total } = await loadSnapshot()
		if (total < BigInt(currentDeployments.length)) {
			clearSecurityPoolDeploymentIndex(index, key)
			currentDeployments = []
		}
		const knownCount = BigInt(currentDeployments.length)
		const ranges = marketDiscoveryRanges(total - knownCount, pageSize).map(range => ({ start: knownCount + range.start, count: range.count }))
		const pages = await mapWithConcurrency(ranges, 4, async range => await loadRange(range.start, range.count, anchor))
		const appended = pages.flat()
		if (BigInt(appended.length) !== total - knownCount) throw new Error('SecurityPool deployment registry returned an incomplete range')
		if (!(await isAnchorCanonical(anchor))) throw new Error('SecurityPool deployment registry changed during discovery')
		const nextDeployments = [...currentDeployments, ...appended]
		index.key = key
		index.deployments = nextDeployments
		index.anchor = anchor
		snapshot = nextDeployments.slice()
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
		if (index.key !== key) clearSecurityPoolDeploymentIndex(index, key)
		let currentDeployments = index.deployments
		let currentAnchor = index.anchor
		if (currentAnchor !== undefined && !(await isAnchorCanonical(currentAnchor))) {
			clearSecurityPoolDeploymentIndex(index, key)
			currentDeployments = []
			currentAnchor = undefined
		}
		const anchor = await loadLatest()
		const fromBlock = currentAnchor === undefined ? 0n : currentAnchor.blockNumber + 1n
		let appended = fromBlock <= anchor.blockNumber ? await fetchLogsWithAdaptiveRanges(fromBlock, anchor.blockNumber, MAXIMUM_DEPLOYMENT_LOG_RANGE, async range => await loadEvents(range.fromBlock, range.toBlock)) : []
		if (currentAnchor !== undefined && !(await isAnchorCanonical(currentAnchor))) {
			clearSecurityPoolDeploymentIndex(index, key)
			currentDeployments = []
			appended = await fetchLogsWithAdaptiveRanges(0n, anchor.blockNumber, MAXIMUM_DEPLOYMENT_LOG_RANGE, async range => await loadEvents(range.fromBlock, range.toBlock))
		}
		if (!(await isAnchorCanonical(anchor))) {
			clearSecurityPoolDeploymentIndex(index, key)
			throw new Error('SecurityPool deployment events changed during discovery')
		}
		const nextDeployments = [...currentDeployments, ...appended]
		index.key = key
		index.deployments = nextDeployments
		index.anchor = anchor
		snapshot = nextDeployments.slice()
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
					event: deploySecurityPoolEvent,
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
		if (capabilitiesForTradingVersion(configuration.version).receiveBasedShareOperations) {
			const quote = await client.simulateContract({ abi: pair.abi, address: pairAddress, functionName: 'quoteExactOutput', account, args: [side === 'YES', completeSets], blockHash: block.blockHash })
			const longSharesSwapped = quote.result[0]
			const totalLongShares = completeSets + longSharesSwapped
			const estimatedEthOut = market.shareTokenSupplyAttoShares === 0n ? 0n : (completeSets * market.settlementCollateralAttoEth) / market.shareTokenSupplyAttoShares
			const maximumLongShares = maximumAfterSlippage(totalLongShares, slippageBps)
			const minimumEth = minimumAfterSlippage(estimatedEthOut, slippageBps)
			const transfer = receiveBasedExitArguments(market, side, completeSets, maximumLongShares, minimumEth, account, deadline)
			const simulation = await client.simulateContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'safeBatchTransferFrom', account, args: [account, configuredShareOperationRouter(configuration), transfer.ids, transfer.amounts, transfer.data], blockHash: block.blockHash })
			void simulation
			return { simulation: { result: { completeSetShares: completeSets, longSharesSwapped, totalLongShares, invalidInsurance: completeSets, ethOut: estimatedEthOut, feeAmount: quote.result[1] } }, deadline }
		}
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
	if (capabilitiesForTradingVersion(configuration.version).receiveBasedShareOperations) {
		const transfer = receiveBasedExitArguments(quote.market, quote.side, quote.completeSets, maximumLongShares, minimumEth, account, quote.deadline)
		return await guardedWrite(async () => await client.writeContract({ abi: shareTokenAbi, address: quote.market.shareToken, functionName: 'safeBatchTransferFrom', account, args: [account, configuredShareOperationRouter(configuration), transfer.ids, transfer.amounts, transfer.data] }))
	}
	return await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'exitPosition', account, args: [pairAddress, quote.side === 'YES' ? 1 : 2, quote.completeSets, maximumLongShares, minimumEth, account, quote.deadline] }))
}

export async function approveRouter(client: WalletClient, market: LiveMarket, configuration: DeploymentConfiguration, account: Address) {
	return await client.writeContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'setApprovalForAll', account, args: [configuration.router, true] })
}
