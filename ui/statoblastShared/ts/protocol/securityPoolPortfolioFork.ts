import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { formatScalarOutcomeIndexLabel } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import * as copy from '../copy/portfolioFork.js'

/** Resolves the source universe's fork question without assuming a fixed number of branches. */
export async function loadPortfolioForkOutcome(client: Pick<ReadClient, 'readContract'>, parameters: { zoltar: Address; universeId: bigint; outcomeIndex: bigint; blockNumber: bigint }) {
	const { zoltar, universeId, outcomeIndex, blockNumber } = parameters
	const [universe, questionData] = await Promise.all([client.readContract({ address: zoltar, abi: Zoltar_Zoltar.abi, functionName: 'universes', args: [universeId], blockNumber }), client.readContract({ address: zoltar, abi: Zoltar_Zoltar.abi, functionName: 'zoltarQuestionData', blockNumber })])
	const forkQuestionId = universe[1]
	const [question, firstLabels] = await Promise.all([
		client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'questions', args: [forkQuestionId], blockNumber }),
		client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getOutcomeLabels', args: [forkQuestionId, 0n, 1n], blockNumber }),
	])
	const [questionTitle, , , , numTicks, displayValueMin, displayValueMax, answerUnit] = question
	let outcomeLabel: string | undefined
	if (firstLabels.length === 0 && numTicks > 0n) outcomeLabel = formatScalarOutcomeIndexLabel({ numTicks, displayValueMin, displayValueMax, answerUnit }, outcomeIndex)
	else if (outcomeIndex === 0n) outcomeLabel = copy.invalid
	else {
		const labels = await client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getOutcomeLabels', args: [forkQuestionId, outcomeIndex - 1n, 1n], blockNumber })
		outcomeLabel = labels[0]
	}
	return { questionTitle, outcomeLabel }
}
