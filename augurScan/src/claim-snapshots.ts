import { allocatedWinningPayout, claimPayoutDestination, ordinaryWinningPayout } from './claim-payout.ts'
import { buildCarryMerkleMountainRangeProof, hashCarryLeaf, type CarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import { compareBigint } from '@zoltar/core-shared/math/bigint'
import { isObjectRecord } from '@zoltar/core-shared/validation/guards'
import { runtimeConfig } from './config.ts'
import { abiForKind } from './abi-catalog.ts'
import { type AbiValue, type Address, type Hex, getAddress, zeroAddress } from './ethereum.ts'
import type { StateRead } from './snapshots.ts'
import type { SystemContractKind } from './system-interfaces.ts'

const object = (value: unknown): Record<string, unknown> => {
	if (!isObjectRecord(value)) throw new Error('Invalid claim state object')
	return value
}
const uint = (value: unknown): bigint => {
	if (typeof value === 'bigint' && value >= 0n) return value
	if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
	throw new Error('Invalid claim integer')
}
const array = (value: unknown): unknown[] => {
	if (!Array.isArray(value)) throw new Error('Invalid claim array')
	return value
}
const address = (value: unknown): Address => {
	if (typeof value !== 'string') throw new Error('Invalid claim address')
	return getAddress(value)
}
const hash = (value: unknown): Hex => {
	if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid claim commitment')
	return `0x${value.slice(2).toLowerCase()}`
}
const flag = (value: unknown): boolean => {
	if (typeof value !== 'boolean') throw new Error('Invalid claim status')
	return value
}

type Leaf = CarryLeaf & { index: bigint; localIndex: bigint; active: boolean; leafHash: Hex }
type Game = { pool: Address; parentPool: Address; source: Address; forker: Address; continuation: boolean }

// All calls inherit the sampler's one canonical block tag. The budget fails
// closed instead of returning a valid-looking proof from a truncated tree.
export const sampleClaimPositions = async (gameAddress: Address, read: StateRead, state: Readonly<Record<string, unknown>>, limits = runtimeConfig.claimReconstruction) => {
	const cache = new Map<string, Promise<unknown>>()
	let reads = 0
	const call = (target: Address, kind: SystemContractKind, name: string, args: readonly AbiValue[] = []) => {
		const key = `${target.toLowerCase()}:${name}:${args.map(String).join(':')}`
		const cached = cache.get(key)
		if (cached !== undefined) return cached
		if (++reads > limits.maxReads) throw new Error(`Claim reconstruction exceeds the ${limits.maxReads}-read budget`)
		const abi = abiForKind(kind)
		if (abi === undefined) throw new Error(`Missing claim ABI ${kind}`)
		const pending = read(target, abi, name, args)
		cache.set(key, pending)
		return pending
	}
	const contexts = new Map<string, Game>()
	const context = async (game: Address): Promise<Game> => {
		const cached = contexts.get(game)
		if (cached !== undefined) return cached
		const pool = address(await call(game, 'escalationGame', 'questionLedger'))
		const continuation = flag(await call(game, 'escalationGame', 'forkContinuation'))
		const parentPool = continuation ? address(await call(pool, 'questionLedger', 'parent')) : zeroAddress
		const source = parentPool === zeroAddress ? zeroAddress : address(await call(parentPool, 'questionLedger', 'escalationGame'))
		const forker = address(await call(pool, 'questionLedger', 'questionForker'))
		const result = { pool, parentPool, source, forker, continuation }
		contexts.set(game, result)
		return result
	}
	const outcomeState = async (game: Address, outcome: number) => object(await call(game, 'escalationGame', 'getOutcomeState', [outcome]))
	const localLeaves = async (game: Address, outcome: number, view: Record<string, unknown>): Promise<Leaf[]> => {
		const active = new Set<string>()
		let next = 0n
		const pages = new Set<bigint>()
		do {
			if (pages.has(next)) throw new Error('Carry page cycle')
			pages.add(next)
			const page = array(await call(game, 'escalationGame', 'getCarryLeafPageByOutcome', [outcome, next, 100n]))
			for (const item of array(page[0])) active.add(uint(object(item)['sourceNodeId']).toString())
			next = uint(page[1])
		} while (next !== 0n)
		let nodeId = uint(view['localHeadNodeId'])
		const visited = new Set<bigint>()
		const leaves: Leaf[] = []
		while (nodeId !== 0n) {
			if (visited.has(nodeId) || leaves.length >= limits.maxLeaves) throw new Error(`Carry node cycle or ${limits.maxLeaves}-leaf limit exceeded`)
			visited.add(nodeId)
			const node = array(await call(game, 'escalationGame', 'nodes', [nodeId]))
			if (uint(node[2]) !== BigInt(outcome)) throw new Error('Carry node outcome mismatch')
			const leaf = { depositor: address(node[1]), amountAttoRep: uint(node[3]), parentDepositIndex: uint(node[4]), cumulativeAmountAttoRep: uint(node[5]), sourceNodeId: nodeId, index: uint(node[6]) }
			// Carry is append-only: consumed leaves keep their hash and only drop out of the active page.
			leaves.push({ ...leaf, localIndex: 0n, active: active.has(nodeId.toString()), leafHash: hashCarryLeaf(leaf, outcome) })
			nodeId = uint(node[0])
		}
		leaves.sort((a, b) => compareBigint(a.index, b.index))
		return leaves.map((leaf, index) => ({ ...leaf, localIndex: BigInt(index) }))
	}
	const histories = new Map<string, Promise<Leaf[]>>()
	const history = (game: Address, outcome: number, ancestors: readonly Address[] = []): Promise<Leaf[]> => {
		if (ancestors.includes(game) || ancestors.length >= limits.maxGenerations) throw new Error(`Carry ancestry cycle or ${limits.maxGenerations}-generation limit exceeded`)
		const key = `${game}:${outcome}`
		const cached = histories.get(key)
		if (cached !== undefined) return cached
		const pending = (async () => {
			const ctx = await context(game)
			const view = await outcomeState(game, outcome)
			const count = uint(view['snapshotLeafCount'])
			if (count > BigInt(limits.maxLeaves)) throw new Error(`Carry snapshot exceeds the ${limits.maxLeaves}-leaf limit`)
			const parent = ctx.source === zeroAddress ? [] : await history(ctx.source, outcome, [...ancestors, game])
			const inherited = parent.slice(0, Number(count))
			if (BigInt(inherited.length) !== count) throw new Error('Inherited carry snapshot is incomplete')
			const local = await localLeaves(game, outcome, view)
			if (local.some((leaf, index) => leaf.index !== count + BigInt(index))) throw new Error('Carry append order is incomplete')
			return [...inherited, ...local]
		})()
		histories.set(key, pending)
		return pending
	}
	// Inherited proof consumption is tracked only by the claiming game's consumed parent deposit indexes.
	const proofConsumed = async (game: Address, outcome: number) => {
		const consumed: bigint[] = []
		for (let offset = 0n; ; offset += 100n) {
			const page = array(await call(game, 'escalationGame', 'getProofConsumedCarriedDepositIndexesByOutcome', [outcome, offset, 100n])).map(uint)
			consumed.push(...page)
			if (page.length < 100) return consumed
		}
	}
	const ctx = await context(gameAddress)
	const resolution = uint(state['finalQuestionResolution'])
	const poolResolution = uint(await call(ctx.forker, 'questionForker', 'getQuestionOutcome', [ctx.pool]))
	const zoltar = address(await call(ctx.pool, 'questionLedger', 'zoltar'))
	const universe = uint(await call(ctx.pool, 'questionLedger', 'universeId'))
	const readForkThreshold = async () => {
		// Every accepted deposit and a continuation's resume record the threshold settlement scales by; zero means the game never changed, so the first deposit would record the live threshold.
		const recorded = uint(await call(gameAddress, 'escalationGame', 'settlementForkThresholdAttoRep'))
		if (recorded !== 0n) return recorded
		return uint(await call(zoltar, 'zoltar', 'getForkThresholdAttoRep', [universe]))
	}
	const forkThreshold = await readForkThreshold()
	const positions: Record<string, unknown>[] = []
	let truncated = false
	for (let outcome = 0; outcome < 3; outcome++) {
		const view = await outcomeState(gameAddress, outcome)
		const count = uint(view['snapshotLeafCount'])
		const leaves = await history(gameAddress, outcome)
		const consumed = await proofConsumed(gameAddress, outcome)
		const inherited = leaves.slice(0, Number(count))
		const snapshotRoot = hash(view['snapshotCarryRoot'])
		const inheritedHashes = inherited.map(leaf => leaf.leafHash)
		if (inherited.length > 0 && buildCarryMerkleMountainRangeProof(inheritedHashes, 0).root !== snapshotRoot) throw new Error('Claim membership commitment mismatch')
		for (const leaf of leaves) {
			const isInherited = leaf.index < count
			if (!isInherited && !leaf.active) continue
			if (isInherited && consumed.includes(leaf.parentDepositIndex)) continue
			if (positions.length >= 250) {
				truncated = true
				continue
			}
			let status = 'pending'
			if (resolution !== 3n && resolution === poolResolution) status = resolution === BigInt(outcome) ? 'claimable' : 'losing'
			else if (resolution !== poolResolution) status = 'resolution-mismatch'
			const membership = isInherited ? buildCarryMerkleMountainRangeProof(inheritedHashes, Number(leaf.index)) : undefined
			const proof =
				membership === undefined
					? undefined
					: {
							depositor: leaf.depositor,
							amountAttoRep: leaf.amountAttoRep.toString(),
							cumulativeAmountAttoRep: leaf.cumulativeAmountAttoRep.toString(),
							parentDepositIndex: leaf.parentDepositIndex.toString(),
							sourceNodeId: leaf.sourceNodeId.toString(),
							leafIndex: membership.leafIndex.toString(),
							merkleMountainRangePeakIndex: membership.merkleMountainRangePeakIndex.toString(),
							merkleMountainRangeSiblings: membership.merkleMountainRangeSiblings,
						}
			const sourcePrincipal = leaf.amountAttoRep
			const principal = leaf.amountAttoRep
			const rewardAmount = leaf.amountAttoRep
			const rewardCumulative = leaf.cumulativeAmountAttoRep
			if (principal > sourcePrincipal) throw new Error('Retained claim principal exceeds source allocation')
			const payout = ctx.continuation ? allocatedWinningPayout : ordinaryWinningPayout
			const result = status === 'claimable' ? payout({ principal, rewardAmount, rewardCumulative, binding: uint(state['bindingCapitalAttoRep']), winningBalance: uint(view['balanceAttoRep']), forkThreshold, nonDecisionThreshold: uint(state['nonDecisionThresholdAttoRep']) }) : undefined
			positions.push({
				depositor: leaf.depositor.toLowerCase(),
				outcome: String(outcome),
				deposit_index: leaf.parentDepositIndex.toString(),
				local_index: isInherited ? undefined : leaf.localIndex.toString(),
				kind: isInherited ? 'inherited' : 'local',
				status,
				principal_atto_rep: leaf.amountAttoRep.toString(),
				source_principal_atto_rep: sourcePrincipal.toString(),
				retained_principal_atto_rep: principal.toString(),
				reward_amount_atto_rep: rewardAmount.toString(),
				reward_cumulative_atto_rep: rewardCumulative.toString(),
				calculation: { binding_capital_atto_rep: state['bindingCapitalAttoRep'], winning_balance_atto_rep: uint(view['balanceAttoRep']).toString(), fork_threshold_atto_rep: forkThreshold.toString(), non_decision_threshold_atto_rep: state['nonDecisionThresholdAttoRep'] },
				payout_atto_rep: result?.payout.toString(),
				burn_atto_rep: result?.burn.toString(),
				proof,
				membership_root: membership?.root,
			})
		}
	}
	return { status: 'available', positions, truncated, reads, basis: `Authenticated leaf allocations and verified carry commitments. Each proof is independent at this block; refresh after any claim. ${claimPayoutDestination}` }
}
