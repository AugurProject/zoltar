import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
} from '../contractArtifact.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { SECURITY_POOL_QUESTION_OUTCOME_ABI } from './securityPoolAbi.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool } from '../types/contracts.js'
import { getReportingOutcomeKey, getSecurityPoolSystemState } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import type { SecurityPoolDeploymentTuple } from './helpers.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { loadCentralPortfolioQuestion } from './securityPoolPortfolioState.js'

/** Question views read settlement and underwriting from their shared portfolio at one block. */
export async function loadSecurityPoolDetails(client: ReadClient, deployment: SecurityPoolDeploymentTuple): Promise<ListedSecurityPool> {
	const { securityPool: securityPoolAddress, universeId, openOraclePriceCoordinator: managerAddress } = deployment
	const block = await client.getBlock()
	if (block.number === undefined) throw new Error('Question snapshot requires a mined block.')
	const blockNumber = block.number
	const infrastructure = getInfraContractAddresses()
	const [capital, portfolioAddress, escalationGameAddress, state, outcome, forkTime, price, settledAt, validUntil, marketDetails] = await Promise.all([
		client.readContract({ abi: poolArtifact.abi, address: securityPoolAddress, functionName: 'portfolioCustody', blockNumber }),
		client.readContract({ abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory, functionName: 'getSecurityPoolPortfolio', args: [securityPoolAddress], blockNumber }),
		client.readContract({ abi: poolArtifact.abi, address: securityPoolAddress, functionName: 'escalationGame', blockNumber }),
		client.readContract({ abi: poolArtifact.abi, address: securityPoolAddress, functionName: 'systemState', blockNumber }),
		client.readContract({ abi: SECURITY_POOL_QUESTION_OUTCOME_ABI, address: infrastructure.securityPoolForker, functionName: 'getQuestionOutcome', args: [securityPoolAddress], blockNumber }),
		client.readContract({ abi: Zoltar_Zoltar.abi, address: infrastructure.zoltar, functionName: 'getForkTime', args: [universeId], blockNumber }),
		client.readContract({ abi: coordinatorArtifact.abi, address: managerAddress, functionName: 'lastPrice', blockNumber }),
		client.readContract({ abi: coordinatorArtifact.abi, address: managerAddress, functionName: 'lastSettlementTimestamp', blockNumber }),
		client.readContract({ abi: coordinatorArtifact.abi, address: managerAddress, functionName: 'priceValidUntil', blockNumber }),
		loadMarketDetails(client, deployment.questionId),
	])
	if (capital === zeroAddress || portfolioAddress === zeroAddress) throw new Error('Question has no portfolio.')
	const central = await loadCentralPortfolioQuestion(client, securityPoolAddress, capital, blockNumber)
	const hasForkContinuationEscalationGame = escalationGameAddress !== zeroAddress && (await client.readContract({ abi: gameArtifact.abi, address: escalationGameAddress, functionName: 'forkContinuation', blockNumber }))
	return {
		portfolioAddress,
		settlementCollateralAttoEth: central.settlementCollateralAttoEth,
		settlementRecoveryAttoRep: central.settlementRecoveryAttoRep,
		mintingCapacityAttoEth: escalationGameAddress === zeroAddress ? central.mintingCapacityAttoEth : 0n,
		currentRetentionRate: central.currentRetentionRate,
		feeAccrualState: {
			centralSettlement: true,
			centralCheckpointTimestamp: central.centralCheckpointTimestamp,
			linearFee: central.linearFee,
			feeEndTimestamp: central.feeEndTimestamp,
			feeIndexRemainder: central.feeIndexRemainder,
			totalFeesOwedRemainder: central.totalFeesOwedRemainder,
			lastUpdatedFeeAccumulator: central.lastUpdatedFeeAccumulator,
		},
		feeEligibleUnderwritingLimitAttoEth: central.feeEligibleUnderwritingLimitAttoEth,
		hasForkActivity: forkTime > 0n || deployment.parent !== zeroAddress,
		hasForkContinuationEscalationGame,
		ordinaryEscalationGameStarted: escalationGameAddress !== zeroAddress && !hasForkContinuationEscalationGame,
		initialReportPriorityFeeAttoEthPerGas: deployment.initialReportPriorityFeeAttoEthPerGas,
		lastOraclePrice: settledAt > 0n ? price : undefined,
		lastOracleSettlementTimestamp: settledAt,
		oraclePriceValidUntilTimestamp: validUntil > 0n ? validUntil : undefined,
		managerAddress,
		marketDetails,
		parent: deployment.parent,
		questionOutcome: getReportingOutcomeKey(outcome),
		questionId: formatQuestionIdHex(deployment.questionId),
		statoblastSecurityMultiplierBps: deployment.statoblastSecurityMultiplierBps,
		securityPoolAddress,
		shareTokenSupplyAttoShares: central.shareTokenSupplyAttoShares,
		systemState: getSecurityPoolSystemState(state),
		totalPoolHeldAttoRep: central.totalPoolHeldAttoRep,
		totalUnderwritingLimitAttoEth: central.totalUnderwritingLimitAttoEth,
		universeHasForked: forkTime > 0n,
		universeId,
	}
}
