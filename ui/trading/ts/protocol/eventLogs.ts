import type { Address, PublicClient } from '@zoltar/shared/ethereum'
import { createCanonicalLogLoader, findContractDeploymentBlock, requiredCanonicalBlockAnchor } from '@zoltar/shared/logScan'
import { ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'

const MAXIMUM_EVENT_LOG_RANGE = 10_000n

const deployChildEvent = Zoltar_Zoltar.abi.find((entry): entry is Extract<(typeof Zoltar_Zoltar.abi)[number], { type: 'event'; name: 'DeployChild' }> => entry.type === 'event' && entry.name === 'DeployChild')
if (deployChildEvent === undefined) throw new Error('DeployChild event missing from ABI')
const questionCreatedEvent = ZoltarQuestionData_ZoltarQuestionData.abi.find((entry): entry is Extract<(typeof ZoltarQuestionData_ZoltarQuestionData.abi)[number], { type: 'event'; name: 'QuestionCreated' }> => entry.type === 'event' && entry.name === 'QuestionCreated')
if (questionCreatedEvent === undefined) throw new Error('QuestionCreated event missing from ABI')

const canonicalEventLoader = <Event extends typeof deployChildEvent | typeof questionCreatedEvent>(event: Event) =>
	createCanonicalLogLoader({
		fetchRange: async (client: PublicClient, address: Address, range) => await client.getLogs({ address, event, fromBlock: range.fromBlock, toBlock: range.toBlock }),
		loadBlockAnchor: async (client: PublicClient, blockNumber?: bigint) => requiredCanonicalBlockAnchor(await client.getBlock(blockNumber === undefined ? undefined : { blockNumber })),
		loadCacheIdentity: async (client: PublicClient) => (await client.getBlock({ blockNumber: 0n })).hash,
		loadStartBlock: async (client: PublicClient, address: Address, toBlock?: bigint) => await findContractDeploymentBlock(client, address, toBlock),
		maximumItems: 10_000,
		maximumRange: MAXIMUM_EVENT_LOG_RANGE,
	})

export const loadCanonicalDeployChildLogs = canonicalEventLoader(deployChildEvent)
export const loadCanonicalQuestionCreatedLogs = canonicalEventLoader(questionCreatedEvent)
