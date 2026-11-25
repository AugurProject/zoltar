import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact } from '../contractArtifact.js'
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
export async function loadQuestionLedgerDetails(client: ReadClient, deployment: Pick<QuestionLedgerDeploymentTuple, 'questionLedger' | 'questionId' | 'universeId'>, snapshotBlockNumber?: bigint): Promise<ListedQuestionLedger> {
	const { questionLedger: questionLedgerAddress, universeId } = deployment
	const blockNumber = snapshotBlockNumber ?? (await client.getBlock()).number
	if (blockNumber === undefined) throw new Error('Question snapshot requires a mined block.')
	const infrastructure = getInfraContractAddresses()
	const [capital, securityPoolAddress, escalationGameAddress, state, outcome, forkTime, marketDetails] = await Promise.all([
		client.readContract({ abi: poolArtifact.abi, address: questionLedgerAddress, functionName: 'securityPoolCustody', blockNumber }),
		client.readContract({ abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory, functionName: 'securityPoolOf', args: [questionLedgerAddress], blockNumber }),
		client.readContract({ abi: poolArtifact.abi, address: questionLedgerAddress, functionName: 'escalationGame', blockNumber }),
		client.readContract({ abi: poolArtifact.abi, address: questionLedgerAddress, functionName: 'systemState', blockNumber }),
		client.readContract({ abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI, address: infrastructure.questionForker, functionName: 'getQuestionOutcome', args: [questionLedgerAddress], blockNumber }),
		client.readContract({ abi: Zoltar_Zoltar.abi, address: infrastructure.zoltar, functionName: 'getForkTime', args: [universeId], blockNumber }),
		loadMarketDetails(client, deployment.questionId),
	])
	if (capital === zeroAddress || securityPoolAddress === zeroAddress) throw new Error('Question has no security pool.')
	const central = await loadCentralSecurityPoolQuestion(client, questionLedgerAddress, capital, blockNumber)
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
		marketDetails,
		questionOutcome: getReportingOutcomeKey(outcome),
		questionId: formatQuestionIdHex(deployment.questionId),
		questionLedgerAddress,
		shareTokenSupplyAttoShares: central.shareTokenSupplyAttoShares,
		systemState: getQuestionLedgerSystemState(state),
		totalPoolHeldAttoRep: central.totalPoolHeldAttoRep,
		totalUnderwritingLimitAttoEth: central.totalUnderwritingLimitAttoEth,
		universeHasForked: forkTime > 0n,
		universeId,
	}
}
