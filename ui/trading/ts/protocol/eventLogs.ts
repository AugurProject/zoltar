import { decodeEventLog, type Address, type PublicClient } from '@zoltar/shared/ethereum'
import { createCanonicalLogLoader, encodedLogByteLength, findContractDeploymentBlock, requiredCanonicalBlockAnchor } from '@zoltar/shared/logScan'
import { assertQuestionCreatedEvent } from '@zoltar/shared/questionId'
import { getChildUniverseId } from '@zoltar/shared/universeId'
import { ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'

const MAXIMUM_EVENT_LOG_RANGE = 10_000n
const MAXIMUM_EVENT_LOG_BYTES = 32 * 1024 * 1024

const deployChildEvent = Zoltar_Zoltar.abi.find((entry): entry is Extract<(typeof Zoltar_Zoltar.abi)[number], { type: 'event'; name: 'DeployChild' }> => entry.type === 'event' && entry.name === 'DeployChild')
if (deployChildEvent === undefined) throw new Error('DeployChild event missing from ABI')
const questionCreatedEvent = ZoltarQuestionData_ZoltarQuestionData.abi.find((entry): entry is Extract<(typeof ZoltarQuestionData_ZoltarQuestionData.abi)[number], { type: 'event'; name: 'QuestionCreated' }> => entry.type === 'event' && entry.name === 'QuestionCreated')
if (questionCreatedEvent === undefined) throw new Error('QuestionCreated event missing from ABI')

const canonicalEventLoader = <Log extends Readonly<{ data: string; topics: readonly string[] }>>(fetchRange: (client: PublicClient, address: Address, range: Readonly<{ fromBlock: bigint; toBlock: bigint }>) => Promise<readonly Log[]>, validateItem: (log: Log) => void) =>
	createCanonicalLogLoader({
		fetchRange,
		loadBlockAnchor: async (client: PublicClient, blockNumber?: bigint) => requiredCanonicalBlockAnchor(await client.getBlock(blockNumber === undefined ? undefined : { blockNumber })),
		loadCacheIdentity: async (client: PublicClient) => (await client.getBlock({ blockNumber: 0n })).hash,
		loadStartBlock: async (client: PublicClient, address: Address, toBlock?: bigint) => await findContractDeploymentBlock(client, address, toBlock),
		maximumBytes: MAXIMUM_EVENT_LOG_BYTES,
		maximumItems: 10_000,
		maximumRange: MAXIMUM_EVENT_LOG_RANGE,
		measureItem: encodedLogByteLength,
		validateItem,
	})

export const loadCanonicalDeployChildLogs = canonicalEventLoader(
	async (client, address, range) => await client.getLogs({ address, event: deployChildEvent, fromBlock: range.fromBlock, toBlock: range.toBlock }),
	log => {
		const decoded = decodeEventLog({ abi: Zoltar_Zoltar.abi, data: log.data, topics: log.topics })
		if (decoded.eventName !== 'DeployChild') throw new Error('DeployChild event query returned an unexpected event')
		if (getChildUniverseId(decoded.args.universeId, decoded.args.outcomeIndex) !== decoded.args.childUniverseId) throw new Error('DeployChild event has a mismatched deterministic child universe ID')
	},
)
export const loadCanonicalQuestionCreatedLogs = canonicalEventLoader(
	async (client, address, range) => await client.getLogs({ address, event: questionCreatedEvent, fromBlock: range.fromBlock, toBlock: range.toBlock }),
	log => {
		const decoded = decodeEventLog({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, data: log.data, topics: log.topics })
		if (decoded.eventName !== 'QuestionCreated') throw new Error('QuestionCreated event query returned an unexpected event')
		assertQuestionCreatedEvent(decoded.args.questionData, decoded.args.outcomeOptions, decoded.args.questionId, decoded.args.createdTimestamp)
	},
)
