import { decodeEventLog, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { createCanonicalLogLoader, encodedLogByteLength, findContractDeploymentBlock, requiredCanonicalBlockAnchor } from '@zoltar/shared/logScan'
import { assertQuestionCreatedEvent } from '@zoltar/shared/questionId'
import { getChildUniverseId } from '@zoltar/shared/universeId'
import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { MarketCreationResult, MarketDetails, MarketDetailsPage, MarketType, QuestionData, ReadClient, WriteClient, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { readRequiredMulticall, writeContractAndWait } from './core.js'
import { getMarketType, getProtocolPageOffset, getQuestionId, getQuestionIdHex, isStringArray, requireUniverseTupleArray, type UniverseTuple } from './helpers.js'
import { getDeploymentSteps } from './deployment.js'

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

const MAXIMUM_EVENT_LOG_RANGE = 10_000n
const MAXIMUM_EVENT_LOG_BYTES = 32 * 1024 * 1024
const questionCreatedEvent = ZoltarQuestionData_ZoltarQuestionData.abi.find((entry): entry is Extract<(typeof ZoltarQuestionData_ZoltarQuestionData.abi)[number], { type: 'event'; name: 'QuestionCreated' }> => entry.type === 'event' && entry.name === 'QuestionCreated')
if (questionCreatedEvent === undefined) throw new Error('QuestionCreated event missing from ABI')
const deployChildEvent = Zoltar_Zoltar.abi.find((entry): entry is Extract<(typeof Zoltar_Zoltar.abi)[number], { type: 'event'; name: 'DeployChild' }> => entry.type === 'event' && entry.name === 'DeployChild')
if (deployChildEvent === undefined) throw new Error('DeployChild event missing from ABI')

function requireEventTopics(topics: readonly `0x${string}`[]) {
	const [signature, ...arguments_] = topics
	if (signature === undefined) throw new Error('Event log is missing its signature topic')
	return [signature, ...arguments_] as const
}

function decodeQuestionCreatedLog(log: Readonly<{ data: `0x${string}`; topics: readonly `0x${string}`[] }>) {
	const decoded = decodeEventLog({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, data: log.data, topics: requireEventTopics(log.topics) })
	if (decoded.eventName !== 'QuestionCreated') throw new Error('QuestionCreated event query returned an unexpected event')
	assertQuestionCreatedEvent(decoded.args.questionData, decoded.args.outcomeOptions, decoded.args.questionId, decoded.args.createdTimestamp)
	return decoded.args
}

function decodeDeployChildLog(log: Readonly<{ data: `0x${string}`; topics: readonly `0x${string}`[] }>) {
	const decoded = decodeEventLog({ abi: Zoltar_Zoltar.abi, data: log.data, topics: requireEventTopics(log.topics) })
	if (decoded.eventName !== 'DeployChild') throw new Error('DeployChild event query returned an unexpected event')
	if (getChildUniverseId(decoded.args.universeId, decoded.args.outcomeIndex) !== decoded.args.childUniverseId) throw new Error('DeployChild event has a mismatched deterministic child universe ID')
	return decoded.args
}

const canonicalEventLoader = <Log extends Readonly<{ data: string; topics: readonly string[] }>>(fetchRange: (client: ReadClient, address: Address, range: Readonly<{ fromBlock: bigint; toBlock: bigint }>) => Promise<readonly Log[]>, validateItem: (log: Log) => void) =>
	createCanonicalLogLoader({
		fetchRange,
		loadBlockAnchor: async (client: ReadClient, blockNumber?: bigint) => requiredCanonicalBlockAnchor(await client.getBlock(blockNumber === undefined ? undefined : { blockNumber })),
		loadCacheIdentity: async (client: ReadClient) => (await client.getBlock({ blockNumber: 0n })).hash,
		loadStartBlock: async (client: ReadClient, address: Address, toBlock?: bigint) => await findContractDeploymentBlock(client, address, toBlock),
		maximumBytes: MAXIMUM_EVENT_LOG_BYTES,
		maximumItems: 10_000,
		maximumRange: MAXIMUM_EVENT_LOG_RANGE,
		measureItem: encodedLogByteLength,
		validateItem,
	})
const loadCanonicalQuestionCreatedLogs = canonicalEventLoader(async (client, address, range) => await client.getLogs({ address, event: questionCreatedEvent, fromBlock: range.fromBlock, toBlock: range.toBlock }), decodeQuestionCreatedLog)
const loadCanonicalDeployChildLogs = canonicalEventLoader(async (client, address, range) => await client.getLogs({ address, event: deployChildEvent, fromBlock: range.fromBlock, toBlock: range.toBlock }), decodeDeployChildLog)

function requireBigintArray(value: unknown, context: string): bigint[] {
	if (!Array.isArray(value) || !value.every(item => typeof item === 'bigint')) throw new Error(`Unexpected ${context} response`)
	return [...value]
}

function getDeploymentStepAddress(id: 'zoltar' | 'zoltarQuestionData') {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step.address
}

async function loadQuestionEvents(client: ReadClient) {
	const logs = await loadCanonicalQuestionCreatedLogs(client, getDeploymentStepAddress('zoltarQuestionData'))
	return logs.map(decodeQuestionCreatedLog)
}

function marketDetailsFromQuestionEvent(created: Awaited<ReturnType<typeof loadQuestionEvents>>[number]): MarketDetails {
	const { title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit } = created.questionData
	const outcomeLabels = [...created.outcomeOptions]

	return {
		answerUnit,
		createdAt: created.createdTimestamp,
		description,
		displayValueMax,
		displayValueMin,
		endTime,
		exists: true,
		marketType: getMarketType({ title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit }, outcomeLabels),
		outcomeLabels,
		numTicks,
		questionId: getQuestionIdHex(created.questionId),
		startTime,
		title,
	}
}

export async function loadMarketDetails(client: ReadClient, questionId: bigint): Promise<MarketDetails> {
	const created = (await loadQuestionEvents(client)).find(event => event.questionId === questionId)
	if (created === undefined) return { answerUnit: '', createdAt: 0n, description: '', displayValueMax: 0n, displayValueMin: 0n, endTime: 0n, exists: false, marketType: 'binary', outcomeLabels: [], numTicks: 0n, questionId: getQuestionIdHex(questionId), startTime: 0n, title: '' }
	return marketDetailsFromQuestionEvent(created)
}

export async function loadRequiredMarketDetails(client: ReadClient, questionId: bigint): Promise<MarketDetails> {
	const marketDetails = await loadMarketDetails(client, questionId)
	if (!marketDetails.exists) throw new Error(`Required QuestionCreated event is missing for question ${questionId.toString()}`)
	return marketDetails
}

export async function loadAllZoltarQuestions(client: ReadClient): Promise<MarketDetails[]> {
	const events = await loadQuestionEvents(client)
	return events.map(marketDetailsFromQuestionEvent)
}

export async function loadZoltarQuestionCount(client: ReadClient) {
	return BigInt((await loadQuestionEvents(client)).length)
}

export async function loadZoltarQuestionPage(client: ReadClient, pageIndex: number, pageSize: number): Promise<MarketDetailsPage> {
	const startIndex = getProtocolPageOffset(pageIndex, pageSize)
	const questionEvents = await loadQuestionEvents(client)
	const questionCount = BigInt(questionEvents.length)
	if (startIndex >= questionCount) {
		return {
			pageIndex,
			pageSize,
			questionCount,
			questions: [],
		}
	}
	const count = questionCount - startIndex < BigInt(pageSize) ? questionCount - startIndex : BigInt(pageSize)
	return {
		pageIndex,
		pageSize,
		questionCount,
		questions: questionEvents.slice(Number(startIndex), Number(startIndex + count)).map(marketDetailsFromQuestionEvent),
	}
}

export async function loadZoltarUniverseSummary(client: ReadClient, universeId: bigint): Promise<ZoltarUniverseSummary | undefined> {
	const zoltarAddress = getDeploymentStepAddress('zoltar')
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

	const totalTheoreticalSupplyAttoRep = await client.readContract({
		abi: ReputationToken_ReputationToken.abi,
		functionName: 'getTotalTheoreticalSupplyAttoRep',
		address: repToken,
		args: [],
	})
	const universeData: UniverseTuple = universe
	const [storedForkTime, forkQuestionId, forkingOutcomeIndex, , parentUniverseId] = universeData
	const hasForked = forkTime > 0n || storedForkTime > 0n

	let childUniverses: ZoltarUniverseSummary['childUniverses'] = []
	let forkQuestionDetails: MarketDetails | undefined = undefined
	if (hasForked && forkQuestionId > 0n) {
		const marketDetails = await loadRequiredMarketDetails(client, forkQuestionId)
		forkQuestionDetails = marketDetails
		if (marketDetails.marketType === 'scalar') {
			const logs = await loadCanonicalDeployChildLogs(client, zoltarAddress)
			const deployed = logs.map(decodeDeployChildLog).filter(event => event.universeId === universeId)
			const outcomeIndexes = deployed.map(event => event.outcomeIndex)
			const childUniverseIds = deployed.map(event => event.childUniverseId)
			const childUniverseTuples = requireUniverseTupleArray(
				await readRequiredMulticall(
					client,
					childUniverseIds.map(childUniverseId => ({ abi: Zoltar_Zoltar.abi, functionName: 'universes', address: zoltarAddress, args: [childUniverseId] })),
				),
				'deployed child universe tuples',
			)
			let outcomeLabels: string[] = []
			if (outcomeIndexes.length > 0) {
				const rawOutcomeLabels = await readRequiredMulticall(
					client,
					outcomeIndexes.map(outcomeIndex => ({
						abi: ANSWER_OPTION_ABI,
						functionName: 'getAnswerOptionName',
						address: getDeploymentStepAddress('zoltarQuestionData'),
						args: [forkQuestionId, outcomeIndex],
					})),
				)
				if (!isStringArray(rawOutcomeLabels)) throw new Error('Unexpected child universe outcome labels response')
				outcomeLabels = rawOutcomeLabels.map(outcomeLabel => String(outcomeLabel))
			}
			childUniverses = outcomeIndexes.map((outcomeIndex, index) => {
				const childUniverse = childUniverseTuples[index]
				if (childUniverse === undefined) throw new Error('Unexpected deployed child universe response')
				const [childForkTime, , childOutcomeIndex, childReputationToken, childParentUniverseId] = childUniverse
				const outcomeLabel = outcomeLabels[index]
				if (outcomeLabel === undefined) throw new Error('Unexpected outcome label response')
				const childUniverseId = childUniverseIds[index]
				if (childUniverseId === undefined) throw new Error('Unexpected deployed child universe response')
				if (childParentUniverseId !== universeId || childOutcomeIndex !== outcomeIndex) throw new Error('Deployed child universe tuple does not match its event route')
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
		} else {
			const childOutcomeEntries = [
				{ outcomeIndex: 0n, outcomeLabel: 'Invalid' },
				...marketDetails.outcomeLabels.map((outcomeLabel, outcomeIndex) => ({
					outcomeIndex: BigInt(outcomeIndex + 1),
					outcomeLabel,
				})),
			]
			const childUniverseIds = requireBigintArray(
				await readRequiredMulticall(
					client,
					childOutcomeEntries.map(({ outcomeIndex }) => ({
						abi: Zoltar_Zoltar.abi,
						functionName: 'getChildUniverseId',
						address: getDeploymentStepAddress('zoltar'),
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
				const [childForkTime, childForkQuestionId, childOutcomeIndex, childReputationToken, childParentUniverseId] = childUniverseData
				const exists = childReputationToken !== zeroAddress
				if (exists && (childParentUniverseId !== universeId || childOutcomeIndex !== outcomeIndex)) throw new Error('Child universe tuple does not match its deterministic route')
				if (!exists && (childForkTime !== 0n || childForkQuestionId !== 0n || childOutcomeIndex !== 0n || childParentUniverseId !== 0n)) throw new Error('Undeployed child universe returned a nonzero tuple')
				return {
					exists,
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
		forkBurnDivisor,
		forkQuestionDetails,
		forkThresholdAttoRep,
		forkTime,
		forkingOutcomeIndex,
		hasForked,
		parentUniverseId,
		reputationToken: repToken,
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
		questionId: getQuestionIdHex(questionId),
		createQuestionHash,
		marketType: parameters.marketType,
	} satisfies MarketCreationResult
}
