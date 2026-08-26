import { encodeAbiParameters, getAddress, keccak256, zeroAddress, type Address, type PublicClient } from '@zoltar/shared/ethereum'
import { formatScalarOutcomeIndexLabel, type ScalarQuestionDetails } from '@zoltar/shared/scalarOutcome'
import { statoblast_SecurityPool_SecurityPool, statoblast_tokens_ShareToken_ShareToken, ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
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

const FORK_PAGE_SIZE = 30n
const UINT248_MASK = (1n << 248n) - 1n

export function getChildUniverseId(parentUniverseId: bigint, outcomeIndex: bigint) {
	if (parentUniverseId < 0n || parentUniverseId > UINT248_MASK) throw new Error('Parent universe ID is outside uint248')
	if (outcomeIndex < 0n || outcomeIndex >= 1n << 256n) throw new Error('Fork outcome is outside uint256')
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [parentUniverseId, outcomeIndex]))) & UINT248_MASK
}

async function loadOutcomeLabels(client: PublicClient, questionData: Address, questionId: bigint) {
	const labels: string[] = []
	for (let start = 0n; ; start += FORK_PAGE_SIZE) {
		const page = await client.readContract({ abi: forkQuestionAbi, address: questionData, functionName: 'getOutcomeLabels', args: [questionId, start, FORK_PAGE_SIZE] })
		labels.push(...page)
		if (BigInt(page.length) < FORK_PAGE_SIZE) return labels
	}
}

async function targetWithCanonicalPool(client: PublicClient, market: Pick<LiveMarket, 'shareToken' | 'universeId'>, outcomeIndex: bigint, label: string, knownUniverseId?: bigint): Promise<ForkTarget> {
	const universeId = knownUniverseId ?? getChildUniverseId(market.universeId, outcomeIndex)
	const canonicalPool = await client.readContract({ abi: shareForkAbi, address: market.shareToken, functionName: 'canonicalPoolByUniverse', args: [universeId] })
	return { outcomeIndex, universeId, label, canonicalPool: canonicalPool === zeroAddress ? undefined : getAddress(canonicalPool) }
}

async function loadScalarTargets(client: PublicClient, zoltar: Address, questionData: Address, market: Pick<LiveMarket, 'shareToken' | 'universeId'>, questionId: bigint) {
	const targets: ForkTarget[] = []
	for (let start = 0n; ; start += FORK_PAGE_SIZE) {
		const page = await client.readContract({ abi: zoltarForkAbi, address: zoltar, functionName: 'getDeployedChildUniverses', args: [market.universeId, start, FORK_PAGE_SIZE] })
		const outcomeIndexes = page[0]
		const childUniverseIds = page[1]
		const labels = await Promise.all(outcomeIndexes.map(async outcomeIndex => await client.readContract({ abi: forkQuestionAbi, address: questionData, functionName: 'getAnswerOptionName', args: [questionId, outcomeIndex] })))
		const pageTargets = await Promise.all(
			outcomeIndexes.map(async (outcomeIndex, index) => {
				const universeId = childUniverseIds[index]
				const label = labels[index]
				if (universeId === undefined || label === undefined) throw new Error('Malformed deployed child universe page')
				return await targetWithCanonicalPool(client, market, outcomeIndex, label, universeId)
			}),
		)
		targets.push(...pageTargets)
		if (BigInt(outcomeIndexes.length) < FORK_PAGE_SIZE) return targets
	}
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
	const [question, outcomeLabels] = await Promise.all([client.readContract({ abi: forkQuestionAbi, address: questionData, functionName: 'questions', args: [forkQuestionId] }), loadOutcomeLabels(client, questionData, forkQuestionId)])
	const [title, , , , numTicks, displayValueMin, displayValueMax, answerUnit] = question
	if (outcomeLabels.length > 0) {
		const entries = [{ outcomeIndex: 0n, label: 'Invalid' }, ...outcomeLabels.map((label, index) => ({ outcomeIndex: BigInt(index + 1), label }))]
		const availableTargets = await Promise.all(entries.map(async entry => await targetWithCanonicalPool(client, market, entry.outcomeIndex, entry.label)))
		return { kind: 'categorical', parentUniverseId: market.universeId, questionId: forkQuestionId, title, availableTargets }
	}
	if (numTicks === 0n) throw new Error('Fork question has neither categorical outcomes nor scalar ticks')
	const availableTargets = await loadScalarTargets(client, zoltar, questionData, market, forkQuestionId)
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
