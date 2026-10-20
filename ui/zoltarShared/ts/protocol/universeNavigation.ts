import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { ForkQuestionDetails, ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { readRequiredMulticall } from './core.js'
import { getMarketType } from './helpers.js'

export const UNIVERSE_OUTCOME_PAGE_SIZE = 10n

export type UniverseOutcomePage = {
	choices: { label: string; universeId: bigint; exists: boolean }[]
	hasNextPage: boolean
	question: ForkQuestionDetails | undefined
}

/** Reads only the selected fork and at most ten child deployment statuses, regardless of registry size. */
export async function loadUniverseOutcomePage(client: Pick<ReadClient, 'readContract' | 'multicall'>, zoltarAddress: Address, universeId: bigint, start: bigint): Promise<UniverseOutcomePage> {
	if (start < 0n) throw new Error('Outcome page start must be non-negative')
	const [universe, questionDataAddress] = await readRequiredMulticall(client, [
		{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'universes', args: [universeId] },
		{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'zoltarQuestionData', args: [] },
	])
	const [forkTime, questionId] = universe
	if (forkTime === 0n) return { choices: [], hasNextPage: false, question: undefined }
	const [storedQuestion, createdAt, firstLabels] = await readRequiredMulticall(client, [
		{ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionDataAddress, functionName: 'questions', args: [questionId] },
		{ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionDataAddress, functionName: 'questionCreatedTimestamp', args: [questionId] },
		{ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionDataAddress, functionName: 'getOutcomeLabels', args: [questionId, 0n, 3n] },
	])
	const [title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit] = storedQuestion
	const questionData = { title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit }
	const question: ForkQuestionDetails = { ...questionData, createdAt, questionId: formatQuestionIdHex(questionId), marketType: getMarketType(questionData, firstLabels), outcomeLabels: [], outcomesComplete: start === 0n }
	if (question.marketType === 'scalar') return { choices: [], hasNextPage: false, question }
	const labelStart = start === 0n ? 0n : start - 1n
	const labels = await client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionDataAddress, functionName: 'getOutcomeLabels', args: [questionId, labelStart, UNIVERSE_OUTCOME_PAGE_SIZE + 1n] })
	const candidates = labels.map((label, index) => ({ label, outcomeIndex: labelStart + BigInt(index) + 1n }))
	if (start === 0n) candidates.unshift({ label: 'Invalid', outcomeIndex: 0n })
	const hasNextPage = candidates.length > Number(UNIVERSE_OUTCOME_PAGE_SIZE)
	const outcomes = candidates.slice(0, Number(UNIVERSE_OUTCOME_PAGE_SIZE))
	const pageQuestion: ForkQuestionDetails = { ...question, outcomeLabels: outcomes.map(outcome => outcome.label), outcomesComplete: start === 0n && !hasNextPage }
	if (outcomes.length === 0) return { choices: [], hasNextPage, question: pageQuestion }
	const childIds = await readRequiredMulticall(
		client,
		outcomes.map(outcome => ({ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'getChildUniverseId', args: [universeId, outcome.outcomeIndex] }) as const),
	)
	const tokens = await readRequiredMulticall(
		client,
		childIds.map(childId => ({ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'getRepToken', args: [childId] }) as const),
	)
	const choices = outcomes.map((outcome, index) => {
		const childId = childIds[index]
		const token = tokens[index]
		if (childId === undefined || token === undefined) throw new Error('Missing child universe response')
		return { label: outcome.label, universeId: childId, exists: token !== zeroAddress }
	})
	return { choices, hasNextPage, question: pageQuestion }
}

export type UniverseOutcome = { universeId: bigint; exists: boolean }

/** Resolves only the selected scalar outcome, including Invalid, without enumerating any ticks. */
export async function loadScalarUniverseOutcome(client: Pick<ReadClient, 'readContract' | 'multicall'>, zoltarAddress: Address, universeId: bigint, outcomeIndex: bigint): Promise<UniverseOutcome> {
	const [childId] = await readRequiredMulticall(client, [{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'getChildUniverseId', args: [universeId, outcomeIndex] }])
	const [token] = await readRequiredMulticall(client, [{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'getRepToken', args: [childId] }])
	return { universeId: childId, exists: token !== zeroAddress }
}
