import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getWinningEscalationDepositClaimAmount } from '@zoltar/statoblast-shared/escalationGame/escalationMath'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getQuestionLedgerSystemState, getReportingOutcomeKey, getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import type { ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getEscalationSideLabel } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { statoblast_EscalationGame_EscalationGame as game, statoblast_QuestionLedger_QuestionLedger as ledger } from '../contractArtifact.js'
import * as copy from '../copy/reporting.js'
import { withClaimReadContext } from './claimReadContext.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { QUESTION_LEDGER_QUESTION_OUTCOME_ABI } from './questionLedgerAbi.js'
import { reportingDepositRead } from './reportingDepositSearch.js'

export async function readWinningClaimReview(client: Pick<WriteClient, 'account' | 'getBlock' | 'getBlockNumber' | 'multicall' | 'readContract'>, question: Address, outcome: ReportingOutcomeKey, indexes: readonly bigint[]) {
	const owner = client.account.address
	return await withClaimReadContext(client, async (_context, blockNumber) => {
		const [gameAddress, systemState, repToken, questionOutcome] = await readRequiredMulticall(
			client,
			[
				{ address: question, abi: ledger.abi, functionName: 'escalationGame' },
				{ address: question, abi: ledger.abi, functionName: 'systemState' },
				{ address: question, abi: ledger.abi, functionName: 'repToken' },
				{ address: getInfraContractAddresses().questionForker, abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI, functionName: 'getQuestionOutcome', args: [question] },
			],
			blockNumber,
		)
		if (gameAddress === zeroAddress) throw new Error(copy.claimUnavailableBeforeReporting)
		const status = getQuestionLedgerSystemState(systemState)
		if (status === 'poolForked') throw new Error(copy.claimParentAfterResolution)
		if (status === 'forkMigration') throw new Error(copy.forkMigrationRequiredDetail)
		const winner = getReportingOutcomeKey(questionOutcome)
		if (winner === 'none') throw new Error(copy.questionFinalizationRequired)
		if (winner !== outcome) throw new Error(copy.claimWinningOutcomeRequired)

		const [wallet, winningSide, bindingCapitalAttoRep, nonDecisionThresholdAttoRep, forkThresholdAttoRep, continuation, nonDecision, ...entries] = await readRequiredMulticall(
			client,
			[
				{ address: repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] },
				{ address: gameAddress, abi: game.abi, functionName: 'getOutcomeState', args: [getReportingOutcomeValue(outcome)] },
				{ address: gameAddress, abi: game.abi, functionName: 'getBindingCapitalAttoRep' },
				{ address: gameAddress, abi: game.abi, functionName: 'nonDecisionThresholdAttoRep' },
				{ address: gameAddress, abi: game.abi, functionName: 'settlementForkThresholdAttoRep' },
				{ address: gameAddress, abi: game.abi, functionName: 'forkContinuation' },
				{ address: gameAddress, abi: game.abi, functionName: 'hasReachedNonDecision' },
				...indexes.map(index => reportingDepositRead(gameAddress, outcome, index, 1n)),
			],
			blockNumber,
		)
		let payout = 0n
		for (const [offset, index] of indexes.entries()) {
			const deposit = entries[offset]?.[0]
			if (deposit === undefined || deposit.amountAttoRep === 0n || !sameAddress(deposit.depositor, owner)) throw new Error(copy.claimDepositUnavailable(index, getEscalationSideLabel(outcome)))
			payout += getWinningEscalationDepositClaimAmount({
				bindingCapitalAttoRep,
				depositAmountAttoRep: deposit.amountAttoRep,
				cumulativeAmountAttoRep: deposit.cumulativeAmountAttoRep,
				forkThresholdAttoRep,
				nonDecisionThresholdAttoRep,
				winningOutcomeBalanceAttoRep: winningSide.balanceAttoRep,
				ordinarySettlement: !continuation && !nonDecision,
			})
		}
		return { wallet, payout }
	})
}
