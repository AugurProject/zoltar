import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as coordinatorArtifact, statoblast_QuestionLedger_QuestionLedger as poolArtifact, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact } from '../contractArtifact.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { QUESTION_LEDGER_QUESTION_OUTCOME_ABI } from './questionLedgerAbi.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedQuestionLedger } from '../types/contracts.js'
import { getReportingOutcomeKey, getQuestionLedgerSystemState } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import type { QuestionLedgerDeploymentTuple } from './helpers.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { loadCentralSecurityPoolQuestion } from './securityPoolState.js'

/** Question views read settlement and underwriting from their shared security pool at one block. */
export async function loadQuestionLedgerDetails(client: ReadClient, deployment: QuestionLedgerDeploymentTuple, snapshotBlockNumber?: bigint): Promise<ListedQuestionLedger> {
	const { questionLedger: questionLedgerAddress, universeId, sharedPriceFeed: managerAddress } = deployment
	const blockNumber = snapshotBlockNumber ?? (await client.getBlock()).number
	if (blockNumber === undefined) throw new Error('Question snapshot requires a mined block.')
	const infrastructure = getInfraContractAddresses()
	const [capital, securityPoolAddress, escalationGameAddress, state, outcome, forkTime, price, settledAt, validUntil, marketDetails] = await Promise.all([
		client.readContract({ abi: poolArtifact.abi, address: questionLedgerAddress, functionName: 'securityPoolCustody', blockNumber }),
		client.readContract({ abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory, functionName: 'securityPoolOf', args: [questionLedgerAddress], blockNumber }),
		client.readContract({ abi: poolArtifact.abi, address: questionLedgerAddress, functionName: 'escalationGame', blockNumber }),
		client.readContract({ abi: poolArtifact.abi, address: questionLedgerAddress, functionName: 'systemState', blockNumber }),
		client.readContract({ abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI, address: infrastructure.questionForker, functionName: 'getQuestionOutcome', args: [questionLedgerAddress], blockNumber }),
		client.readContract({ abi: Zoltar_Zoltar.abi, address: infrastructure.zoltar, functionName: 'getForkTime', args: [universeId], blockNumber }),
		client.readContract({ abi: coordinatorArtifact.abi, address: managerAddress, functionName: 'lastPrice', blockNumber }),
		client.readContract({ abi: coordinatorArtifact.abi, address: managerAddress, functionName: 'lastSettlementTimestamp', blockNumber }),
		client.readContract({ abi: coordinatorArtifact.abi, address: managerAddress, functionName: 'priceValidUntil', blockNumber }),
		loadMarketDetails(client, deployment.questionId),
	])
	if (capital === zeroAddress || securityPoolAddress === zeroAddress) throw new Error('Question has no security pool.')
	const central = await loadCentralSecurityPoolQuestion(client, questionLedgerAddress, capital, blockNumber)
	const hasForkContinuationEscalationGame = escalationGameAddress !== zeroAddress && (await client.readContract({ abi: gameArtifact.abi, address: escalationGameAddress, functionName: 'forkContinuation', blockNumber }))
	return {
		securityPoolAddress,
		settlementCollateralAttoEth: central.settlementCollateralAttoEth,
		settlementRecoveryAttoRep: central.settlementRecoveryAttoRep,
		mintingCapacityAttoEth: escalationGameAddress === zeroAddress ? central.mintingCapacityAttoEth : 0n,
		feeAccrualState: {
			centralSettlement: true,
			centralCheckpointTimestamp: central.centralCheckpointTimestamp,
			linearFee: central.linearFee,
			feeEndTimestamp: central.feeEndTimestamp,
			lastFeeCheckpointNativeTime: central.lastFeeCheckpointNativeTime,
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
		questionLedgerAddress,
		shareTokenSupplyAttoShares: central.shareTokenSupplyAttoShares,
		systemState: getQuestionLedgerSystemState(state),
		totalPoolHeldAttoRep: central.totalPoolHeldAttoRep,
		totalUnderwritingLimitAttoEth: central.totalUnderwritingLimitAttoEth,
		universeHasForked: forkTime > 0n,
		universeId,
	}
}
