import { carryStorageAbi as storageAbi } from '../contracts/carry-storage-abi.ts'
import { getAddress, zeroAddress, zeroHash, type Address } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, securityPoolAbi, securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'
import { drainConcurrent, type ChaosReadClient } from './discovery.ts'
import { carryCommitment, createMerkleMountainRangeProof, createSparseNullifierProof, hashCarryLeaf, nullifierPath, sparseNullifierRoot, type CarryLeafSlot, type CarryOutcome } from './carry-proof-index.ts'

function compareIntegers(left: bigint, right: bigint) {
	if (left < right) return -1
	return left > right ? 1 : 0
}

const PAGE_SIZE = 30n
export const CARRY_STORAGE_MAXIMUM_WITHDRAWALS = 32
export type CarryStorageClient = Pick<ChaosReadClient, 'readContract'>
export type CarryStorageRoute = { pool: Address; escalationGame: Address }

/** Adapts the Statoblast UI reporting.ts storage traversal, retaining literal-zero consumed leaf slots. */
export async function loadCarryStorageCandidates(client: CarryStorageClient, routes: readonly CarryStorageRoute[], wallet: Address, blockNumber: bigint, maximumItems: number) {
	let readCount = 0
	function budget(count = 1) {
		readCount += count
		if (readCount > maximumItems) throw new Error('Carry storage discovery exceeded its configured item limit')
	}
	const gameCache = new Map<string, ReturnType<typeof readGame>>()
	async function readGame(game: Address) {
		budget()
		const pool = await client.readContract({ abi: escalationGameAbi, address: game, blockNumber, functionName: 'securityPool' })
		const [parent, actualGame, forker, continuation] = await drainConcurrent([
			client.readContract({ abi: securityPoolAbi, address: pool, blockNumber, functionName: 'parent' }),
			client.readContract({ abi: securityPoolAbi, address: pool, blockNumber, functionName: 'escalationGame' }),
			client.readContract({ abi: securityPoolAbi, address: pool, blockNumber, functionName: 'securityPoolForker' }),
			client.readContract({ abi: escalationGameAbi, address: game, blockNumber, functionName: 'forkContinuation' }),
		])
		if (actualGame.toLowerCase() !== game.toLowerCase()) throw new Error('Carry storage game/pool route mismatch')
		const parentGame = parent === zeroAddress ? zeroAddress : await client.readContract({ abi: securityPoolAbi, address: parent, blockNumber, functionName: 'escalationGame' })
		return { pool, parent, parentGame, forker, continuation }
	}
	function gameInfo(game: Address) {
		const key = game.toLowerCase()
		let value = gameCache.get(key)
		if (value === undefined) {
			value = readGame(game)
			gameCache.set(key, value)
		}
		return value
	}
	const outcomeCache = new Map<string, ReturnType<typeof readOutcome>>()
	function readOutcome(game: Address, outcome: CarryOutcome) {
		budget()
		return client.readContract({ abi: escalationGameAbi, address: game, args: [outcome], blockNumber, functionName: 'getOutcomeState' })
	}
	function outcomeState(game: Address, outcome: CarryOutcome) {
		const key = `${game.toLowerCase()}:${outcome}`
		let value = outcomeCache.get(key)
		if (value === undefined) {
			value = readOutcome(game, outcome)
			outcomeCache.set(key, value)
		}
		return value
	}
	const localConsumedCache = new Map<string, Promise<string[]>>()
	async function readConsumed(game: Address, outcome: CarryOutcome) {
		const indexes: string[] = []
		for (let start = 0n; ; start += PAGE_SIZE) {
			budget()
			const page = await client.readContract({ abi: storageAbi, address: game, args: [outcome, start, PAGE_SIZE], blockNumber, functionName: 'getProofConsumedCarriedDepositIndexesByOutcome' })
			if (page.length > Number(PAGE_SIZE)) throw new Error('Oversized carry consumed-index page')
			budget(page.length)
			indexes.push(...page.map(value => value.toString()))
			if (page.length < Number(PAGE_SIZE)) return indexes
		}
	}
	function localConsumed(game: Address, outcome: CarryOutcome) {
		const key = `${game.toLowerCase()}:${outcome}`
		let value = localConsumedCache.get(key)
		if (value === undefined) {
			value = readConsumed(game, outcome)
			localConsumedCache.set(key, value)
		}
		return value
	}
	async function inheritedConsumed(game: Address, outcome: CarryOutcome, ancestors = new Set<string>()): Promise<string[]> {
		if (ancestors.has(game.toLowerCase())) throw new Error('Carry storage ancestor chain contains a cycle')
		const next = new Set(ancestors).add(game.toLowerCase())
		const [info, local] = await drainConcurrent([gameInfo(game), localConsumed(game, outcome)])
		if (!info.continuation || info.parentGame === zeroAddress) return local
		return [...(await inheritedConsumed(info.parentGame, outcome, next)), ...local]
	}
	const historyCache = new Map<string, CarryLeafSlot[]>()
	async function historicalSlots(game: Address, outcome: CarryOutcome, ancestors = new Set<string>()): Promise<CarryLeafSlot[]> {
		const key = `${game.toLowerCase()}:${outcome}`
		if (ancestors.has(game.toLowerCase())) throw new Error('Carry storage ancestor chain contains a cycle')
		const cached = historyCache.get(key)
		if (cached !== undefined) return cached
		const next = new Set(ancestors).add(game.toLowerCase())
		const [info, state] = await drainConcurrent([gameInfo(game), outcomeState(game, outcome)])
		if (state.currentLeafCount > BigInt(maximumItems)) throw new Error('Carry storage leaf count exceeds its configured item limit')
		let inherited: CarryLeafSlot[] = []
		if (info.continuation && info.parentGame !== zeroAddress) inherited = (await historicalSlots(info.parentGame, outcome, next)).slice(0, Number(state.snapshotLeafCount))
		if (BigInt(inherited.length) !== state.snapshotLeafCount) throw new Error('Inherited carry snapshot is not reconstructible from storage')
		const active = new Set<string>()
		const pages = new Set<string>()
		for (let nodeId = 0n; ; ) {
			budget()
			if (pages.has(nodeId.toString())) throw new Error('Carry storage leaf pagination contains a cycle')
			pages.add(nodeId.toString())
			const [page, nextNode] = await client.readContract({ abi: storageAbi, address: game, args: [outcome, nodeId, PAGE_SIZE], blockNumber, functionName: 'getCarryLeafPageByOutcome' })
			if (page.length > Number(PAGE_SIZE)) throw new Error('Oversized carry leaf page')
			for (const leaf of page) active.add(leaf.sourceNodeId.toString())
			if (nextNode === 0n) break
			nodeId = nextNode
		}
		const locals: { index: bigint; slot: CarryLeafSlot }[] = []
		const visited = new Set<string>()
		for (let nodeId = state.localHeadNodeId; nodeId !== 0n; ) {
			budget()
			if (visited.has(nodeId.toString())) throw new Error('Historical carry node chain contains a cycle')
			visited.add(nodeId.toString())
			const [parentNode, depositor, nodeOutcome, amount, parentIndex, cumulative, index] = await client.readContract({ abi: storageAbi, address: game, args: [nodeId], blockNumber, functionName: 'nodes' })
			if (Number(nodeOutcome) !== outcome || amount === 0n) throw new Error('Invalid historical carry node')
			const leaf = { depositor, outcome, amountAttoRep: amount.toString(), parentDepositIndex: parentIndex.toString(), cumulativeAmountAttoRep: cumulative.toString(), sourceNodeId: nodeId.toString() }
			const direct = active.has(nodeId.toString()) ? false : await client.readContract({ abi: securityPoolForkerAbi, address: info.forker, args: [info.pool, outcome, parentIndex], blockNumber, functionName: 'isEscalationDepositClaimedDirectly' })
			const present = active.has(nodeId.toString()) || direct
			locals.push({ index, slot: { leaf, hash: present ? hashCarryLeaf(leaf) : zeroHash, originGame: game, consumedLocally: !present } })
			nodeId = parentNode
		}
		locals.sort((left, right) => compareIntegers(left.index, right.index))
		for (const [index, local] of locals.entries()) if (local.index !== state.snapshotLeafCount + BigInt(index)) throw new Error('Historical carry leaf order is incomplete')
		const slots = [...inherited, ...locals.map(local => local.slot)]
		if (BigInt(slots.length) !== state.currentLeafCount) throw new Error('Historical carry leaf count is incomplete')
		historyCache.set(key, slots)
		return slots
	}
	const candidates = []
	const seenRoutes = new Set<string>()
	for (const route of [...routes].sort((a, b) => a.escalationGame.toLowerCase().localeCompare(b.escalationGame.toLowerCase()))) {
		if (seenRoutes.has(route.escalationGame.toLowerCase())) throw new Error('Duplicate carry storage game route')
		seenRoutes.add(route.escalationGame.toLowerCase())
		const info = await gameInfo(route.escalationGame)
		if (info.pool.toLowerCase() !== route.pool.toLowerCase()) throw new Error('Discovered carry pool differs from storage')
		if (!info.continuation) continue
		for (const outcome of [0, 1, 2] as const) {
			const state = await outcomeState(route.escalationGame, outcome)
			if (state.snapshotLeafCount === 0n) continue
			if (state.snapshotLeafCount > BigInt(maximumItems)) throw new Error('Carry snapshot exceeds its configured item limit')
			if (info.parentGame === zeroAddress) throw new Error('Inherited carry has no source game')
			const slots = (await historicalSlots(info.parentGame, outcome)).slice(0, Number(state.snapshotLeafCount))
			budget(slots.length)
			const commitment = carryCommitment(slots)
			if (commitment.leafCount !== state.snapshotLeafCount.toString() || commitment.peaks.some((peak, index) => peak.toLowerCase() !== state.snapshotPeaks[index]?.toLowerCase())) throw new Error('Stored parent carry snapshot root is not reconstructible')
			const consumed = new Set([...(await inheritedConsumed(info.parentGame, outcome)), ...(await localConsumed(route.escalationGame, outcome))])
			const nullifier = { consumed: [...consumed].sort((left, right) => compareIntegers(BigInt(left), BigInt(right))).map(parentDepositIndex => ({ parentDepositIndex, path: nullifierPath(parentDepositIndex).toString() })) }
			if (sparseNullifierRoot(nullifier).toLowerCase() !== state.currentNullifierRoot.toLowerCase()) throw new Error('Stored carry nullifier root is not reconstructible')
			for (const [index, slot] of slots.entries()) {
				const leaf = slot.leaf
				if (slot.hash === zeroHash || leaf.depositor.toLowerCase() !== wallet.toLowerCase() || consumed.has(leaf.parentDepositIndex)) continue
				const encodedSource = getAddress(`0x${(BigInt(leaf.parentDepositIndex) >> 96n).toString(16).padStart(40, '0')}`)
				const claimSourceGame = encodedSource === zeroAddress ? await client.readContract({ abi: storageAbi, address: route.escalationGame, blockNumber, functionName: 'rootClaimSourceGame' }) : encodedSource
				const claimInfo = await gameInfo(claimSourceGame)
				if (claimInfo.forker.toLowerCase() !== info.forker.toLowerCase()) throw new Error('Carry claim source uses a different forker')
				const direct = await client.readContract({ abi: securityPoolForkerAbi, address: info.forker, args: [claimInfo.pool, outcome, BigInt(leaf.parentDepositIndex)], blockNumber, functionName: 'isEscalationDepositClaimedDirectly' })
				if (direct) continue
				candidates.push({ pool: route.pool, game: route.escalationGame, sourcePool: info.parent, sourceGame: info.parentGame, claimSourceGame, forker: info.forker, state, ...leaf, slots, index, nullifier })
			}
		}
	}
	const start = candidates.length === 0 ? 0 : Number(blockNumber % BigInt(candidates.length))
	return candidates.map(({ slots, index, nullifier, ...candidate }, position) => {
		const selected = (position - start + candidates.length) % candidates.length < CARRY_STORAGE_MAXIMUM_WITHDRAWALS
		if (!selected) return { ...candidate, proof: undefined }
		const mmr = createMerkleMountainRangeProof(
			slots.map(slot => slot.hash),
			index,
		)
		return {
			...candidate,
			proof: {
				depositor: candidate.depositor,
				amountAttoRep: candidate.amountAttoRep,
				cumulativeAmountAttoRep: candidate.cumulativeAmountAttoRep,
				parentDepositIndex: candidate.parentDepositIndex,
				sourceNodeId: candidate.sourceNodeId,
				...mmr,
				nullifierSiblings: createSparseNullifierProof(nullifier, candidate.parentDepositIndex),
			},
		}
	})
}
