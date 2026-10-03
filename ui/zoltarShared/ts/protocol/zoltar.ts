import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { MarketCreationResult, MarketDetails, MarketDetailsPage, MarketType, QuestionData, ReadClient, WriteClient, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { readRequiredMulticall, writeContractAndWait } from './core.js'
import { getMarketType, getProtocolPageOffset, isStringArray, requireUniverseTupleArray, type UniverseTuple } from './helpers.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { formatScalarOutcomeIndexLabel, isValidScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { getDeploymentSteps } from './deployment.js'
import type { UniverseLineageStep } from '@zoltar/ui-core-shared/lib/universeLineage.js'

const CONTRACT_PAGE_SIZE = 30n
const ANSWER_OPTION_ABI = [
	{
		inputs: [
			{ name: 'questionId', type: 'uint256' },
			{ name: 'answer', type: 'uint256' },
		],
		name: 'getAnswerOptionName',
		outputs: [{ name: '', type: 'string' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

type QuestionTuple = readonly [string, string, bigint, bigint, bigint, bigint, bigint, string]

async function loadReputationTokenMetadata(client: ReadClient, reputationToken: Address, isGenesis: boolean) {
	const calls = [
		{ abi: ReputationToken_ReputationToken.abi, functionName: 'name', address: reputationToken, args: [] },
		{ abi: ReputationToken_ReputationToken.abi, functionName: 'symbol', address: reputationToken, args: [] },
		...(isGenesis ? [] : [{ abi: ReputationToken_ReputationToken.abi, functionName: 'repNumber', address: reputationToken, args: [] }]),
	] as const
	const [name, symbol, repNumber] = await readRequiredMulticall(client, calls)
	if (typeof name !== 'string' || typeof symbol !== 'string') throw new Error('Unexpected REP token metadata response')
	if (isGenesis) return { reputationTokenKind: 'genesis' as const, reputationTokenName: name, reputationTokenSymbol: symbol }
	if (typeof repNumber !== 'bigint') throw new Error('Unexpected child REP number response')
	return {
		reputationTokenKind: 'child' as const,
		reputationTokenName: name,
		reputationTokenNumber: repNumber,
		reputationTokenSymbol: symbol,
	}
}

function requireBigintArray(value: unknown, context: string): bigint[] {
	if (!Array.isArray(value) || !value.every(item => typeof item === 'bigint')) throw new Error(`Unexpected ${context} response`)
	return [...value]
}

function getDeploymentStepAddress(id: 'zoltar' | 'zoltarQuestionData') {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step.address
}

async function loadOutcomeLabels(client: ReadClient, questionId: bigint) {
	let currentIndex = 0n
	const outcomeLabels: string[] = []

	while (true) {
		const page = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getOutcomeLabels',
			address: getDeploymentStepAddress('zoltarQuestionData'),
			args: [questionId, currentIndex, CONTRACT_PAGE_SIZE],
		})
		if (!isStringArray(page)) throw new Error('Unexpected outcome labels response')
		outcomeLabels.push(...page)
		if (BigInt(page.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	}

	return outcomeLabels
}

async function loadQuestionIds(client: ReadClient): Promise<bigint[]> {
	const questionCount = await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getQuestionCount',
		address: getDeploymentStepAddress('zoltarQuestionData'),
		args: [],
	})

	let currentIndex = 0n
	const questionIds: bigint[] = []
	while (currentIndex < questionCount) {
		const page = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getQuestions',
			address: getDeploymentStepAddress('zoltarQuestionData'),
			args: [currentIndex, CONTRACT_PAGE_SIZE],
		})
		if (!Array.isArray(page)) throw new Error('Unexpected question id page response')
		if (!page.every((questionId): questionId is bigint => typeof questionId === 'bigint')) throw new Error('Unexpected question id page response')
		questionIds.push(...page)
		if (BigInt(page.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	}

	return questionIds
}

async function loadQuestionIdsPage(client: ReadClient, startIndex: bigint, count: bigint) {
	if (count === 0n) return []
	const page = await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getQuestions',
		address: getDeploymentStepAddress('zoltarQuestionData'),
		args: [startIndex, count],
	})
	if (!Array.isArray(page)) throw new Error('Unexpected question id page response')
	if (!page.every((questionId): questionId is bigint => typeof questionId === 'bigint')) throw new Error('Unexpected question id page response')
	return page
}

export async function loadMarketDetails(client: ReadClient, questionId: bigint): Promise<MarketDetails> {
	const [question, createdAt] = await readRequiredMulticall(client, [
		{
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'questions',
			address: getDeploymentStepAddress('zoltarQuestionData'),
			args: [questionId],
		},
		{
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'questionCreatedTimestamp',
			address: getDeploymentStepAddress('zoltarQuestionData'),
			args: [questionId],
		},
	])
	const questionData: QuestionTuple = question
	const [title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit] = questionData

	const exists = createdAt > 0n || title !== '' || description !== '' || startTime !== 0n || endTime !== 0n || numTicks !== 0n
	const outcomeLabels = exists ? await loadOutcomeLabels(client, questionId) : []

	return {
		answerUnit,
		createdAt,
		description,
		displayValueMax,
		displayValueMin,
		endTime,
		exists,
		marketType: getMarketType({ title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit }, outcomeLabels),
		outcomeLabels,
		numTicks,
		questionId: formatQuestionIdHex(questionId),
		startTime,
		title,
	}
}

export async function loadAllZoltarQuestions(client: ReadClient): Promise<MarketDetails[]> {
	const questionIds = await loadQuestionIds(client)
	return await Promise.all(questionIds.map(async questionId => await loadMarketDetails(client, questionId)))
}

export async function loadZoltarQuestionCount(client: ReadClient) {
	return await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getQuestionCount',
		address: getDeploymentStepAddress('zoltarQuestionData'),
		args: [],
	})
}

export async function loadZoltarQuestionPage(client: ReadClient, pageIndex: number, pageSize: number): Promise<MarketDetailsPage> {
	const startIndex = getProtocolPageOffset(pageIndex, pageSize)
	const questionCount = await loadZoltarQuestionCount(client)
	if (startIndex >= questionCount) {
		return {
			pageIndex,
			pageSize,
			questionCount,
			questions: [],
		}
	}
	const count = questionCount - startIndex < BigInt(pageSize) ? questionCount - startIndex : BigInt(pageSize)
	const questionIds = await loadQuestionIdsPage(client, startIndex, count)
	return {
		pageIndex,
		pageSize,
		questionCount,
		questions: await Promise.all(questionIds.map(async questionId => await loadMarketDetails(client, questionId))),
	}
}

const MAX_LINEAGE_DEPTH = 64

/**
 * Walks a universe's ancestry to genesis and names each generation by the fork outcome that created it.
 * A child's `forkingOutcomeIndex` indexes its parent's fork question, which never changes once the parent has forked.
 */
async function loadUniverseLineage(client: ReadClient, universeId: bigint, universe: UniverseTuple, zoltarAddress: Address): Promise<UniverseLineageStep[]> {
	const ancestry: UniverseLineageStep[] = []
	let currentUniverseId = universeId
	let currentUniverse = universe
	while (currentUniverseId !== 0n) {
		if (ancestry.length >= MAX_LINEAGE_DEPTH) throw new Error('Universe lineage is deeper than supported')
		const [, , forkingOutcomeIndex, , parentUniverseId] = currentUniverse
		const parentUniverse: UniverseTuple = await client.readContract({ abi: Zoltar_Zoltar.abi, functionName: 'universes', address: zoltarAddress, args: [parentUniverseId] })
		const [, parentForkQuestionId] = parentUniverse
		const outcomeLabel = parentForkQuestionId === 0n ? undefined : await client.readContract({ abi: ANSWER_OPTION_ABI, functionName: 'getAnswerOptionName', address: getDeploymentStepAddress('zoltarQuestionData'), args: [parentForkQuestionId, forkingOutcomeIndex] })
		ancestry.push({ outcomeLabel, universeId: currentUniverseId })
		currentUniverseId = parentUniverseId
		currentUniverse = parentUniverse
	}
	return [{ outcomeLabel: undefined, universeId: 0n }, ...ancestry.reverse()]
}

/** Resolves just this generation's name, independently of the depth or size of the universe tree. */
async function loadUniverseOutcomeName(client: ReadClient, zoltarAddress: Address, parentUniverseId: bigint, outcomeIndex: bigint) {
	const [parent, questionDataAddress] = await readRequiredMulticall(client, [
		{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'universes', args: [parentUniverseId] },
		{ abi: Zoltar_Zoltar.abi, address: zoltarAddress, functionName: 'zoltarQuestionData', args: [] },
	])
	const [, questionId] = parent
	if (questionId === 0n) return undefined
	return await client.readContract({ abi: ANSWER_OPTION_ABI, address: questionDataAddress, functionName: 'getAnswerOptionName', args: [questionId, outcomeIndex] })
}

/**
 * Reads a universe from Zoltar. Callers with their own deployment configuration pass its Zoltar address so the universe reads
 * target that deployment; the fork question, outcome labels, and lineage outcome names still come from the active profile's question data, so the
 * address must belong to the same canonical deployment as the active network profile.
 */
export async function loadZoltarUniverseSummary(
	client: ReadClient,
	universeId: bigint,
	zoltarAddress: Address = getDeploymentStepAddress('zoltar'),
	{ includeRelatedUniverses = true, scalarOutcomeIndexes = [] }: { includeRelatedUniverses?: boolean; scalarOutcomeIndexes?: readonly bigint[] } = {},
): Promise<ZoltarUniverseSummary | undefined> {
	const [repToken, universe, forkTime, forkThresholdAttoRep, forkBurnDivisor] = await readRequiredMulticall(client, [
		{
			abi: Zoltar_Zoltar.abi,
			functionName: 'getRepToken',
			address: zoltarAddress,
			args: [universeId],
		},
		{
			abi: Zoltar_Zoltar.abi,
			functionName: 'universes',
			address: zoltarAddress,
			args: [universeId],
		},
		{
			abi: Zoltar_Zoltar.abi,
			functionName: 'getForkTime',
			address: zoltarAddress,
			args: [universeId],
		},
		{
			abi: Zoltar_Zoltar.abi,
			functionName: 'getForkThresholdAttoRep',
			address: zoltarAddress,
			args: [universeId],
		},
		{
			abi: Zoltar_Zoltar.abi,
			functionName: 'forkBurnDivisor',
			address: zoltarAddress,
			args: [],
		},
	])
	if (repToken === zeroAddress) return undefined
	const universeData: UniverseTuple = universe
	const [storedForkTime, forkQuestionId, forkingOutcomeIndex, , parentUniverseId] = universeData
	const hasForked = forkTime > 0n || storedForkTime > 0n
	const [reputationTokenMetadata, totalTheoreticalSupplyAttoRep, lineage] = await Promise.all([
		loadReputationTokenMetadata(client, repToken, universeId === 0n),
		client.readContract({ abi: Zoltar_Zoltar.abi, functionName: 'getUniverseTheoreticalSupplyAttoRep', address: zoltarAddress, args: [universeId] }),
		includeRelatedUniverses ? loadUniverseLineage(client, universeId, universeData, zoltarAddress) : undefined,
	])

	let outcomeLabel = lineage?.at(-1)?.outcomeLabel
	if (!includeRelatedUniverses && universeId !== 0n) outcomeLabel = await loadUniverseOutcomeName(client, zoltarAddress, parentUniverseId, forkingOutcomeIndex)

	let childUniverses: ZoltarUniverseSummary['childUniverses'] = []
	let forkQuestionDetails: MarketDetails | undefined = undefined
	if (includeRelatedUniverses && hasForked && forkQuestionId > 0n) {
		const marketDetails = await loadMarketDetails(client, forkQuestionId)
		forkQuestionDetails = marketDetails
		const childOutcomeEntries =
			marketDetails.marketType === 'scalar'
				? [...new Set(scalarOutcomeIndexes)].map(outcomeIndex => {
						if (!isValidScalarOutcomeIndex(marketDetails, outcomeIndex)) throw new Error('Invalid scalar outcome selection')
						return { outcomeIndex, outcomeLabel: formatScalarOutcomeIndexLabel(marketDetails, outcomeIndex) }
					})
				: [{ outcomeIndex: 0n, outcomeLabel: 'Invalid' }, ...marketDetails.outcomeLabels.map((outcomeLabel, index) => ({ outcomeIndex: BigInt(index + 1), outcomeLabel }))]
		if (childOutcomeEntries.length > 0) {
			const childUniverseIds = requireBigintArray(
				await readRequiredMulticall(
					client,
					childOutcomeEntries.map(({ outcomeIndex }) => ({
						abi: Zoltar_Zoltar.abi,
						functionName: 'getChildUniverseId',
						address: zoltarAddress,
						args: [universeId, outcomeIndex],
					})),
				),
				'child universe ids',
			)
			const childUniverseTuples = requireUniverseTupleArray(
				await readRequiredMulticall(
					client,
					childUniverseIds.map((childUniverseId: bigint) => ({
						abi: Zoltar_Zoltar.abi,
						functionName: 'universes',
						address: zoltarAddress,
						args: [childUniverseId],
					})),
				),
				'child universe tuple',
			)

			childUniverses = childOutcomeEntries.map(({ outcomeIndex, outcomeLabel }, index) => {
				const childUniverseId = childUniverseIds[index]
				if (childUniverseId === undefined) throw new Error('Unexpected child universe id response')
				const childUniverseData = childUniverseTuples[index]
				if (childUniverseData === undefined) throw new Error('Unexpected child universe response')
				const [childForkTime, , , childReputationToken, childParentUniverseId] = childUniverseData
				return {
					exists: childReputationToken !== zeroAddress,
					forkTime: childForkTime,
					outcomeIndex,
					outcomeLabel,
					parentUniverseId: childParentUniverseId,
					reputationToken: childReputationToken,
					universeId: childUniverseId,
				}
			})
		}
		childUniverses = await Promise.all(
			childUniverses.map(async childUniverse =>
				childUniverse.exists
					? {
							...childUniverse,
							...(await loadReputationTokenMetadata(client, childUniverse.reputationToken, false)),
						}
					: childUniverse,
			),
		)
	}

	return {
		childUniverses,
		outcomeLabel,
		relatedUniversesLoaded: includeRelatedUniverses,
		forkBurnDivisor,
		forkQuestionDetails,
		forkThresholdAttoRep,
		forkTime,
		forkingOutcomeIndex,
		hasForked,
		lineage,
		parentUniverseId,
		reputationToken: repToken,
		...reputationTokenMetadata,
		totalTheoreticalSupplyAttoRep,
		universeId,
		zoltarAddress,
	}
}

export async function createMarket(
	client: WriteClient,
	parameters: {
		marketType: MarketType
		outcomeLabels: string[]
		questionData: QuestionData
	},
) {
	const questionId = getQuestionId(parameters.questionData, parameters.outcomeLabels)
	const createQuestionHash = await writeContractAndWait(client, () => ({
		address: getDeploymentStepAddress('zoltarQuestionData'),
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'createQuestion',
		args: [parameters.questionData, parameters.outcomeLabels],
	}))

	return {
		questionId: formatQuestionIdHex(questionId),
		createQuestionHash,
		marketType: parameters.marketType,
	} satisfies MarketCreationResult
}
