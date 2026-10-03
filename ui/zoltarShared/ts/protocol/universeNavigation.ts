import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ScalarQuestionDetails } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import { readRequiredMulticall } from './core.js'

export const UNIVERSE_OUTCOME_PAGE_SIZE = 10n

export type UniverseOutcomePage = {
	choices: { label: string; universeId: bigint; exists: boolean }[]
	hasNextPage: boolean
	scalarQuestion?: ScalarQuestionDetails | undefined
	title: string
}

/** Reads only the selected fork and at most ten child deployment statuses, regardless of registry size. */
export async function loadUniverseOutcomePage(client: Pick<ReadClient, 'readContract' | 'multicall'>, zoltarAddress: Address, universeId: bigint, start: bigint): Promise<UniverseOutcomePage> {
	if (start < 0n) throw new Error('Outcome page start must be non-negative')
	const [universe, questionDataAddress] = await readRequiredMulticall(client, [
		{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'universes', args: [universeId] },
		{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'zoltarQuestionData', args: [] },
	])
	const [forkTime, questionId] = universe
	if (forkTime === 0n) return { choices: [], hasNextPage: false, title: '' }
	const [question, firstLabels] = await readRequiredMulticall(client, [
		{ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionDataAddress, functionName: 'questions', args: [questionId] },
		{ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionDataAddress, functionName: 'getOutcomeLabels', args: [questionId, 0n, 1n] },
	])
	const [title, , , , numTicks, displayValueMin, displayValueMax, answerUnit] = question
	const scalarQuestion = firstLabels.length === 0 && numTicks > 0n ? { numTicks, displayValueMin, displayValueMax, answerUnit } : undefined
	if (scalarQuestion !== undefined) return { choices: [], hasNextPage: false, scalarQuestion, title }
	const labelStart = start === 0n ? 0n : start - 1n
	const labels = await client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionDataAddress, functionName: 'getOutcomeLabels', args: [questionId, labelStart, UNIVERSE_OUTCOME_PAGE_SIZE + 1n] })
	const candidates = labels.map((label, index) => ({ label, outcomeIndex: labelStart + BigInt(index) + 1n }))
	if (start === 0n) candidates.unshift({ label: 'Invalid', outcomeIndex: 0n })
	const hasNextPage = candidates.length > Number(UNIVERSE_OUTCOME_PAGE_SIZE)
	const outcomes = candidates.slice(0, Number(UNIVERSE_OUTCOME_PAGE_SIZE))
	if (outcomes.length === 0) return { choices: [], hasNextPage, scalarQuestion, title }
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
	return { choices, hasNextPage, scalarQuestion, title }
}

export type UniverseOutcome = { universeId: bigint; exists: boolean }

/** Resolves only the selected scalar outcome, including Invalid, without enumerating any ticks. */
export async function loadScalarUniverseOutcome(client: Pick<ReadClient, 'readContract' | 'multicall'>, zoltarAddress: Address, universeId: bigint, outcomeIndex: bigint): Promise<UniverseOutcome> {
	const [childId] = await readRequiredMulticall(client, [{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'getChildUniverseId', args: [universeId, outcomeIndex] }])
	const [token] = await readRequiredMulticall(client, [{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'getRepToken', args: [childId] }])
	return { universeId: childId, exists: token !== zeroAddress }
}
