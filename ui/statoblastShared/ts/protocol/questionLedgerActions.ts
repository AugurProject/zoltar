import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger } from '../contractArtifact.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionAction, ForkAuctionActionResult } from '../types/contracts.js'

export async function readQuestionLedgerUniverseId(client: Pick<ReadClient, 'readContract'>, questionLedgerAddress: Address) {
	return await client.readContract({
		address: questionLedgerAddress,
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		functionName: 'universeId',
		args: [],
	})
}

export async function executeForkAuctionAction(action: ForkAuctionAction, questionLedgerAddress: Address, universeId: bigint, requestConfirmedTransaction: () => Promise<Hash>) {
	const hash = await requestConfirmedTransaction()
	return {
		action,
		hash,
		questionLedgerAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}
