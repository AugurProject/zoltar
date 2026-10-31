import type { DiscoveryRun } from './discovery-context.ts'

import { registryDiscoveryIssue } from './discovery-coverage.ts'

import * as abis from '@zoltar/bot-shared/contracts/abi'
import { bigintToSafeNumber, getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'

import { sameAddress } from '@zoltar/core-shared/evm/address'

import { canonicalUintString, compareUnsignedStrings, type CanonicalUintString } from '../core/units.ts'
import { validForkOutcomeRoutes } from '../operations/fork-outcomes.ts'
import { discoverChildPoolPreparations } from './discovery-child-preparation.ts'
import { discoverPoolPriceFeed } from './discovery-price-feed.ts'
import type { ChildRepSplitProgressSnapshot, PoolSnapshot, QuestionSnapshot, StagedOperationSnapshot, UniverseSnapshot } from '../operations/types.ts'
import { contractSimulationReverted, DISCOVERY_RPC_CONCURRENCY, drainConcurrent, mapWithConcurrency } from './discovery-client.ts'

import { discoverDirectEscalationDepositQuotes, emptyDirectEscalationDepositQuote, minimumSafeVaultDeposit, projectSettlementCollateral } from './discovery-escalation.ts'
import { forkMigrationWindowIsOpen, forkRepMigrationTarget } from './discovery-fork-migration.ts'
import { assertCanonicalPoolGraph, authenticatePoolProtocolBindings, cachePoolDeployment } from './discovery-graph.ts'
import { advanceVaultRegistryCursor, assertRegistryCountNotRegressed, collectCountedPages, cursorWithCanonicalCount, sameRegistryCursor, updateRegistryCommitment } from './discovery-registry.ts'

import { discoverStagedOperations, discoverVault } from './discovery-staged-operations.ts'
import { emptyCountedRegistryCursor, type CountedRegistryCursor } from './topology-schema.ts'

export async function discoverPools({
	context,
	blockNumber,
	anchorTimestamp,
	anchorBaseFeePerGas,
	limits,
	issues,
	universes,
	questions,
	topology,
	mutation,
}: DiscoveryRun & {
	anchorTimestamp: bigint
	anchorBaseFeePerGas: bigint
	universes: readonly UniverseSnapshot[]
	questions: readonly QuestionSnapshot[]
}) {
	const { client, deployments, wallet } = context
	const universeById = new Map(universes.map(universe => [universe.id, universe]))
	const questionById = new Map(questions.map(question => [question.id, question]))
	const childProgressByPool = new Map<string, ChildRepSplitProgressSnapshot[]>()
	for (const progress of context.indexedChildRepSplits ?? []) {
		const key = progress.pool.toLowerCase()
		const routes = childProgressByPool.get(key) ?? []
		routes.push(progress)
		childProgressByPool.set(key, routes)
	}
	for (const routes of childProgressByPool.values()) routes.sort((left, right) => compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex))
	const count = await client.readContract({ abi: abis.securityPoolFactoryAbi, address: deployments.securityPoolFactory, blockNumber, functionName: 'securityPoolDeploymentCount' })
	const questionCursor = topology.discoveryCursors.questions
	const dependenciesComplete = questionCursor.retentionMode === 'resident' && questionCursor.nextIndex === questionCursor.canonicalCount && !issues.some(issue => issue.kind === 'universe-limit')
	let cursor = topology.discoveryCursors.poolDeployments
	assertRegistryCountNotRegressed(cursor, count, 'Security-pool registry')
	const retentionMode: CountedRegistryCursor['retentionMode'] = count <= BigInt(limits.maxPools) && dependenciesComplete ? 'resident' : 'overflow'
	if (cursor.retentionMode === 'overflow' && retentionMode === 'resident') {
		cursor = emptyCountedRegistryCursor()
		topology.poolDeployments = []
		mutation.changed = true
	}
	if (retentionMode === 'overflow') {
		if (topology.poolDeployments.length > 0 || Object.keys(topology.pairsByPool).length > 0 || Object.keys(topology.vaultsByPool).length > 0 || Object.keys(topology.discoveryCursors.vaultsByPool).length > 0) mutation.changed = true
		topology.poolDeployments = []
		topology.pairsByPool = {}
		topology.vaultsByPool = {}
		topology.discoveryCursors.vaultsByPool = {}
	}
	const canonicalCursor = cursorWithCanonicalCount(cursor, count, limits.maxPools, retentionMode)
	if (!sameRegistryCursor(cursor, canonicalCursor)) mutation.changed = true
	cursor = canonicalCursor
	if (cursor.retentionMode === 'resident' && BigInt(topology.poolDeployments.length) !== BigInt(cursor.nextIndex)) throw new Error('Security-pool registry cursor does not match its retained canonical prefix')
	const collectedDeployments = await collectCountedPages({
		count,
		label: 'Pool discovery',
		maximumItems: limits.maxPools,
		pageSize: limits.maxPools,
		readPage: async (start, pageCount) => await client.readContract({ abi: abis.securityPoolFactoryAbi, address: deployments.securityPoolFactory, args: [start, pageCount], blockNumber, functionName: 'securityPoolDeploymentsRange' }),
		start: BigInt(cursor.nextIndex),
	})
	const newDeployments = collectedDeployments.values
	if (newDeployments.length > 0) {
		cursor = {
			...cursor,
			commitment: updateRegistryCommitment(
				cursor.commitment,
				BigInt(cursor.nextIndex),
				newDeployments.map(deployment => JSON.stringify(cachePoolDeployment(deployment))),
			),
			nextIndex: collectedDeployments.nextStart.toString(),
		}
		mutation.changed = true
	}
	topology.discoveryCursors.poolDeployments = cursor
	if (cursor.retentionMode === 'overflow' || !collectedDeployments.complete) {
		issues.push(dependenciesComplete ? registryDiscoveryIssue('pools', 'Pool', cursor) : { kind: 'pool-prerequisites', authenticated: cursor.nextIndex, canonicalCount: cursor.canonicalCount })
		return { pools: [], staged: [] }
	}
	const cachedDeploymentCount = topology.poolDeployments.length
	if (newDeployments.length > 0) mutation.changed = true
	const deploymentsPage = [...topology.poolDeployments.map(deployment => ({ ...deployment })), ...newDeployments.map(cachePoolDeployment)]
	if (BigInt(deploymentsPage.length) !== count) throw new Error('Security-pool registry cache did not reach the canonical deployment count')
	if (new Set(deploymentsPage.map(deployment => deployment.securityPool.toLowerCase())).size !== deploymentsPage.length) throw new Error('Security-pool registry contains duplicate immutable deployments')
	topology.poolDeployments = deploymentsPage.map(deployment => ({ ...deployment }))
	const pools: PoolSnapshot[] = []
	const staged: StagedOperationSnapshot[] = []
	for (const [deploymentIndex, deployment] of deploymentsPage.entries()) {
		const address = deployment.securityPool
		const coordinator = deployment.coordinator
		const cachedDeployment = deploymentIndex < cachedDeploymentCount
		const authenticatedUniverse = universeById.get(deployment.universeId)
		if (authenticatedUniverse === undefined) throw new Error(`Pool ${address} references undiscovered universe ${deployment.universeId}`)
		const [
			repToken,
			shareToken,
			universeId,
			questionId,
			escalationGame,
			truthAuction,
			systemState,
			awaitingForkContinuation,
			accounting,
			shareTokenSupply,
			totalRepBackingUnits,
			totalBadDebt,
			minimumDeposit,
			initialEscalationDeposit,
			priceValid,
			requestCost,
			settlementTime,
			lastPrice,
			lastSettlementTimestamp,
			priceValidUntil,
			stagedOperationCounter,
			minimumReport,
			gasConsumedOpenOracleReportPrice,
			settlementCallbackGasLimit,
			gasUnitsForOneDispute,
			initialReportPriorityFeeAttoEthPerGas,
			targetPriceErrorForDispute,
			openOracleSecurityMultiplierBps,
			protocolFee,
			feePercentage,
			escalationHaltMultiplierBps,
			pendingReportId,
			totalPoolHeldAttoRep,
			vaultCount,
			questionOutcome,
			forkDataResult,
			parentForkDataResult,
			ownForkMigrationStatusResult,
			entitlementStatusResult,
			currentMintingCapacity,
			securityMultiplier,
			unassignedPosition,
			poolFactory,
			poolForker,
			poolZoltar,
			poolQuestionData,
			poolCoordinator,
			coordinatorPool,
			vaultOperations,
			portfolioCustody,
			feeEndTimestamp,
		] = await drainConcurrent([
			cachedDeployment ? Promise.resolve(authenticatedUniverse.repToken) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'repToken' }),
			cachedDeployment ? Promise.resolve(deployment.shareToken) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'shareToken' }),
			cachedDeployment ? Promise.resolve(BigInt(deployment.universeId)) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'universeId' }),
			cachedDeployment ? Promise.resolve(BigInt(deployment.questionId)) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'questionId' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'escalationGame' }),
			cachedDeployment ? Promise.resolve(deployment.truthAuction) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'truthAuction' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'systemState' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'awaitingForkContinuation' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getPoolAccountingSnapshot' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'shareTokenSupplyAttoShares' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'totalRepBackingUnits' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'totalBadDebtAttoEth' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'minimumVaultRepDepositAttoRep' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'initialEscalationGameDepositAttoRep' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'isPriceValid' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'getRequestPriceCostAttoEth', gasPrice: anchorBaseFeePerGas }), // Explicit fees preserve block.basefee in eth_call.
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'settlementTime' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'lastPrice' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'lastSettlementTimestamp' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'priceValidUntil' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'stagedOperationCounter' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'minimumToken1ReportAttoEth', gasPrice: anchorBaseFeePerGas }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'gasConsumedOpenOracleReportPrice' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'getSettlementCallbackGasLimit' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'gasUnitsForOneDispute' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'initialReportPriorityFeeAttoEthPerGas' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'targetPriceErrorForDispute' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'openOracleSecurityMultiplierBps' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'protocolFee' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'feePercentage' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'escalationHaltMultiplierBps' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'pendingReportId' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getTotalPoolHeldAttoRep' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getVaultCount' }),
			client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getQuestionOutcome' }),
			client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'forkData' }),
			deployment.parent === zeroAddress ? Promise.resolve(undefined) : client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [deployment.parent], blockNumber, functionName: 'forkData' }),
			client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getOwnForkMigrationStatus' }),
			wallet === undefined ? Promise.resolve([false, 0n, [false, false, false]] as const) : client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address, wallet], blockNumber, functionName: 'getEscalationMigrationEntitlementStatus' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getCurrentMintingCapacityAttoEth' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'statoblastSecurityMultiplierBps' }),
			client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getUnassignedPosition' }),
			cachedDeployment ? Promise.resolve(deployments.securityPoolFactory) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'securityPoolFactory' }),
			cachedDeployment ? Promise.resolve(deployments.securityPoolForker) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'securityPoolForker' }),
			cachedDeployment ? Promise.resolve(deployments.zoltar) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'zoltar' }),
			cachedDeployment ? Promise.resolve(deployments.questionData) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'questionData' }),
			cachedDeployment ? Promise.resolve(coordinator) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'openOraclePriceCoordinator' }),
			cachedDeployment ? Promise.resolve(address) : client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'securityPool' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'vaultOperations' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'portfolioCustody' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getFeeEpochEndTime' }),
			authenticatePoolProtocolBindings({
				blockNumber,
				canonicalRepToken: authenticatedUniverse.repToken,
				client,
				configuredOpenOracle: deployments.openOracle,
				configuredWeth: deployments.weth,
				coordinator,
				pool: address,
			}),
		])
		const oracleRequestFunding = {
			escalationHaltMultiplierBps: escalationHaltMultiplierBps.toString(),
			feePercentage: feePercentage.toString(),
			gasConsumedOpenOracleReportPrice: gasConsumedOpenOracleReportPrice.toString(),
			gasUnitsForOneDispute: gasUnitsForOneDispute.toString(),
			initialReportPriorityFeeAttoEthPerGas: initialReportPriorityFeeAttoEthPerGas.toString(),
			openOracleSecurityMultiplierBps: openOracleSecurityMultiplierBps.toString(),
			protocolFee: protocolFee.toString(),
			settlementCallbackGasLimit: settlementCallbackGasLimit.toString(),
			targetPriceErrorForDispute: targetPriceErrorForDispute.toString(),
		}
		const retainedReportIds = (context.indexedReports ?? []).filter(report => report.token2.toLowerCase() === repToken.toLowerCase() && report.settlementTimestamp === '0').map(report => BigInt(report.reportId))
		const priceFeedSnapshot = await discoverPoolPriceFeed(client, coordinator, blockNumber, accounting.settlementCollateralAttoEth, oracleRequestFunding, minimumReport, requestCost, anchorBaseFeePerGas, pendingReportId, retainedReportIds)
		const [auctionableAttoRepAtFork, , , migratedAttoRep, , , , , ownFork, unresolvedEscalationAtFork, outcomeIndex, forkActivationTime] = forkDataResult
		const parentForkActivationTime = parentForkDataResult?.[11] ?? 0n
		const [statusOwnFork, statusAuctionableAttoRepAtFork, vaultRepAtForkAttoRep] = ownForkMigrationStatusResult
		const [, , materializedByOutcome] = entitlementStatusResult
		const forkData = { auctionableAttoRepAtFork, migratedAttoRep, outcomeIndex, ownFork, unresolvedEscalationAtFork }
		const ownForkMigrationStatus = { auctionableAttoRepAtFork: statusAuctionableAttoRepAtFork, ownFork: statusOwnFork, vaultRepAtForkAttoRep }
		const universe = authenticatedUniverse
		const forkRepMigrationTargetAttoRep = forkRepMigrationTarget(forkData, ownForkMigrationStatus, address)
		const forkRepMigrationProgressByOutcome = Object.fromEntries((childProgressByPool.get(address.toLowerCase()) ?? []).map(progress => [progress.outcomeIndex, progress.childPoolRepSplitAttoRep]))
		assertCanonicalPoolGraph({
			configuredFactory: deployments.securityPoolFactory,
			configuredForker: deployments.securityPoolForker,
			configuredQuestionData: deployments.questionData,
			configuredZoltar: deployments.zoltar,
			coordinatorPool: getAddress(coordinatorPool),
			deploymentCoordinator: coordinator,
			deploymentQuestionId: deployment.questionId,
			deploymentShareToken: deployment.shareToken,
			deploymentTruthAuction: deployment.truthAuction,
			deploymentUniverseId: deployment.universeId,
			pool: address,
			poolCoordinator: getAddress(poolCoordinator),
			poolFactory: getAddress(poolFactory),
			poolForker: getAddress(poolForker),
			poolQuestionData: getAddress(poolQuestionData),
			poolQuestionId: questionId.toString(),
			poolRepToken: getAddress(repToken),
			poolShareToken: getAddress(shareToken),
			poolTruthAuction: getAddress(truthAuction),
			poolUniverseId: universeId.toString(),
			poolZoltar: getAddress(poolZoltar),
			universeRepToken: universe.repToken,
		})
		const escalationAddress = getAddress(escalationGame)
		const [
			escalationCanTriggerOwnFork,
			escalationForkContinuation,
			escalationForkCarryFundingComplete,
			escalationForkResumedAt,
			escalationGameEndTime,
			escalationHasReachedNonDecision,
			escalationNonDecisionState,
			escalationStartBondAttoRep,
			escalationNonDecisionThresholdAttoRep,
			escalationOutcomeBalancesAttoRep,
			escalationResolved,
			forkCarrySnapshotInitialized,
			escalationFinalQuestionResolution,
		] =
			escalationAddress === zeroAddress
				? [false, false, false, 0n, 0n, false, 0n, 0n, 0n, [0n, 0n, 0n] as const, false, false, 3n]
				: await drainConcurrent([
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'canTriggerOwnFork' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkContinuation' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'isForkCarryFundingComplete' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkResumedAt' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getEscalationGameEndDate' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'hasReachedNonDecision' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'nonDecisionState' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'startBondAttoRep' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'nonDecisionThresholdAttoRep' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getOutcomeBalancesAttoRep' }),
						client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'isEscalationResolved' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkCarrySnapshotInitialized' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getFinalQuestionResolution' }),
					])
		const [poolRepBalanceAttoRep, escalationRepBalanceAttoRep, unassignedRepBackingAttoRep] = await drainConcurrent([
			client.readContract({ abi: abis.genesisReputationTokenAbi, address: getAddress(repToken), args: [address], blockNumber, functionName: 'balanceOf' }),
			escalationAddress === zeroAddress ? Promise.resolve(0n) : client.readContract({ abi: abis.genesisReputationTokenAbi, address: getAddress(repToken), args: [escalationAddress], blockNumber, functionName: 'balanceOf' }),
			client.readContract({ abi: abis.securityPoolAbi, address, args: [unassignedPosition[0]], blockNumber, functionName: 'backingUnitsToAttoRep' }),
		])
		let escalationResidualSweepExpectedSuccess = false
		if (wallet !== undefined && escalationAddress !== zeroAddress) {
			try {
				await client.simulateContract({ abi: abis.escalationGameAbi, account: wallet, address: escalationAddress, blockNumber, functionName: 'sweepResidualRepToSecurityPool' })
				escalationResidualSweepExpectedSuccess = true
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
				// Principal, escrow, finality, and zero-balance guards fail closed.
			}
		}
		const safeEscalationDepositMaximumsAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = [canonicalUintString(0n), canonicalUintString(0n), canonicalUintString(0n)]
		const escalationMaximum = escalationAddress === zeroAddress ? initialEscalationDeposit : escalationStartBondAttoRep
		if (wallet !== undefined && systemState === 0n && !awaitingForkContinuation && escalationMaximum > 0n) {
			await drainConcurrent(
				[0, 1, 2].map(async outcome => {
					try {
						await client.simulateContract({ abi: abis.securityPoolAbi, account: wallet, address, args: [outcome, escalationMaximum], blockNumber, functionName: 'depositToEscalationGame' })
						safeEscalationDepositMaximumsAttoRep[outcome] = escalationMaximum.toString()
					} catch (error) {
						if (!contractSimulationReverted(error)) throw error
						// Invalid, unhealthy, and below-minimum deposits remain ineligible.
					}
				}),
			)
		}
		const directEscalationDepositQuotes =
			wallet !== undefined && escalationAddress !== zeroAddress && systemState === 0n && !awaitingForkContinuation && !escalationForkContinuation && universe.forkTime === '0'
				? await discoverDirectEscalationDepositQuotes(client, wallet, escalationAddress, escalationMaximum, escalationOutcomeBalancesAttoRep, escalationNonDecisionThresholdAttoRep, blockNumber)
				: ([emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote()] satisfies PoolSnapshot['directEscalationDepositQuotes'])
		const pendingReportSettled = pendingReportId === 0n ? false : (await client.readContract({ abi: abis.openOracleAbi, address: deployments.openOracle, args: [pendingReportId], blockNumber, functionName: 'storedGame' })).settlementTimestamp !== 0n
		const vaultCacheKey = address.toLowerCase()
		const vaultRegistry = await advanceVaultRegistryCursor({
			cachedVaults: topology.vaultsByPool[vaultCacheKey] ?? [],
			canonicalCount: vaultCount,
			cursor: topology.discoveryCursors.vaultsByPool[vaultCacheKey],
			label: `Vault registry ${address}`,
			limit: limits.maxVaultsPerPool,
			readNewestFirstPage: async (start, pageCount) => await client.readContract({ abi: abis.securityPoolAbi, address, args: [start, pageCount], blockNumber, functionName: 'getVaults' }),
		})
		if (vaultRegistry.changed) mutation.changed = true
		topology.discoveryCursors.vaultsByPool[vaultCacheKey] = vaultRegistry.cursor
		topology.vaultsByPool[vaultCacheKey] = [...vaultRegistry.vaults]
		if (vaultRegistry.cursor.retentionMode === 'overflow' || !vaultRegistry.complete) issues.push(registryDiscoveryIssue('vaults', `Vault ${address}`, vaultRegistry.cursor))
		const inspectEveryVault = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && forkMigrationWindowIsOpen(systemState, forkActivationTime, anchorTimestamp)
		const uniqueVaults = new Map<string, Address>()
		if (wallet !== undefined) uniqueVaults.set(wallet.toLowerCase(), wallet)
		if (inspectEveryVault) {
			for (const vault of vaultRegistry.vaults) uniqueVaults.set(vault.toLowerCase(), getAddress(vault))
		}
		const vaults = await mapWithConcurrency([...uniqueVaults.values()], DISCOVERY_RPC_CONCURRENCY, async vault => await discoverVault(client, address, escalationAddress, vault, blockNumber))
		const vaultDiscoveryComplete = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && (inspectEveryVault || vaultRegistry.vaults.every(vault => wallet !== undefined && sameAddress(vault, wallet)))
		const walletVaultRegistered = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && vaultRegistry.vaults.some(vault => wallet !== undefined && sameAddress(vault, wallet))
		const walletVault = vaults.find(vault => wallet !== undefined && sameAddress(vault.address, wallet))
		if (wallet !== undefined && walletVault === undefined) throw new Error(`Pool ${address} omitted the requested wallet vault`)
		const minimumSafeWalletVaultDepositAttoRep = minimumSafeVaultDeposit(minimumDeposit, BigInt(walletVault?.repBackingUnits ?? '0'), totalRepBackingUnits, totalPoolHeldAttoRep)
		const forkQuestion = questionById.get(universe.forkQuestionId)
		const linearFee =
			portfolioCustody === zeroAddress
				? undefined
				: await drainConcurrent([client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'linearFeeRateAttoEthPerSecond' }), client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'linearFeeEndTime' })]).then(([rateAttoEthPerSecond, endTime]) => ({
						rateAttoEthPerSecond,
						endTime,
					}))
		const projectedSettlementCollateral = projectSettlementCollateral(accounting, feeEndTimestamp, anchorTimestamp, linearFee)
		const unresolvedEscalationMigrationReadyOutcomes: string[] = []
		if (wallet !== undefined && inspectEveryVault && forkData.unresolvedEscalationAtFork) {
			for (const outcome of validForkOutcomeRoutes(forkQuestion, universe.knownChildOutcomes)) {
				try {
					await client.simulateContract({ abi: abis.securityPoolForkerAbi, account: wallet, address: deployments.securityPoolForker, args: [address, wallet, BigInt(outcome)], blockNumber, functionName: 'migrateVaultWithUnresolvedEscalation' })
					unresolvedEscalationMigrationReadyOutcomes.push(outcome)
				} catch (error) {
					if (!contractSimulationReverted(error)) throw error
					// Already-materialized and otherwise invalid routes fail closed.
				}
			}
		}
		const pool: PoolSnapshot = {
			address,
			awaitingForkContinuation,
			canonicalVaultCount: vaultCount.toString(),
			coordinator,
			...priceFeedSnapshot,
			childPoolPreparations: await discoverChildPoolPreparations(client, deployments.securityPoolFactory, deployments.zoltar, address, universeId, systemState === 1n ? validForkOutcomeRoutes(forkQuestion, universe.knownChildOutcomes) : [], blockNumber),
			vaultOperations: getAddress(vaultOperations),
			currentMintingCapacityAttoEth: currentMintingCapacity.toString(),
			escalationCanTriggerOwnFork,
			escalationForkContinuation,
			escalationForkCarryFundingComplete,
			escalationForkResumedAt: escalationForkResumedAt.toString(),
			escalationGameEndTime: escalationGameEndTime.toString(),
			escalationHasReachedNonDecision,
			escalationNonDecisionState: bigintToSafeNumber(escalationNonDecisionState),
			escalationStartBondAttoRep: escalationStartBondAttoRep.toString(),
			escalationNonDecisionThresholdAttoRep: escalationNonDecisionThresholdAttoRep.toString(),
			escalationOutcomeBalancesAttoRep: [escalationOutcomeBalancesAttoRep[0].toString(), escalationOutcomeBalancesAttoRep[1].toString(), escalationOutcomeBalancesAttoRep[2].toString()],
			directEscalationDepositQuotes,
			safeEscalationDepositMaximumsAttoRep,
			escalationGame: escalationAddress,
			escalationResolved,
			forkCarrySnapshotInitialized,
			escalationFinalQuestionResolution: bigintToSafeNumber(escalationFinalQuestionResolution),
			forkActivationTime: forkActivationTime.toString(),
			feeIndex: accounting.feeIndex.toString(),
			forkOutcomeIndex: forkData.outcomeIndex.toString(),
			forkOwnQuestion: forkData.ownFork,
			forkMigratedAttoRep: forkData.migratedAttoRep.toString(),
			forkRepMigrationProgressByOutcome,
			forkRepMigrationTargetAttoRep: forkRepMigrationTargetAttoRep.toString(),
			forkUnresolvedEscalation: forkData.unresolvedEscalationAtFork,
			lastRepPerEthPrice: lastPrice.toString(),
			lastOracleSettlementTimestamp: lastSettlementTimestamp.toString(),
			oraclePriceValidUntilTimestamp: priceValidUntil.toString(),
			lastUpdatedFeeAccumulator: accounting.lastUpdatedFeeAccumulator.toString(),
			minimumToken1ReportAttoEth: minimumReport.toString(),
			minimumSafeWalletVaultDepositAttoRep: minimumSafeWalletVaultDepositAttoRep.toString(),
			minimumVaultRepDepositAttoRep: minimumDeposit.toString(),
			oraclePriceValid: priceValid,
			oracleSettlementTime: settlementTime.toString(),
			parent: getAddress(deployment.parent),
			parentForkActivationTime: parentForkActivationTime.toString(),
			pendingReportId: pendingReportId.toString(),
			pendingReportSettled,
			poolRepBalanceAttoRep: poolRepBalanceAttoRep.toString(),
			questionId: questionId.toString(),
			questionOutcome: bigintToSafeNumber(questionOutcome),
			repToken: getAddress(repToken),
			requestPriceCostAttoEth: requestCost.toString(),
			projectedSettlementCollateralAttoEth: projectedSettlementCollateral.toString(),
			settlementCollateralAttoEth: accounting.settlementCollateralAttoEth.toString(),
			shareTokenSupplyAttoShares: shareTokenSupply.toString(),
			statoblastSecurityMultiplierBps: securityMultiplier.toString(),
			totalUnderwritingLimitAttoEth: accounting.totalUnderwritingLimitAttoEth.toString(),
			totalPoolHeldAttoRep: totalPoolHeldAttoRep.toString(),
			totalRepBackingUnits: totalRepBackingUnits.toString(),
			totalBadDebtAttoEth: totalBadDebt.toString(),
			escalationRepBalanceAttoRep: escalationRepBalanceAttoRep.toString(),
			escalationResidualSweepExpectedSuccess,
			shareToken: getAddress(shareToken),
			systemState: bigintToSafeNumber(systemState),
			truthAuction: getAddress(truthAuction),
			unassignedBadDebtAttoEth: (unassignedPosition[3] === accounting.badDebtGeneration ? unassignedPosition[2] : 0n).toString(),
			unassignedUnderwritingLimitAttoEth: unassignedPosition[1].toString(),
			unassignedRepBackingAttoRep: unassignedRepBackingAttoRep.toString(),
			unresolvedEscalationMigrationReadyOutcomes,
			universeId: universeId.toString(),
			stagedOperationCounter: stagedOperationCounter.toString(),
			vaultDiscoveryComplete,
			vaults,
			walletEscalationMaterializedOutcomes: [...materializedByOutcome],
			walletVaultRegistered,
		}
		pools.push(pool)
		staged.push(...(await discoverStagedOperations(client, pool, blockNumber, limits.maxStagedOperationsPerPool, issues)))
	}
	return { pools, staged }
}
