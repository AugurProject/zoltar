import { decodeEventLog, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { createCanonicalLogLoader, findContractDeploymentBlock, requiredCanonicalBlockAnchor } from '@zoltar/shared/logScan'
import { getChildUniverseId } from '@zoltar/shared/universeId'
import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js'
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
const questionCreatedEvent = ZoltarQuestionData_ZoltarQuestionData.abi.find((entry): entry is Extract<(typeof ZoltarQuestionData_ZoltarQuestionData.abi)[number], { type: 'event'; name: 'QuestionCreated' }> => entry.type === 'event' && entry.name === 'QuestionCreated')
if (questionCreatedEvent === undefined) throw new Error('QuestionCreated event missing from ABI')
const deployChildEvent = Zoltar_Zoltar.abi.find((entry): entry is Extract<(typeof Zoltar_Zoltar.abi)[number], { type: 'event'; name: 'DeployChild' }> => entry.type === 'event' && entry.name === 'DeployChild')
if (deployChildEvent === undefined) throw new Error('DeployChild event missing from ABI')

const canonicalEventLoader = <Event extends typeof questionCreatedEvent | typeof deployChildEvent>(event: Event) =>
	createCanonicalLogLoader({
		fetchRange: async (client: ReadClient, address: Address, range) => await client.getLogs({ address, event, fromBlock: range.fromBlock, toBlock: range.toBlock }),
		loadBlockAnchor: async (client: ReadClient, blockNumber?: bigint) => requiredCanonicalBlockAnchor(await client.getBlock(blockNumber === undefined ? undefined : { blockNumber })),
		loadCacheIdentity: async (client: ReadClient) => (await client.getBlock({ blockNumber: 0n })).hash,
		loadStartBlock: async (client: ReadClient, address: Address, toBlock?: bigint) => await findContractDeploymentBlock(client, address, toBlock),
		maximumItems: 10_000,
		maximumRange: MAXIMUM_EVENT_LOG_RANGE,
	})
const loadCanonicalQuestionCreatedLogs = canonicalEventLoader(questionCreatedEvent)
const loadCanonicalDeployChildLogs = canonicalEventLoader(deployChildEvent)

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
	return logs.flatMap(log => {
		try {
			const decoded = decodeEventLog({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'QuestionCreated') return []
			if (getQuestionId(decoded.args.questionData, decoded.args.outcomeOptions) !== decoded.args.questionId) throw new Error('QuestionCreated event has a mismatched deterministic question ID')
			return [decoded.args]
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			return []
		}
	})
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
		const marketDetails = await loadMarketDetails(client, forkQuestionId)
		forkQuestionDetails = marketDetails
		if (marketDetails.marketType === 'scalar') {
			const logs = await loadCanonicalDeployChildLogs(client, zoltarAddress)
			const deployed = logs.flatMap(log => {
				try {
					const decoded = decodeEventLog({ abi: Zoltar_Zoltar.abi, data: log.data, topics: log.topics })
					return decoded.eventName === 'DeployChild' && decoded.args.universeId === universeId ? [decoded.args] : []
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return []
				}
			})
			for (const child of deployed) {
				if (getChildUniverseId(child.universeId, child.outcomeIndex) !== child.childUniverseId) throw new Error('DeployChild event has a mismatched deterministic child universe ID')
			}
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
