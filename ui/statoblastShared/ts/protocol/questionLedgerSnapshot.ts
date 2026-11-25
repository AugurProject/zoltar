import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
} from '../contractArtifact.js'
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
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'

/** Question views read settlement and underwriting from their shared security pool at one block. */
export async function loadQuestionLedgerDetails(client: ReadClient, deployment: QuestionLedgerDeploymentTuple, snapshotBlockNumber?: bigint): Promise<ListedQuestionLedger> {
	const { questionLedger: questionLedgerAddress, universeId, openOraclePriceCoordinator: managerAddress } = deployment
	const blockNumber = snapshotBlockNumber ?? (await client.getBlock()).number
	if (blockNumber === undefined) throw new Error('Question snapshot requires a mined block.')
	const infrastructure = getInfraContractAddresses()
	const ledger = { abi: poolArtifact.abi, address: questionLedgerAddress }
	const oracle = { abi: coordinatorArtifact.abi, address: managerAddress }
	const readState = async () => {
		const [capital, securityPoolAddress, escalationGameAddress, systemState, outcome, forkTime, price, settledAt, validUntil, priorityFee] = await readRequiredMulticall(
			client,
			[
				{ ...ledger, functionName: 'securityPoolCustody' },
				{ abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory, functionName: 'securityPoolOf', args: [questionLedgerAddress] },
				{ ...ledger, functionName: 'escalationGame' },
				{ ...ledger, functionName: 'systemState' },
				{ abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI, address: infrastructure.questionForker, functionName: 'getQuestionOutcome', args: [questionLedgerAddress] },
				{ abi: Zoltar_Zoltar.abi, address: infrastructure.zoltar, functionName: 'getForkTime', args: [universeId] },
				{ ...oracle, functionName: 'lastPrice' },
				{ ...oracle, functionName: 'lastSettlementTimestamp' },
				{ ...oracle, functionName: 'priceValidUntil' },
				{ ...oracle, functionName: 'initialReportPriorityFeeAttoEthPerGas' },
			],
			blockNumber,
		)
		if (capital === zeroAddress || securityPoolAddress === zeroAddress) throw new Error('Question has no security pool.')
		const [central, hasForkContinuationEscalationGame] = await Promise.all([
			loadCentralSecurityPoolQuestion(client, questionLedgerAddress, capital, blockNumber),
			escalationGameAddress !== zeroAddress && client.readContract({ abi: gameArtifact.abi, address: escalationGameAddress, functionName: 'forkContinuation', blockNumber }),
		])
		return { central, securityPoolAddress, escalationGameAddress, systemState, outcome, forkTime, price, settledAt, validUntil, priorityFee, hasForkContinuationEscalationGame }
	}
	const [state, marketDetails] = await Promise.all([readState(), loadMarketDetails(client, deployment.questionId)])
	const { central, securityPoolAddress, escalationGameAddress, outcome, forkTime, price, settledAt, validUntil, priorityFee, hasForkContinuationEscalationGame } = state
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
		initialReportPriorityFeeAttoEthPerGas: priorityFee,
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
		systemState: getQuestionLedgerSystemState(state.systemState),
		totalPoolHeldAttoRep: central.totalPoolHeldAttoRep,
		totalUnderwritingLimitAttoEth: central.totalUnderwritingLimitAttoEth,
		universeHasForked: forkTime > 0n,
		universeId,
	}
}
