import { encodeAbiParameters, getAddress, keccak256, zeroAddress, type Address, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { formatScalarOutcomeIndexLabel, type ScalarQuestionDetails } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import { statoblast_SecurityPool_SecurityPool, statoblast_tokens_ShareToken_ShareToken } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { LiveMarket } from './live.js'

const poolForkAbi = statoblast_SecurityPool_SecurityPool.abi
const zoltarForkAbi = Zoltar_Zoltar.abi
const forkQuestionAbi = ZoltarQuestionData_ZoltarQuestionData.abi
const shareForkAbi = statoblast_tokens_ShareToken_ShareToken.abi

/** Shares of each source outcome the account has already migrated into one child universe. */
type MigratedShareAmounts = Readonly<{ invalid: bigint; yes: bigint; no: bigint }>

const NO_MIGRATED_SHARES: MigratedShareAmounts = { invalid: 0n, yes: 0n, no: 0n }

export type ForkTarget = Readonly<{
	outcomeIndex: bigint
	universeId: bigint
	label: string
	canonicalPool: Address | undefined
	/** What the account already migrated here; zero without an account. ShareToken.migrate locks the source balance and records this amount instead of burning it. */
	migrated: MigratedShareAmounts
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

function getChildUniverseId(parentUniverseId: bigint, outcomeIndex: bigint) {
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

/** A migration always lands in a child universe with a canonical pool (it creates one when needed), so a universe without one holds nothing migrated. */
async function loadMigratedShares(client: PublicClient, market: Pick<LiveMarket, 'shareToken' | 'universeId'>, universeId: bigint, account: Address | undefined, canonicalPool: Address | undefined): Promise<MigratedShareAmounts> {
	if (account === undefined || canonicalPool === undefined) return NO_MIGRATED_SHARES
	const sourceTokenId = market.universeId << 8n
	const [invalid, yes, no] = await Promise.all([0n, 1n, 2n].map(async outcome => await client.readContract({ abi: shareForkAbi, address: market.shareToken, functionName: 'getMigratedShareAmountAttoShares', args: [sourceTokenId | outcome, universeId, account] })))
	if (invalid === undefined || yes === undefined || no === undefined) throw new Error('Migrated share amounts are incomplete')
	return { invalid, yes, no }
}

async function targetWithCanonicalPool(client: PublicClient, market: Pick<LiveMarket, 'shareToken' | 'universeId'>, outcomeIndex: bigint, label: string, account: Address | undefined, knownUniverseId?: bigint): Promise<ForkTarget> {
	const universeId = knownUniverseId ?? getChildUniverseId(market.universeId, outcomeIndex)
	const canonicalPoolAddress = await client.readContract({ abi: shareForkAbi, address: market.shareToken, functionName: 'canonicalPoolByUniverse', args: [universeId] })
	const canonicalPool = canonicalPoolAddress === zeroAddress ? undefined : getAddress(canonicalPoolAddress)
	return { outcomeIndex, universeId, label, canonicalPool, migrated: await loadMigratedShares(client, market, universeId, account, canonicalPool) }
}

async function loadScalarTargets(client: PublicClient, zoltar: Address, questionData: Address, market: Pick<LiveMarket, 'shareToken' | 'universeId'>, questionId: bigint, account: Address | undefined) {
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
				return await targetWithCanonicalPool(client, market, outcomeIndex, label, account, universeId)
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
		migrated: NO_MIGRATED_SHARES,
	}
}

/** The fork question and its child universes; with an account, each child universe also carries what that account already migrated into it. */
export async function loadForkMigrationContext(client: PublicClient, market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId'>, account?: Address): Promise<ForkMigrationContext> {
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
		const availableTargets = await Promise.all(entries.map(async entry => await targetWithCanonicalPool(client, market, entry.outcomeIndex, entry.label, account)))
		return { kind: 'categorical', parentUniverseId: market.universeId, questionId: forkQuestionId, title, availableTargets }
	}
	if (numTicks === 0n) throw new Error('Fork question has neither categorical outcomes nor scalar ticks')
	const availableTargets = await loadScalarTargets(client, zoltar, questionData, market, forkQuestionId, account)
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

/** The source outcome's key in a migrated-share record. */
export function migratedShareKey(outcome: 'INVALID' | 'YES' | 'NO') {
	if (outcome === 'INVALID') return 'invalid'
	return outcome === 'YES' ? 'yes' : 'no'
}

/** Shares of `outcome` already migrated into this child universe. */
export function migratedSharesOf(target: Pick<ForkTarget, 'migrated'>, outcome: 'INVALID' | 'YES' | 'NO') {
	return target.migrated[migratedShareKey(outcome)]
}

/**
 * True when migrating `outcome` into this child universe again would move nothing: the contract migrates only the
 * part of the current balance not yet recorded for that universe, and reverts when that part is zero.
 */
export function targetMigrationComplete(target: Pick<ForkTarget, 'migrated'>, outcome: 'INVALID' | 'YES' | 'NO', balance: bigint | undefined) {
	const migrated = migratedSharesOf(target, outcome)
	return migrated > 0n && balance !== undefined && migrated >= balance
}

/** The largest amount of each source outcome migrated into any one child universe. A positive amount means that balance is locked in the parent universe. */
export function largestMigratedShares(targets: readonly Pick<ForkTarget, 'migrated'>[]): MigratedShareAmounts {
	const largest = (key: keyof MigratedShareAmounts) => targets.reduce((maximum, target) => (target.migrated[key] > maximum ? target.migrated[key] : maximum), 0n)
	return { invalid: largest('invalid'), yes: largest('yes'), no: largest('no') }
}
