import { parseAbiItem, zeroAddress, type Address } from 'viem'
import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '../contractArtifact.js'
import type { MarketCreationResult, MarketDetails, MarketType, QuestionData, ReadClient, WriteClient, ZoltarUniverseSummary } from '../types/contracts.js'
import { readRequiredMulticall, writeContractAndWait } from './core.js'
import { getMarketType, getQuestionId, getQuestionIdHex, isStringArray, requireUniverseTupleArray, type UniverseTuple } from './helpers.js'
import { getDeploymentSteps } from './deployment.js'

const CONTRACT_PAGE_SIZE = 30n
const ANSWER_OPTION_ABI = [parseAbiItem('function getAnswerOptionName(uint256 questionId, uint256 answer) view returns (string memory)')]

type DeployedChildUniverseRecord = {
	forkQuestionId: bigint
	forkTime: bigint
	forkingOutcomeIndex: bigint
	parentUniverseId: bigint
	reputationToken: Address
}

type DeployedChildUniversesPage = readonly [readonly bigint[], readonly bigint[], readonly DeployedChildUniverseRecord[]]
type QuestionTuple = readonly [string, string, bigint, bigint, bigint, bigint, bigint, string]

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
		questionId: getQuestionIdHex(questionId),
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

export async function loadZoltarUniverseSummary(client: ReadClient, universeId: bigint): Promise<ZoltarUniverseSummary | undefined> {
	const zoltarAddress = getDeploymentStepAddress('zoltar')
	const [repToken, universe, forkTime, forkThreshold] = await readRequiredMulticall(client, [
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
			functionName: 'getForkThreshold',
			address: zoltarAddress,
			args: [universeId],
		},
	])
	if (repToken === zeroAddress) return undefined

	const totalTheoreticalSupply = await client.readContract({
		abi: ReputationToken_ReputationToken.abi,
		functionName: 'getTotalTheoreticalSupply',
		address: repToken,
		args: [],
	})
	const universeData: UniverseTuple = universe
	const [storedForkTime, forkQuestionId, forkingOutcomeIndex, , parentUniverseId] = universeData
	const hasForked = forkTime > 0n || storedForkTime > 0n

	let childUniverses: ZoltarUniverseSummary['childUniverses'] = []
	let forkQuestionDetails: MarketDetails | undefined = undefined
	if (hasForked && forkQuestionId > 0n) {
		const marketDetails = await loadMarketDetails(client, forkQuestionId)
		forkQuestionDetails = marketDetails
		if (marketDetails.marketType === 'scalar') {
			const deployedChildUniverses: ZoltarUniverseSummary['childUniverses'] = []
			let currentIndex = 0n
			while (true) {
				const page: DeployedChildUniversesPage = await client.readContract({
					abi: Zoltar_Zoltar.abi,
					functionName: 'getDeployedChildUniverses',
					address: getDeploymentStepAddress('zoltar'),
					args: [universeId, currentIndex, CONTRACT_PAGE_SIZE],
				})
				const [outcomeIndexes, childUniverseIds, childUniverseTuples] = page
				const outcomeLabels =
					outcomeIndexes.length === 0
						? []
						: (
								await readRequiredMulticall(
									client,
									outcomeIndexes.map(outcomeIndex => ({
										abi: ANSWER_OPTION_ABI,
										functionName: 'getAnswerOptionName',
										address: getDeploymentStepAddress('zoltarQuestionData'),
										args: [forkQuestionId, outcomeIndex],
									})),
								)
							).map(outcomeLabel => String(outcomeLabel))
				const pageChildren = outcomeIndexes.map((outcomeIndex, index) => {
					const childUniverse = childUniverseTuples[index]
					if (childUniverse === undefined) throw new Error('Unexpected deployed child universe response')
					const { forkTime: childForkTime, parentUniverseId: childParentUniverseId, reputationToken: childReputationToken } = childUniverse
					const outcomeLabel = outcomeLabels[index]
					if (outcomeLabel === undefined) throw new Error('Unexpected outcome label response')
					const childUniverseId = childUniverseIds[index]
					if (childUniverseId === undefined) throw new Error('Unexpected deployed child universe response')
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
				deployedChildUniverses.push(...pageChildren)
				if (BigInt(pageChildren.length) !== CONTRACT_PAGE_SIZE) break
				currentIndex += CONTRACT_PAGE_SIZE
			}
			childUniverses = deployedChildUniverses
		} else {
			const childOutcomeEntries = [
				{ outcomeIndex: 0n, outcomeLabel: 'Invalid' },
				...marketDetails.outcomeLabels.map((outcomeLabel, outcomeIndex) => ({
					outcomeIndex: BigInt(outcomeIndex + 1),
					outcomeLabel,
				})),
			]
			const childUniverseIds = (
				await readRequiredMulticall(
					client,
					childOutcomeEntries.map(({ outcomeIndex }) => ({
						abi: Zoltar_Zoltar.abi,
						functionName: 'getChildUniverseId',
						address: getDeploymentStepAddress('zoltar'),
						args: [universeId, outcomeIndex],
					})),
				)
			).map(childUniverseId => BigInt(childUniverseId))
			const childUniverseTuples = requireUniverseTupleArray(
				await readRequiredMulticall(
					client,
					childUniverseIds.map(childUniverseId => ({
						abi: Zoltar_Zoltar.abi,
						functionName: 'universes',
						address: getDeploymentStepAddress('zoltar'),
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
	}

	return {
		childUniverses,
		forkQuestionDetails,
		forkThreshold,
		forkTime,
		forkingOutcomeIndex,
		hasForked,
		parentUniverseId,
		reputationToken: repToken,
		totalTheoreticalSupply,
		universeId,
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
		questionId: getQuestionIdHex(questionId),
		createQuestionHash,
		marketType: parameters.marketType,
	} satisfies MarketCreationResult
}
