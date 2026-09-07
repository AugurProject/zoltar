import { decodeEventLog, getAddress, zeroAddress, type Address, type PublicClient } from '@zoltar/shared/ethereum'
import { formatScalarOutcomeIndexLabel, type ScalarQuestionDetails } from '@zoltar/shared/scalarOutcome'
import { getChildUniverseId } from '@zoltar/shared/universeId'
import { statoblast_SecurityPool_SecurityPool, statoblast_tokens_ShareToken_ShareToken, ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js'
import { requiredCanonicalBlockAnchor } from '@zoltar/shared/logScan'
import { loadCanonicalDeployChildLogs, loadCanonicalQuestionCreatedLogs } from './eventLogs.js'
import { assertDeployChildId, assertDeployChildRoute, assertQuestionCreatedId } from './eventValidation.js'
import type { LiveMarket } from './live.js'

const poolForkAbi = statoblast_SecurityPool_SecurityPool.abi
const zoltarForkAbi = Zoltar_Zoltar.abi
const forkQuestionAbi = ZoltarQuestionData_ZoltarQuestionData.abi
const shareForkAbi = statoblast_tokens_ShareToken_ShareToken.abi

export type ForkTarget = Readonly<{
	outcomeIndex: bigint
	universeId: bigint
	label: string
	canonicalPool: Address | undefined
}>

type ForkQuestionBase = Readonly<{
	parentUniverseId: bigint
	questionId: bigint
	title: string
	availableTargets: readonly ForkTarget[]
}>

export type ForkMigrationContext = (ForkQuestionBase & Readonly<{ kind: 'categorical' }>) | (ForkQuestionBase & ScalarQuestionDetails & Readonly<{ kind: 'scalar' }>)

export { getChildUniverseId }

async function targetWithCanonicalPool(client: PublicClient, market: Pick<LiveMarket, 'shareToken' | 'universeId'>, outcomeIndex: bigint, label: string, knownUniverseId?: bigint): Promise<ForkTarget> {
	const universeId = knownUniverseId ?? getChildUniverseId(market.universeId, outcomeIndex)
	const canonicalPool = await client.readContract({ abi: shareForkAbi, address: market.shareToken, functionName: 'canonicalPoolByUniverse', args: [universeId] })
	return { outcomeIndex, universeId, label, canonicalPool: canonicalPool === zeroAddress ? undefined : getAddress(canonicalPool) }
}

async function loadScalarTargets(client: PublicClient, zoltar: Address, questionData: Address, market: Pick<LiveMarket, 'shareToken' | 'universeId'>, questionId: bigint, anchor: Readonly<{ blockHash: `0x${string}`; blockNumber: bigint }>) {
	const logs = await loadCanonicalDeployChildLogs(client, zoltar, anchor.blockNumber)
	const children = logs.flatMap(log => {
		try {
			const decoded = decodeEventLog({ abi: zoltarForkAbi, data: log.data, topics: log.topics })
			return decoded.eventName === 'DeployChild' && decoded.args.universeId === market.universeId ? [decoded.args] : []
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			return []
		}
	})
	for (const child of children) {
		assertDeployChildId(child.universeId, child.outcomeIndex, child.childUniverseId)
		const universe = await client.readContract({ abi: zoltarForkAbi, address: zoltar, functionName: 'universes', args: [child.childUniverseId], blockHash: anchor.blockHash })
		assertDeployChildRoute(universe.parentUniverseId, universe.forkingOutcomeIndex, getAddress(universe.reputationToken), child.universeId, child.outcomeIndex, getAddress(child.childReputationToken))
	}
	const outcomeIndexes = children.map(child => child.outcomeIndex)
	const childUniverseIds = children.map(child => child.childUniverseId)
	const labels = await Promise.all(outcomeIndexes.map(async outcomeIndex => await client.readContract({ abi: forkQuestionAbi, address: questionData, functionName: 'getAnswerOptionName', args: [questionId, outcomeIndex] })))
	const targets = await Promise.all(
		outcomeIndexes.map(async (outcomeIndex, index) => {
			const universeId = childUniverseIds[index]
			const label = labels[index]
			if (universeId === undefined || label === undefined) throw new Error('Malformed deployed child universe event')
			return await targetWithCanonicalPool(client, market, outcomeIndex, label, universeId)
		}),
	)
	if (requiredCanonicalBlockAnchor(await client.getBlock({ blockNumber: anchor.blockNumber })).blockHash !== anchor.blockHash) throw new Error('DeployChild events changed during scalar fork discovery')
	return targets
}

export function createScalarForkTarget(context: Extract<ForkMigrationContext, { kind: 'scalar' }>, outcomeIndex: bigint): ForkTarget {
	const existing = context.availableTargets.find(target => target.outcomeIndex === outcomeIndex)
	if (existing !== undefined) return existing
	return {
		outcomeIndex,
		universeId: getChildUniverseId(context.parentUniverseId, outcomeIndex),
		label: formatScalarOutcomeIndexLabel(context, outcomeIndex),
		canonicalPool: undefined,
	}
}

export async function loadForkMigrationContext(client: PublicClient, market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId'>): Promise<ForkMigrationContext> {
	const [zoltarAddress, questionDataAddress] = await Promise.all([client.readContract({ abi: poolForkAbi, address: market.pool, functionName: 'zoltar' }), client.readContract({ abi: poolForkAbi, address: market.pool, functionName: 'questionData' })])
	const zoltar = getAddress(zoltarAddress)
	const questionData = getAddress(questionDataAddress)
	const universe = await client.readContract({ abi: zoltarForkAbi, address: zoltar, functionName: 'universes', args: [market.universeId] })
	const forkQuestionId = universe[1]
	if (forkQuestionId === 0n) throw new Error('Forked universe has no fork question')
	const anchor = requiredCanonicalBlockAnchor(await client.getBlock())
	const questionLogs = await loadCanonicalQuestionCreatedLogs(client, questionData, anchor.blockNumber)
	const created = questionLogs.flatMap(log => {
		try {
			const decoded = decodeEventLog({ abi: forkQuestionAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'QuestionCreated') return []
			assertQuestionCreatedId(decoded.args.questionData, decoded.args.outcomeOptions, decoded.args.questionId)
			return decoded.args.questionId === forkQuestionId ? [decoded.args] : []
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			return []
		}
	})[0]
	if (created === undefined) throw new Error('Fork question creation event is unavailable')
	const { title, numTicks, displayValueMin, displayValueMax, answerUnit } = created.questionData
	const outcomeLabels = [...created.outcomeOptions]
	if (outcomeLabels.length > 0) {
		const entries = [{ outcomeIndex: 0n, label: 'Invalid' }, ...outcomeLabels.map((label, index) => ({ outcomeIndex: BigInt(index + 1), label }))]
		const availableTargets = await Promise.all(entries.map(async entry => await targetWithCanonicalPool(client, market, entry.outcomeIndex, entry.label)))
		return { kind: 'categorical', parentUniverseId: market.universeId, questionId: forkQuestionId, title, availableTargets }
	}
	if (numTicks === 0n) throw new Error('Fork question has neither categorical outcomes nor scalar ticks')
	const availableTargets = await loadScalarTargets(client, zoltar, questionData, market, forkQuestionId, { blockHash: anchor.blockHash as `0x${string}`, blockNumber: anchor.blockNumber })
	return {
		kind: 'scalar',
		parentUniverseId: market.universeId,
		questionId: forkQuestionId,
		title,
		numTicks,
		displayValueMin,
		displayValueMax,
		answerUnit,
		availableTargets,
	}
}
