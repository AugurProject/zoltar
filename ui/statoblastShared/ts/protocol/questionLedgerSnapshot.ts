import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
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
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { loadCentralSecurityPoolQuestion } from './securityPoolState.js'
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'

/** Question views read settlement and underwriting from their shared security pool at one block. */
export async function loadQuestionLedgerDetails(client: ReadClient, questionLedgerAddress: Address, questionId: bigint, universeId: bigint, blockNumber: bigint): Promise<ListedQuestionLedger> {
	const infrastructure = getInfraContractAddresses()
	const ledger = { abi: poolArtifact.abi, address: questionLedgerAddress }
	const readState = async () => {
		const [confirmedId, capital, securityPoolAddress, escalationGameAddress, systemState, outcome, forkTime, managerAddress, initialReportingResponseWindow] = await readRequiredMulticall(
			client,
			[
				{ ...ledger, functionName: 'questionId' },
				{ ...ledger, functionName: 'securityPoolCustody' },
				{ abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory, functionName: 'securityPoolOf', args: [questionLedgerAddress] },
				{ ...ledger, functionName: 'escalationGame' },
				{ ...ledger, functionName: 'systemState' },
				{ abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI, address: infrastructure.questionForker, functionName: 'getQuestionOutcome', args: [questionLedgerAddress] },
				{ abi: Zoltar_Zoltar.abi, address: infrastructure.zoltar, functionName: 'getForkTime', args: [universeId] },
				{ ...ledger, functionName: 'openOraclePriceCoordinator' },
				{ ...ledger, functionName: 'initialReportingResponseWindow' },
			],
			blockNumber,
		)
		if (confirmedId !== questionId) throw new Error('The registered question does not match this ID.')
		if (capital === zeroAddress || securityPoolAddress === zeroAddress) throw new Error('Question has no security pool.')
		const [central, hasForkContinuationEscalationGame, validUntil] = await Promise.all([
			loadCentralSecurityPoolQuestion(client, questionLedgerAddress, capital, blockNumber),
			escalationGameAddress !== zeroAddress && client.readContract({ abi: gameArtifact.abi, address: escalationGameAddress, functionName: 'forkContinuation', blockNumber }),
			client.readContract({ abi: coordinatorArtifact.abi, address: managerAddress, functionName: 'priceValidUntil', blockNumber }),
		])
		return { central, securityPoolAddress, escalationGameAddress, systemState, outcome, forkTime, initialReportingResponseWindow, validUntil, hasForkContinuationEscalationGame }
	}
	const [state, marketDetails] = await Promise.all([readState(), loadMarketDetails(client, questionId)])
	const { central, securityPoolAddress, escalationGameAddress, outcome, forkTime, initialReportingResponseWindow, validUntil, hasForkContinuationEscalationGame } = state
	return {
		securityPoolAddress,
		hasEscalationGame: escalationGameAddress !== zeroAddress,
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
		ordinaryEscalationGameStarted: escalationGameAddress !== zeroAddress && !hasForkContinuationEscalationGame,
		initialReportingResponseWindow,
		oraclePriceValidUntilTimestamp: validUntil > 0n ? validUntil : undefined,
		marketDetails,
		questionOutcome: getReportingOutcomeKey(outcome),
		questionId: formatQuestionIdHex(questionId),
		questionLedgerAddress,
		shareTokenSupplyAttoShares: central.shareTokenSupplyAttoShares,
		systemState: getQuestionLedgerSystemState(state.systemState),
		totalPoolHeldAttoRep: central.totalPoolHeldAttoRep,
		totalUnderwritingLimitAttoEth: central.totalUnderwritingLimitAttoEth,
		universeHasForked: forkTime > 0n,
		universeId,
	}
}
