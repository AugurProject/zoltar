import { allocatedWinningPayout } from './claim-payout.ts'
import { bagCarryPeaks, compareBigintAscending, buildCarryMerkleMountainRangeProof, buildCarryPeakHeights, createSparseNullifier, hashCarryLeaf, type CarryLeaf } from '../../shared/core/ts/evm/carryProof.ts'
import { abiForKind } from './abi-catalog.ts'
import { type Abi, type AbiValue, type Address, type Hex, getAddress, parseAbi, zeroAddress } from './ethereum.ts'
import type { StateRead } from './snapshots.ts'

const ZERO: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
const allocationAbi = parseAbi(['function getInheritedClaimAllocation(uint8 outcomeIndex,uint256 amountAttoRep,uint256 cumulativeAmountAttoRep,uint256 leafIndex) view returns (uint256 sourceAmountAttoRep,uint256 retainedAmountAttoRep,uint256 rewardAmountAttoRep,uint256 retainedCumulativeAttoRep)'])
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
const object = (value: unknown): Record<string, unknown> => {
	if (!isRecord(value)) throw new Error('Invalid claim state object')
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
export const sampleClaimPositions = async (gameAddress: Address, read: StateRead, state: Readonly<Record<string, unknown>>) => {
	const cache = new Map<string, Promise<unknown>>()
	let reads = 0
	const call = (target: Address, kind: string | Abi, name: string, args: readonly AbiValue[] = []) => {
		const key = `${target.toLowerCase()}:${name}:${args.map(String).join(':')}`
		const cached = cache.get(key)
		if (cached !== undefined) return cached
		if (++reads > 1024) throw new Error('Claim reconstruction exceeds the 1024-read budget')
		const abi = typeof kind === 'string' ? abiForKind(kind) : kind
		if (abi === undefined) throw new Error(`Missing claim ABI ${String(kind)}`)
		const pending = read(target, abi, name, args)
		cache.set(key, pending)
		return pending
	}
	const contexts = new Map<string, Game>()
	const context = async (game: Address): Promise<Game> => {
		const cached = contexts.get(game)
		if (cached !== undefined) return cached
		const pool = address(await call(game, 'escalationGame', 'securityPool'))
		const continuation = flag(await call(game, 'escalationGame', 'forkContinuation'))
		const parentPool = continuation ? address(await call(pool, 'securityPool', 'parent')) : zeroAddress
		const source = parentPool === zeroAddress ? zeroAddress : address(await call(parentPool, 'securityPool', 'escalationGame'))
		const forker = address(await call(pool, 'securityPool', 'securityPoolForker'))
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
		const ctx = await context(game)
		while (nodeId !== 0n) {
			if (visited.has(nodeId) || leaves.length >= 256) throw new Error('Carry node cycle or 256-leaf limit exceeded')
			visited.add(nodeId)
			const node = array(await call(game, 'escalationGame', 'nodes', [nodeId]))
			if (uint(node[2]) !== BigInt(outcome)) throw new Error('Carry node outcome mismatch')
			const leaf = { depositor: address(node[1]), amountAttoRep: uint(node[3]), parentDepositIndex: uint(node[4]), cumulativeAmountAttoRep: uint(node[5]), sourceNodeId: nodeId, index: uint(node[6]) }
			const isActive = active.has(nodeId.toString())
			const directlyClaimed = !isActive && flag(await call(ctx.forker, 'securityPoolForker', 'isEscalationDepositClaimedDirectly', [ctx.pool, outcome, leaf.parentDepositIndex]))
			leaves.push({ ...leaf, localIndex: 0n, active: isActive, leafHash: isActive || directlyClaimed ? hashCarryLeaf(leaf, outcome) : ZERO })
			nodeId = uint(node[0])
		}
		leaves.sort((a, b) => compareBigintAscending(a.index, b.index))
		return leaves.map((leaf, index) => ({ ...leaf, localIndex: BigInt(index) }))
	}
	const histories = new Map<string, Promise<{ leaves: Leaf[]; consumed: bigint[] }>>()
	const history = (game: Address, outcome: number, ancestors: readonly Address[] = []): Promise<{ leaves: Leaf[]; consumed: bigint[] }> => {
		if (ancestors.includes(game) || ancestors.length >= 32) throw new Error('Carry ancestry cycle or 32-generation limit exceeded')
		const key = `${game}:${outcome}`
		const cached = histories.get(key)
		if (cached !== undefined) return cached
		const pending = (async () => {
			const ctx = await context(game)
			const view = await outcomeState(game, outcome)
			const count = uint(view['snapshotLeafCount'])
			if (count > 256n) throw new Error('Carry snapshot exceeds the 256-leaf limit')
			const parent = ctx.source === zeroAddress ? { leaves: [], consumed: [] } : await history(ctx.source, outcome, [...ancestors, game])
			const inherited = parent.leaves.slice(0, Number(count))
			if (BigInt(inherited.length) !== count) throw new Error('Inherited carry snapshot is incomplete')
			const local = await localLeaves(game, outcome, view)
			if (local.some((leaf, index) => leaf.index !== count + BigInt(index))) throw new Error('Carry append order is incomplete')
			const consumed = [...parent.consumed]
			for (let offset = 0n; ; offset += 100n) {
				const page = array(await call(game, 'escalationGame', 'getProofConsumedCarriedDepositIndexesByOutcome', [outcome, offset, 100n])).map(uint)
				consumed.push(...page)
				if (page.length < 100) break
			}
			return { leaves: [...inherited, ...local], consumed }
		})()
		histories.set(key, pending)
		return pending
	}
	const ctx = await context(gameAddress)
	const resolution = uint(state['finalQuestionResolution'])
	const poolResolution = uint(await call(ctx.forker, 'securityPoolForker', 'getQuestionOutcome', [ctx.pool]))
	const zoltar = address(await call(ctx.pool, 'securityPool', 'zoltar'))
	const universe = uint(await call(ctx.pool, 'securityPool', 'universeId'))
	const forkTime = uint(await call(zoltar, 'zoltar', 'getForkTime', [universe]))
	const forkThreshold = forkTime > uint(state['endTimestamp']) ? uint(state['nonDecisionThresholdAttoRep']) : uint(await call(zoltar, 'zoltar', 'getForkThresholdAttoRep', [universe]))
	const positions: Record<string, unknown>[] = []
	let truncated = false
	for (let outcome = 0; outcome < 3; outcome++) {
		const view = await outcomeState(gameAddress, outcome)
		const count = uint(view['snapshotLeafCount'])
		const { leaves, consumed } = await history(gameAddress, outcome)
		const inherited = leaves.slice(0, Number(count))
		const nullifiers = createSparseNullifier(consumed)
		if (nullifiers.getRoot() !== hash(view['currentNullifierRoot'])) throw new Error('Claim nullifier commitment mismatch')
		const peaks = array(view['snapshotPeaks'])
		const snapshotRoot = bagCarryPeaks(
			buildCarryPeakHeights(count)
				.sort((a, b) => a - b)
				.map(height => hash(peaks[height])),
		)
		const inheritedHashes = inherited.map(leaf => leaf.leafHash)
		if (inherited.length > 0 && buildCarryMerkleMountainRangeProof(inheritedHashes, 0).root !== snapshotRoot) throw new Error('Claim membership commitment mismatch')
		for (const leaf of leaves) {
			const isInherited = leaf.index < count
			if (!isInherited && !leaf.active) continue
			if (isInherited && (leaf.leafHash === ZERO || consumed.includes(leaf.parentDepositIndex))) continue
			if (positions.length >= 250) {
				truncated = true
				continue
			}
			const directlyClaimed = isInherited && flag(await call(ctx.forker, 'securityPoolForker', 'isEscalationDepositClaimedDirectly', [ctx.parentPool, outcome, leaf.parentDepositIndex]))
			let status = 'pending'
			if (directlyClaimed) status = 'claimed-in-parent'
			else if (resolution !== 3n && resolution === poolResolution) status = resolution === BigInt(outcome) ? 'claimable' : 'losing'
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
							nullifierSiblings: nullifiers.getProof(leaf.parentDepositIndex),
						}
			let sourcePrincipal = leaf.amountAttoRep
			let principal = leaf.amountAttoRep
			let rewardAmount = leaf.amountAttoRep
			let rewardCumulative = leaf.cumulativeAmountAttoRep
			if (isInherited && !directlyClaimed) {
				const allocation = array(await call(gameAddress, allocationAbi, 'getInheritedClaimAllocation', [outcome, leaf.amountAttoRep, leaf.cumulativeAmountAttoRep, leaf.index]))
				sourcePrincipal = uint(allocation[0])
				principal = uint(allocation[1])
				rewardAmount = uint(allocation[2])
				rewardCumulative = uint(allocation[3])
			}
			if (principal > sourcePrincipal) throw new Error('Retained claim principal exceeds source allocation')
			const result = status === 'claimable' ? allocatedWinningPayout({ principal, rewardAmount, rewardCumulative, binding: uint(state['bindingCapitalAttoRep']), winningBalance: uint(view['balanceAttoRep']), forkThreshold, nonDecisionThreshold: uint(state['nonDecisionThresholdAttoRep']) }) : undefined
			positions.push({
				depositor: leaf.depositor.toLowerCase(),
				outcome: String(outcome),
				deposit_index: leaf.parentDepositIndex.toString(),
				local_index: isInherited ? undefined : leaf.localIndex.toString(),
				kind: isInherited ? 'inherited' : 'local',
				status,
				principal_atto_rep: leaf.amountAttoRep.toString(),
				source_principal_atto_rep: directlyClaimed ? undefined : sourcePrincipal.toString(),
				retained_principal_atto_rep: directlyClaimed ? undefined : principal.toString(),
				auction_haircut_atto_rep: directlyClaimed ? undefined : (sourcePrincipal - principal).toString(),
				reward_amount_atto_rep: directlyClaimed ? undefined : rewardAmount.toString(),
				reward_cumulative_atto_rep: directlyClaimed ? undefined : rewardCumulative.toString(),
				calculation: { binding_capital_atto_rep: state['bindingCapitalAttoRep'], winning_balance_atto_rep: uint(view['balanceAttoRep']).toString(), fork_threshold_atto_rep: forkThreshold.toString(), non_decision_threshold_atto_rep: state['nonDecisionThresholdAttoRep'] },
				payout_atto_rep: result?.payout.toString(),
				burn_atto_rep: result?.burn.toString(),
				proof,
				membership_root: membership?.root,
				nullifier_root: isInherited ? nullifiers.getRoot() : undefined,
			})
		}
	}
	return { status: 'available', positions, truncated, reads, basis: 'Tagged contract allocations and verified carry/nullifier commitments. Each proof is independent at this block; refresh after any claim. Payouts credit the depositor claim bundle, not a wallet transfer quote.' }
}
