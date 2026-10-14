import { encodeAbiParameters, keccak256, zeroAddress, zeroHash, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'

export type ClaimCheckpointIdentity = {
	outcomeIndex: number
	amountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	leafIndex: bigint
}

type ClaimCheckpointTransform = {
	repBeforeAttoRep: bigint
	repRemainingAttoRep: bigint
	consumedBeforeAttoRep: bigint
}

type ClaimCheckpointBatch = {
	baseCommitment: Hash
	transforms: ClaimCheckpointTransform[]
}

export type ClaimCheckpointProgress = { nextSourceGame: Address; pendingSteps: bigint; complete: boolean; ready: boolean }

export const CLAIM_CHECKPOINT_MAX_STEPS = 8n
export type ClaimCheckpointSettlement = 'atomic' | 'separate' | 'unknown'

/** True only when the bounded nonempty application batch completes discovery and application. */
export function isFinalClaimCheckpointBatch(progress: Pick<ClaimCheckpointProgress, 'nextSourceGame' | 'pendingSteps'>, transformCount?: number) {
	return progress.nextSourceGame === zeroAddress && progress.pendingSteps > 0n && progress.pendingSteps <= CLAIM_CHECKPOINT_MAX_STEPS && (transformCount === undefined || (Number.isSafeInteger(transformCount) && BigInt(transformCount) === progress.pendingSteps))
}

const applicationCalls = (pendingSteps: bigint) => (pendingSteps + CLAIM_CHECKPOINT_MAX_STEPS - 1n) / CLAIM_CHECKPOINT_MAX_STEPS

/** Unknown atomic availability uses the cheaper direct route, so reuse savings remain conservative. */
export function shouldInspectClaimCheckpointParent(progress: Pick<ClaimCheckpointProgress, 'nextSourceGame' | 'pendingSteps'>, settlement: ClaimCheckpointSettlement = 'unknown') {
	return progress.nextSourceGame === zeroAddress && applicationCalls(progress.pendingSteps) + (settlement === 'separate' ? 1n : 0n) > 3n
}

/** Rebuild only the current eight-transform segment from canonical contract state. */
export async function prepareClaimCheckpointBatch(context: {
	game: Address
	claim: ClaimCheckpointIdentity
	progress: ClaimCheckpointProgress
	maxSteps?: bigint
	state: { pendingCommitment: Hash; segmentSourceGame: Address; segmentPreviousCommitment: Hash; firstStep: bigint; steps: bigint }
	readTransform: (sourceGame: Address) => Promise<{ sourceGame: Address; transform: ClaimCheckpointTransform }>
}): Promise<ClaimCheckpointBatch> {
	const { game, claim, progress, state, readTransform, maxSteps = CLAIM_CHECKPOINT_MAX_STEPS } = context
	if (maxSteps <= 0n || maxSteps > CLAIM_CHECKPOINT_MAX_STEPS) throw new Error('Invalid claim checkpoint budget')
	if (progress.pendingSteps < 0n || (progress.complete && progress.pendingSteps !== 0n)) throw new Error('Invalid claim checkpoint progress')
	if (progress.pendingSteps === 0n && state.pendingCommitment !== zeroHash) throw new Error('Invalid empty claim checkpoint commitment')
	if (progress.complete || progress.nextSourceGame !== zeroAddress || progress.pendingSteps === 0n) return { baseCommitment: zeroHash, transforms: [] }
	if (!Number.isInteger(claim.outcomeIndex) || claim.outcomeIndex < 0 || claim.outcomeIndex >= 3 || claim.amountAttoRep < 0n || claim.cumulativeAmountAttoRep < claim.amountAttoRep || claim.leafIndex < 0n || claim.leafIndex >= 1n << 64n) throw new Error('Invalid claim checkpoint identity')
	const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [claim.outcomeIndex, claim.amountAttoRep, claim.cumulativeAmountAttoRep, claim.leafIndex]))
	const steps = Number(((progress.pendingSteps - 1n) % CLAIM_CHECKPOINT_MAX_STEPS) + 1n)
	if (state.steps !== BigInt(steps) || state.firstStep !== progress.pendingSteps - BigInt(steps)) throw new Error('Claim checkpoint segment changed; refresh and retry')
	const transforms: ClaimCheckpointTransform[] = []
	const batchStart = Math.max(0, steps - Number(maxSteps))
	let baseCommitment = state.segmentPreviousCommitment
	const visited = new Set<string>()
	let sourceGame = state.segmentSourceGame
	let commitment = state.segmentPreviousCommitment
	for (let step = 0; step < steps; step++) {
		if (sourceGame === zeroAddress) throw new Error('Missing claim checkpoint ancestor')
		if (visited.has(sourceGame.toLowerCase())) throw new Error('Claim checkpoint ancestor cycle')
		visited.add(sourceGame.toLowerCase())
		const next = await readTransform(sourceGame)
		const transform = next.transform
		if (transform.repBeforeAttoRep < 0n || transform.repRemainingAttoRep < 0n || transform.consumedBeforeAttoRep < 0n) throw new Error('Invalid claim checkpoint transform')
		if (step === batchStart) baseCommitment = commitment
		if (step >= batchStart) transforms.push(transform)
		commitment = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [game, claimId, commitment, transform.repBeforeAttoRep, transform.repRemainingAttoRep, transform.consumedBeforeAttoRep]))
		sourceGame = next.sourceGame
	}
	if (commitment.toLowerCase() !== state.pendingCommitment.toLowerCase()) throw new Error('Claim checkpoint commitment changed or witness is invalid; refresh and retry')
	return { baseCommitment, transforms }
}

export type ClaimCheckpointNode = {
	parentGame: Address
	historyFrozen: boolean
	progress: ClaimCheckpointProgress
}

type ClaimCheckpointRequest = { game: Address; claim: ClaimCheckpointIdentity; settlement?: ClaimCheckpointSettlement }
type ClaimCheckpointPreparation = Pick<ClaimCheckpointRequest, 'game' | 'claim'> & { targetGame: Address; reason: 'required' | 'shared-ancestor' | 'finishing-parent' }

function claimIdentityKey(claim: ClaimCheckpointIdentity) {
	return `${claim.outcomeIndex}:${claim.amountAttoRep}:${claim.cumulativeAmountAttoRep}:${claim.leafIndex}`
}

/** Select caller-paid caches only for authenticated demand; readNode must verify canonical routes at one block. */
export async function planClaimCheckpointPreparation(context: { claims: readonly ClaimCheckpointRequest[]; readNode: (game: Address, claim: ClaimCheckpointIdentity) => Promise<ClaimCheckpointNode>; maxAncestorReads?: number }): Promise<ClaimCheckpointPreparation[]> {
	const maximum = context.maxAncestorReads ?? 32
	if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 256) throw new Error('Invalid checkpoint ancestor read budget')
	let ancestorReads = 0
	const cache = new Map<string, Promise<ClaimCheckpointNode>>()
	function read(game: Address, claim: ClaimCheckpointIdentity, ancestor: boolean) {
		const key = `${game.toLowerCase()}:${claimIdentityKey(claim)}`
		let value = cache.get(key)
		if (value === undefined) {
			if (ancestor && ancestorReads >= maximum) return undefined
			if (ancestor) ancestorReads++
			value = context.readNode(game, claim)
			cache.set(key, value)
		}
		return value
	}
	const requests = new Map<string, ClaimCheckpointRequest>()
	for (const request of context.claims) requests.set(`${request.game.toLowerCase()}:${claimIdentityKey(request.claim)}`, request)
	// Read terminals first so the discovery cap never hides required progress presence.
	const targets = []
	for (const request of requests.values()) {
		const node = await read(request.game, request.claim, false)
		if (node === undefined) throw new Error('Missing terminal checkpoint')
		if (!node.progress.ready && !node.progress.complete) targets.push({ request, node })
	}
	const demandCounts = new Map<string, number>()
	for (const target of targets) {
		const key = claimIdentityKey(target.request.claim)
		demandCounts.set(key, (demandCounts.get(key) ?? 0) + 1)
	}
	const paths: { request: ClaimCheckpointRequest; nodes: { game: Address; node: ClaimCheckpointNode }[] }[] = []
	for (const target of targets) {
		const nodes = [{ game: target.request.game, node: target.node }]
		const visited = new Set([target.request.game.toLowerCase()])
		const sharedDemand = (demandCounts.get(claimIdentityKey(target.request.claim)) ?? 0) > 1
		const finishingParentPossible = shouldInspectClaimCheckpointParent(target.node.progress, target.request.settlement)
		let game = sharedDemand || finishingParentPossible ? target.node.parentGame : zeroAddress
		while (game !== zeroAddress) {
			if (visited.has(game.toLowerCase())) throw new Error('Claim checkpoint ancestor cycle')
			visited.add(game.toLowerCase())
			const node = await read(game, target.request.claim, true)
			if (node === undefined) break
			nodes.push({ game, node })
			if (node.progress.complete || (!sharedDemand && nodes.length === 3)) break
			game = node.parentGame
		}
		paths.push({ request: target.request, nodes })
	}
	const candidates = new Map<string, { game: Address; claim: ClaimCheckpointIdentity; paths: number[]; distance: number }>()
	for (const [pathIndex, path] of paths.entries()) {
		for (let index = 1; index < Math.min(2, path.nodes.length); index++) {
			const entry = path.nodes[index]
			if (entry === undefined || entry.node.progress.complete || entry.node.parentGame === zeroAddress) continue
			const parent = path.nodes[index + 1]
			// Check the transforms adoption/discovery would freeze, leaving the immediate parent's own direct claims live.
			if (parent === undefined || path.nodes.slice(2).some(value => !value.node.historyFrozen)) continue
			const key = `${entry.game.toLowerCase()}:${claimIdentityKey(path.request.claim)}`
			const candidate = candidates.get(key) ?? { game: entry.game, claim: path.request.claim, paths: [], distance: 0 }
			candidate.paths.push(pathIndex)
			candidate.distance += index
			candidates.set(key, candidate)
		}
	}
	function remainingCalls(path: (typeof paths)[number], game: Address) {
		const entry = path.nodes.find(value => value.game.toLowerCase() === game.toLowerCase())
		if (entry === undefined) return undefined
		const progress = entry.node.progress
		if (progress.complete) return 0n
		if (progress.nextSourceGame === zeroAddress) return progress.pendingSteps === 0n ? 1n : applicationCalls(progress.pendingSteps)
		const sourceIndex = path.nodes.findIndex(value => value.game.toLowerCase() === progress.nextSourceGame.toLowerCase())
		if (sourceIndex < 0 || path.nodes.at(-1)?.node.parentGame !== zeroAddress) return undefined
		const remaining = BigInt(path.nodes.length - sourceIndex)
		return applicationCalls(remaining) + applicationCalls(progress.pendingSteps + remaining)
	}
	const covered = new Set<number>()
	const jobs: ClaimCheckpointPreparation[] = []
	for (const candidate of [...candidates.values()].sort((left, right) => right.paths.length - left.paths.length || left.distance - right.distance)) {
		const beneficiaries = candidate.paths.filter(index => !covered.has(index))
		if (beneficiaries.length < 2) continue
		const first = paths[beneficiaries[0] ?? -1]
		if (first === undefined) throw new Error('Missing checkpoint beneficiary')
		const cacheCalls = remainingCalls(first, candidate.game)
		const terminalCalls = beneficiaries.map(index => {
			const path = paths[index]
			if (path === undefined) return undefined
			const preparationCalls = remainingCalls(path, path.request.game)
			// A nonempty final application can share its transaction with settlement only when supported.
			return preparationCalls === undefined ? undefined : preparationCalls + (path.request.settlement === 'separate' ? 1n : 0n)
		})
		if (cacheCalls === undefined || terminalCalls.some(value => value === undefined)) continue
		const unsharedCalls = terminalCalls.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n)
		// Count end-to-end transactions, not gas: empty parent adoption still needs a separate withdrawal.
		if (cacheCalls + 2n * BigInt(beneficiaries.length) >= unsharedCalls) continue
		jobs.push({ targetGame: first.request.game, game: candidate.game, claim: candidate.claim, reason: 'shared-ancestor' })
		for (const index of beneficiaries) covered.add(index)
	}
	for (const [index, path] of paths.entries()) {
		if (covered.has(index)) continue
		const target = path.nodes[0]
		const parent = path.nodes[1]
		const source = path.nodes[2]
		if (target === undefined) throw new Error('Missing terminal checkpoint path')
		// One parent application, adoption, and withdrawal must strictly beat the known direct route.
		const finishParent = parent !== undefined && source !== undefined && source.node.historyFrozen && !parent.node.progress.complete && isFinalClaimCheckpointBatch(parent.node.progress) && shouldInspectClaimCheckpointParent(target.node.progress, path.request.settlement)
		jobs.push({ targetGame: path.request.game, game: finishParent ? parent.game : path.request.game, claim: path.request.claim, reason: finishParent ? 'finishing-parent' : 'required' })
	}
	return jobs
}
