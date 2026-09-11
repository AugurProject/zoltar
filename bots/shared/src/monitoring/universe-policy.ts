import { getAddress, zeroAddress, type Address, type Chain, type PublicClient, type Transport } from '../ethereum.ts'

export type UniverseIdentity = {
	id: bigint
	parentId: bigint | undefined
	outcomeIndex: bigint | undefined
	forkQuestionId: bigint
	forkTime: bigint
	repToken: Address
}

export function parseApprovedUniverses(value: unknown) {
	if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !/^(?:0|[1-9]\d*)$/.test(id))) throw new Error('Approved universes must be an array of non-negative integer strings')
	const ids = [...new Set(value.map(id => BigInt(String(id))))]
	if (ids.some(id => id >= 2n ** 248n)) throw new Error('Approved universe must fit in uint248')
	return ids
}

export function approvedUniverseRepTokens(universes: readonly UniverseIdentity[], approvedUniverses: readonly bigint[]) {
	validateApprovedUniverseSelection(universes, approvedUniverses)
	return universes.filter(universe => approvedUniverses.includes(universe.id)).map(universe => universe.repToken)
}

export function validateApprovedUniverseSelection(universes: readonly UniverseIdentity[], approvedUniverses: readonly bigint[]) {
	const universesById = new Map(universes.map(universe => [universe.id.toString(), universe]))
	const unknown = approvedUniverses.find(universe => !universesById.has(universe.toString()))
	if (unknown !== undefined) throw new Error(`Universe ${unknown.toString()} is not present in the Zoltar universe tree`)
	const childChoiceByParent = new Map<string, string>()
	for (const approvedId of approvedUniverses) {
		let child = universesById.get(approvedId.toString())
		const visited = new Set<string>()
		while (child?.parentId !== undefined) {
			const childId = child.id.toString()
			if (visited.has(childId)) throw new Error(`Universe ${childId} has a cyclic parent lineage`)
			visited.add(childId)
			const parentId = child.parentId.toString()
			const selectedChild = childChoiceByParent.get(parentId)
			if (selectedChild !== undefined && selectedChild !== childId) {
				throw new Error(`Select only one truthful child of universe ${parentId}`)
			}
			childChoiceByParent.set(parentId, childId)
			const parent = universesById.get(parentId)
			if (parent === undefined) throw new Error(`Universe ${childId} references unknown parent universe ${parentId}`)
			child = parent
		}
	}
}

const universeComponents = [
	{ name: 'forkTime', type: 'uint256' },
	{ name: 'forkQuestionId', type: 'uint256' },
	{ name: 'forkingOutcomeIndex', type: 'uint256' },
	{ name: 'reputationToken', type: 'address' },
	{ name: 'parentUniverseId', type: 'uint248' },
] as const

const universeRegistryAbi = [
	{
		inputs: [{ name: 'universeId', type: 'uint248' }],
		name: 'universes',
		outputs: universeComponents,
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'universeId', type: 'uint248' },
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'count', type: 'uint256' },
		],
		name: 'getDeployedChildUniverses',
		outputs: [
			{ name: 'outcomeIndexes', type: 'uint256[]' },
			{ name: 'childUniverseIds', type: 'uint248[]' },
			{ components: universeComponents, name: 'childUniverses', type: 'tuple[]' },
		],
		stateMutability: 'view',
		type: 'function',
	},
] as const

const CHILD_UNIVERSE_PAGE = 100n

type RegistryUniverse = { forkQuestionId: bigint; forkTime: bigint; forkingOutcomeIndex: bigint; parentUniverseId: bigint; reputationToken: Address }
type ChildUniversePage = readonly [readonly bigint[], readonly bigint[], readonly RegistryUniverse[]]

function rootIdentity(root: RegistryUniverse): UniverseIdentity {
	if (root.reputationToken === zeroAddress) throw new Error('Canonical Zoltar root universe is not deployed')
	return {
		forkQuestionId: root.forkQuestionId,
		forkTime: root.forkTime,
		id: 0n,
		outcomeIndex: undefined,
		parentId: undefined,
		repToken: getAddress(root.reputationToken),
	}
}

function childIdentities(universe: UniverseIdentity, page: ChildUniversePage, seen: Set<string>) {
	const [outcomeIndexes, childUniverseIds, children] = page
	if (outcomeIndexes.length !== childUniverseIds.length || childUniverseIds.length !== children.length) {
		throw new Error(`Zoltar returned mismatched children for universe ${universe.id.toString()}`)
	}
	return childUniverseIds.map((childId, index): UniverseIdentity => {
		const child = children[index]
		const outcomeIndex = outcomeIndexes[index]
		if (child === undefined || outcomeIndex === undefined) throw new Error('Zoltar returned an incomplete child universe')
		if (child.reputationToken === zeroAddress || child.parentUniverseId !== universe.id || child.forkingOutcomeIndex !== outcomeIndex) throw new Error('Zoltar returned an invalid child universe identity')
		const key = childId.toString()
		if (seen.has(key)) throw new Error(`Zoltar universe ${key} appears more than once in the universe tree`)
		seen.add(key)
		return {
			forkQuestionId: child.forkQuestionId,
			forkTime: child.forkTime,
			id: childId,
			outcomeIndex,
			parentId: universe.id,
			repToken: getAddress(child.reputationToken),
		}
	})
}

function childPageCall(zoltar: Address, blockNumber: bigint, universeId: bigint, start: bigint) {
	return { abi: universeRegistryAbi, address: zoltar, args: [universeId, start, CHILD_UNIVERSE_PAGE] as const, blockNumber, functionName: 'getDeployedChildUniverses' as const }
}

export async function loadUniverseTree(client: PublicClient<Transport, Chain>, zoltar: Address, blockNumber: bigint) {
	const root = await client.readContract({
		abi: universeRegistryAbi,
		address: zoltar,
		args: [0n],
		blockNumber,
		functionName: 'universes',
	})
	const universes: UniverseIdentity[] = [rootIdentity(root)]
	const seen = new Set(['0'])
	for (let universeIndex = 0; universeIndex < universes.length; universeIndex += 1) {
		const universe = universes[universeIndex]
		if (universe === undefined) throw new Error('Universe traversal lost its current entry')
		for (let start = 0n; ; start += CHILD_UNIVERSE_PAGE) {
			const page = await client.readContract(childPageCall(zoltar, blockNumber, universe.id, start))
			universes.push(...childIdentities(universe, page, seen))
			if (page[2].length < CHILD_UNIVERSE_PAGE) break
		}
	}
	return universes
}

/**
 * Same traversal as `loadUniverseTree`, but every level of the tree is read through one Multicall3
 * request: the unforked case costs a single round trip instead of one per registry call.
 */
export async function loadUniverseTreeBatched(client: Pick<PublicClient<Transport, Chain>, 'multicall'>, zoltar: Address, blockNumber: bigint, multicall3: Address) {
	const pageCall = (universeId: bigint, start: bigint) => ({ abi: universeRegistryAbi, address: zoltar, args: [universeId, start, CHILD_UNIVERSE_PAGE] as const, functionName: 'getDeployedChildUniverses' as const })
	const [root, rootPage] = await client.multicall({
		allowFailure: false,
		blockNumber,
		contracts: [{ abi: universeRegistryAbi, address: zoltar, args: [0n] as const, functionName: 'universes' as const }, pageCall(0n, 0n)] as const,
		multicallAddress: multicall3,
	})
	const universes: UniverseIdentity[] = [rootIdentity(root)]
	const seen = new Set(['0'])
	const rootUniverse = universes[0]
	if (rootUniverse === undefined) throw new Error('Universe traversal lost its root entry')
	let pages: { page: ChildUniversePage; start: bigint; universe: UniverseIdentity }[] = [{ page: rootPage, start: 0n, universe: rootUniverse }]
	while (pages.length !== 0) {
		const requests: { start: bigint; universe: UniverseIdentity }[] = []
		for (const { page, start, universe } of pages) {
			const children = childIdentities(universe, page, seen)
			universes.push(...children)
			if (page[2].length >= CHILD_UNIVERSE_PAGE) requests.push({ start: start + CHILD_UNIVERSE_PAGE, universe })
			for (const child of children) requests.push({ start: 0n, universe: child })
		}
		if (requests.length === 0) break
		const results = await client.multicall({
			allowFailure: false,
			blockNumber,
			contracts: requests.map(request => pageCall(request.universe.id, request.start)),
			multicallAddress: multicall3,
		})
		pages = requests.map((request, index) => {
			const page = results[index]
			if (page === undefined) throw new Error('Zoltar child universe page is missing from the batched read')
			return { page, start: request.start, universe: request.universe }
		})
	}
	return universes
}
