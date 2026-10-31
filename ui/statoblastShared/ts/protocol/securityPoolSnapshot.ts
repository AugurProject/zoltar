import { requireAddressValue } from './decoders.js'
import { loadCentralPortfolioQuestion } from './securityPoolPortfolioState.js'
import { decodeLinearFeeState, linearFeeReadContracts } from './linearFeeState.js'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool, statoblast_SecurityPoolForker_SecurityPoolForker } from '../contractArtifact.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { SECURITY_POOL_QUESTION_OUTCOME_ABI } from './securityPoolAbi.js'
import { deriveHasForkActivity } from './forkActivity.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool } from '../types/contracts.js'

import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { requireForkDataView } from './forkData.js'
import { getReportingOutcomeKey, getSecurityPoolSystemState } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { getForkOutcomeKey } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { type SecurityPoolDeploymentTuple } from './helpers.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { getSecurityPoolVaultCount, loadSecurityPoolVaultSummaries } from './securityVaultQueries.js'

function shouldLoadSecurityPoolVaults(
	deployment: Pick<SecurityPoolDeploymentTuple, 'parent' | 'securityPool'>,
	options: {
		selectedSecurityPoolAddress?: Address | string
		vaultDetailMode: 'all' | 'selected'
	},
) {
	if (options.vaultDetailMode === 'all') return true
	if (options.selectedSecurityPoolAddress === undefined) return false
	return sameAddress(deployment.securityPool, options.selectedSecurityPoolAddress) || sameAddress(deployment.parent, options.selectedSecurityPoolAddress)
}

function createDeferredSecurityPoolVaultSummary(vaultCount: bigint): Awaited<ReturnType<typeof loadSecurityPoolVaultSummaries>> {
	return {
		hasLoadedVaults: vaultCount === 0n,
		vaultScanCapped: false,
		vaultCount,
		vaults: [],
	}
}

async function readSecurityPoolSnapshot(client: ReadClient, deployment: SecurityPoolDeploymentTuple) {
	const { securityPool: securityPoolAddress, universeId, openOraclePriceCoordinator: managerAddress } = deployment
	const [
		settlementCollateralAttoEth,
		currentRetentionRate,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		forkData,
		lastOraclePrice,
		lastSettlementTimestamp,
		questionOutcome,
		systemStateValue,
		shareTokenSupplyAttoShares,
		totalPoolHeldAttoRep,
		poolAccountingSnapshot,
		universeForkTime,
		escalationGameAddress,
		feeEndTimestamp,
		portfolioCustody,
		linearRate,
		linearEnd,
		priceValidUntil,
	] = await readRequiredMulticall(client, [
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'settlementCollateralAttoEth',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'currentRetentionRate',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'minimumSecurityBondDebtAttoEth',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'minimumVaultRepDepositAttoRep',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'forkData',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastPrice',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: managerAddress,
			args: [],
		},
		{
			abi: SECURITY_POOL_QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'systemState',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'shareTokenSupplyAttoShares',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalPoolHeldAttoRep',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'getPoolAccountingSnapshot',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: Zoltar_Zoltar.abi,
			functionName: 'getForkTime',
			address: getInfraContractAddresses().zoltar,
			args: [universeId],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'getFeeEpochEndTime',
			address: securityPoolAddress,
			args: [],
		},
		...linearFeeReadContracts(securityPoolAddress),
		{ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'priceValidUntil', address: managerAddress, args: [] },
	])
	const block = portfolioCustody === zeroAddress ? undefined : await client.getBlock()
	const blockNumber = block?.number
	if (block !== undefined && blockNumber === undefined) throw new Error('Portfolio snapshot requires a mined block.')
	const central = blockNumber === undefined ? undefined : await loadCentralPortfolioQuestion(client, securityPoolAddress, requireAddressValue(portfolioCustody, 'portfolio custody'), blockNumber)
	return {
		centralSettlement: central !== undefined,
		centralMintingCapacity: central?.mintingCapacityAttoEth,
		linearFee: central?.linearFee ?? decodeLinearFeeState(portfolioCustody, linearRate, linearEnd),
		settlementCollateralAttoEth: central?.settlementCollateralAttoEth ?? settlementCollateralAttoEth,
		settlementRecoveryAttoRep: central?.settlementRecoveryAttoRep ?? 0n,
		currentRetentionRate,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		forkData,
		lastOraclePrice,
		lastSettlementTimestamp,
		priceValidUntil,
		questionOutcome,
		systemStateValue,
		shareTokenSupplyAttoShares: central?.shareTokenSupplyAttoShares ?? shareTokenSupplyAttoShares,
		totalPoolHeldAttoRep: central?.totalPoolHeldAttoRep ?? totalPoolHeldAttoRep,
		poolAccountingSnapshot:
			central === undefined
				? poolAccountingSnapshot
				: { ...poolAccountingSnapshot, settlementCollateralAttoEth: central.settlementCollateralAttoEth, totalUnderwritingLimitAttoEth: central.totalUnderwritingLimitAttoEth, feeEligibleUnderwritingLimitAttoEth: central.feeEligibleUnderwritingLimitAttoEth, lastUpdatedFeeAccumulator: central.lastUpdatedFeeAccumulator },
		universeForkTime,
		escalationGameAddress,
		feeEndTimestamp: central?.feeEndTimestamp ?? feeEndTimestamp,
	}
}

export async function loadSecurityPoolDetails(
	client: ReadClient,
	deployment: SecurityPoolDeploymentTuple,
	options: {
		accountAddress?: Address
		selectedSecurityPoolAddress?: Address | string
		vaultDetailMode: 'all' | 'selected'
		vaultPreviewLimit: bigint
	},
): Promise<ListedSecurityPool> {
	const { securityPool: securityPoolAddress, questionId } = deployment
	const shouldLoadVaults = shouldLoadSecurityPoolVaults(deployment, options)
	const [snapshot, marketDetails, vaultSummaries] = await Promise.all([
		readSecurityPoolSnapshot(client, deployment),
		loadMarketDetails(client, questionId),
		shouldLoadVaults
			? loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
					...(options.accountAddress === undefined ? {} : { accountAddress: options.accountAddress }),
					previewLimit: options.vaultPreviewLimit,
				})
			: getSecurityPoolVaultCount(client, securityPoolAddress).then(createDeferredSecurityPoolVaultSummary),
	])
	const hasForkContinuationEscalationGame = sameAddress(snapshot.escalationGameAddress, zeroAddress)
		? false
		: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				functionName: 'forkContinuation',
				address: snapshot.escalationGameAddress,
				args: [],
			})
	const interpretedSnapshot = interpretSecurityPoolSnapshot(snapshot, deployment.parent)
	const mintingCapacityAttoEth = snapshot.centralMintingCapacity ?? (await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'getCurrentMintingCapacityAttoEth' }))
	return createListedSecurityPool({ deployment, snapshot: interpretedSnapshot, marketDetails, vaultSummaries, hasForkContinuationEscalationGame, mintingCapacityAttoEth })
}

/** Validate protocol representations before any subsequent capacity read, preserving failure ordering. */
function interpretSecurityPoolSnapshot(snapshot: Awaited<ReturnType<typeof readSecurityPoolSnapshot>>, parent: Address) {
	const forkData = requireForkDataView(snapshot.forkData)
	return {
		...snapshot,
		forkData,
		forkOutcome: getForkOutcomeKey(forkData.forkOutcomeIndex, parent),
		systemState: getSecurityPoolSystemState(snapshot.systemStateValue),
	}
}

function createListedSecurityPool({
	deployment,
	snapshot,
	marketDetails,
	vaultSummaries,
	hasForkContinuationEscalationGame,
	mintingCapacityAttoEth,
}: {
	deployment: SecurityPoolDeploymentTuple
	snapshot: ReturnType<typeof interpretSecurityPoolSnapshot>
	marketDetails: Awaited<ReturnType<typeof loadMarketDetails>>
	vaultSummaries: Awaited<ReturnType<typeof loadSecurityPoolVaultSummaries>>
	hasForkContinuationEscalationGame: boolean
	mintingCapacityAttoEth: bigint
}): ListedSecurityPool {
	const { initialReportPriorityFeeAttoEthPerGas, parent, openOraclePriceCoordinator: managerAddress, questionId, statoblastSecurityMultiplierBps, securityPool: securityPoolAddress, truthAuction: truthAuctionAddress, universeId } = deployment
	const {
		settlementCollateralAttoEth,
		currentRetentionRate,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		forkData,
		lastOraclePrice,
		lastSettlementTimestamp,
		questionOutcome,
		systemState,
		forkOutcome,
		shareTokenSupplyAttoShares,
		totalPoolHeldAttoRep,
		poolAccountingSnapshot,
		universeForkTime,
		escalationGameAddress,
		feeEndTimestamp,
	} = snapshot
	const ordinaryEscalationGameStarted = !sameAddress(escalationGameAddress, zeroAddress) && !hasForkContinuationEscalationGame
	const { truthAuctionStartedAt, migratedAttoRep, forkOwnSecurityPool } = forkData
	return {
		mintingCapacityAttoEth,
		settlementRecoveryAttoRep: snapshot.settlementRecoveryAttoRep,
		settlementCollateralAttoEth,
		currentRetentionRate,
		feeAccrualState: {
			centralSettlement: snapshot.centralSettlement,
			...(snapshot.linearFee === undefined ? {} : { linearFee: snapshot.linearFee }),
			feeEndTimestamp,
			feeIndexRemainder: poolAccountingSnapshot.feeIndexRemainder,
			lastUpdatedFeeAccumulator: poolAccountingSnapshot.lastUpdatedFeeAccumulator,
			totalFeesOwedRemainder: poolAccountingSnapshot.totalFeesOwedRemainder,
		},
		feeEligibleUnderwritingLimitAttoEth: poolAccountingSnapshot.feeEligibleUnderwritingLimitAttoEth,
		forkOutcome,
		forkOwnSecurityPool,
		hasForkActivity: deriveHasForkActivity({ forkOutcome, migratedAttoRep, systemState, truthAuctionStartedAt }),
		hasForkContinuationEscalationGame,
		initialReportPriorityFeeAttoEthPerGas,
		lastOraclePrice: lastSettlementTimestamp > 0n ? lastOraclePrice : undefined,
		lastOracleSettlementTimestamp: lastSettlementTimestamp,
		oraclePriceValidUntilTimestamp: snapshot.priceValidUntil === 0n ? undefined : snapshot.priceValidUntil,
		managerAddress,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		ordinaryEscalationGameStarted,
		marketDetails,
		migratedAttoRep,
		parent,
		questionOutcome: getReportingOutcomeKey(questionOutcome),
		questionId: formatQuestionIdHex(questionId),
		statoblastSecurityMultiplierBps,
		securityPoolAddress,
		shareTokenSupplyAttoShares,
		systemState,
		totalPoolHeldAttoRep,
		totalUnderwritingLimitAttoEth: poolAccountingSnapshot.totalUnderwritingLimitAttoEth,
		truthAuctionAddress,
		truthAuctionStartedAt,
		universeHasForked: universeForkTime > 0n,
		universeId,
		hasLoadedVaults: vaultSummaries.hasLoadedVaults,
		vaultScanCapped: vaultSummaries.vaultScanCapped,
		vaultCount: vaultSummaries.vaultCount,
		vaults: vaultSummaries.vaults,
	}
}
