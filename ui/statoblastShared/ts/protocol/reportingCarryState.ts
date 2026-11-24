import { bigintToSafeNumber, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame, statoblast_QuestionLedger_QuestionLedger } from '../contractArtifact.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { AuthenticatedForkClaim, CarriedDepositProof, ImportedEscalationDeposit } from '../types/contracts.js'
import { readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { requireAddressValue, requireArrayValue, requireBigintValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js'
import { getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { executeForkAuctionAction, readQuestionLedgerUniverseId } from './questionLedgerActions.js'
import { buildCarryMerkleMountainRangeProof, createSparseNullifier, hashCarryLeaf } from './reportingCarryProof.js'
import { compareBigint } from '@zoltar/core-shared/math/bigint'
import { claimStateChanged } from './claimActionState.js'
import { withClaimReadContext } from './claimReadContext.js'
import { CONTRACT_PAGE_SIZE } from './pagination.js'

const EMPTY_CARRY_LEAF_HASH = ('0x' + '00'.repeat(32)) as Hex

type CarryLeafViewStruct = {
	cumulativeAmountAttoRep: bigint
	depositor: Address
	parentDepositIndex: bigint
	amountAttoRep: bigint
	sourceNodeId: bigint
}

type HistoricalCarryLeafViewStruct = CarryLeafViewStruct & {
	carryLeafIndex: bigint
}

type HistoricalCarrySnapshotEntry = {
	leaf: CarryLeafViewStruct
	leafHash: Hex
}

function requireCarryLeafView(value: unknown, context: string): CarryLeafViewStruct {
	const leaf = requireObjectValue(value, context)
	if ('amountAttoRep' in leaf && 'cumulativeAmountAttoRep' in leaf && 'depositor' in leaf && 'parentDepositIndex' in leaf && 'sourceNodeId' in leaf) {
		return {
			cumulativeAmountAttoRep: requireBigintValue(leaf.cumulativeAmountAttoRep, context),
			depositor: requireAddressValue(leaf.depositor, context),
			parentDepositIndex: requireBigintValue(leaf.parentDepositIndex, context),
			amountAttoRep: requireBigintValue(leaf.amountAttoRep, context),
			sourceNodeId: requireBigintValue(leaf.sourceNodeId, context),
		}
	}
	throw new Error(`Unexpected ${context} response`)
}

function requireCarryLeafPageResponse(value: unknown): {
	page: CarryLeafViewStruct[]
	nextNodeId: bigint
} {
	const [page, nextNodeId] = requireTupleValue(value, 2, 'carry leaf page')
	return {
		page: requireArrayValue(page, 'carry leaf page').map(leaf => requireCarryLeafView(leaf, 'carry leaf page')),
		nextNodeId: requireBigintValue(nextNodeId, 'carry leaf page'),
	}
}

async function loadCarryLeafPage(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey) {
	let startNodeId = 0n
	const carryLeaves: CarryLeafViewStruct[] = []
	while (true) {
		const { page, nextNodeId } = requireCarryLeafPageResponse(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'getCarryLeafPageByOutcome',
				args: [getReportingOutcomeValue(outcome), startNodeId, CONTRACT_PAGE_SIZE],
			}),
		)
		carryLeaves.push(...page)
		if (nextNodeId === 0n) break
		startNodeId = nextNodeId
	}
	return carryLeaves
}

function requireHistoricalCarryNode(value: unknown, sourceNodeId: bigint, outcome: ReportingOutcomeKey): { leaf: HistoricalCarryLeafViewStruct; parentNodeId: bigint } {
	const [parentNodeId, depositor, nodeOutcome, amountAttoRep, parentDepositIndex, cumulativeAmountAttoRep, carryLeafIndex] = requireTupleValue(value, 7, 'historical carry node')
	if (requireIntegerLikeValue(nodeOutcome, 'historical carry node outcome') !== getReportingOutcomeValue(outcome)) throw new Error('Unexpected historical carry node outcome')
	return {
		leaf: {
			amountAttoRep: requireBigintValue(amountAttoRep, 'historical carry node amount'),
			carryLeafIndex: requireBigintValue(carryLeafIndex, 'historical carry node leaf index'),
			cumulativeAmountAttoRep: requireBigintValue(cumulativeAmountAttoRep, 'historical carry node cumulative amount'),
			depositor: requireAddressValue(depositor, 'historical carry node depositor'),
			parentDepositIndex: requireBigintValue(parentDepositIndex, 'historical carry node parent deposit index'),
			sourceNodeId,
		},
		parentNodeId: requireBigintValue(parentNodeId, 'historical carry node parent node id'),
	}
}

async function loadHistoricalLocalCarryLeaves(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey, localHeadNodeId: bigint) {
	let nodeId = localHeadNodeId
	const visitedNodeIds = new Set<string>()
	const carryLeaves: HistoricalCarryLeafViewStruct[] = []
	while (nodeId !== 0n) {
		const nodeKey = nodeId.toString()
		if (visitedNodeIds.has(nodeKey)) throw new Error('Historical carry node chain contains a cycle.')
		visitedNodeIds.add(nodeKey)
		const { leaf, parentNodeId } = requireHistoricalCarryNode(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'nodes',
				args: [nodeId],
			}),
			nodeId,
			outcome,
		)
		carryLeaves.push(leaf)
		nodeId = parentNodeId
	}
	return carryLeaves.sort((left, right) => compareBigint(left.carryLeafIndex, right.carryLeafIndex))
}

async function readAppendOnlyCarry(client: Pick<ReadClient, 'readContract'>, game: Address) {
	return await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'appendOnlyCarry' })
}

async function buildHistoricalLocalCarrySnapshotEntries(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey, localLeaves: readonly HistoricalCarryLeafViewStruct[]): Promise<HistoricalCarrySnapshotEntry[]> {
	if (await readAppendOnlyCarry(client, escalationGameAddress)) return localLeaves.map(leaf => ({ leaf, leafHash: hashCarryLeaf(leaf, outcome) }))
	const activeLeaves = await loadCarryLeafPage(client, escalationGameAddress, outcome)
	const activeSourceNodeIds = new Set(activeLeaves.map(leaf => leaf.sourceNodeId.toString()))
	return localLeaves.map(leaf => {
		const sourceNodeId = leaf.sourceNodeId.toString()
		return {
			leaf,
			leafHash: activeSourceNodeIds.has(sourceNodeId) ? hashCarryLeaf(leaf, outcome) : EMPTY_CARRY_LEAF_HASH,
		}
	})
}

async function loadRecursiveHistoricalCarryLeaves(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<HistoricalCarrySnapshotEntry[]> {
	const [outcomeState, forkContinuation] = await Promise.all([readEscalationOutcomeState(client, escalationGameAddress, outcome), readForkContinuation(client, escalationGameAddress)])
	const snapshotLeafCount = outcomeState.snapshotLeafCount
	const localLeaves = await loadHistoricalLocalCarryLeaves(client, escalationGameAddress, outcome, outcomeState.localHeadNodeId)
	let inheritedLeaves: HistoricalCarrySnapshotEntry[] = []
	const parentEscalationGameAddress = forkContinuation === true ? await readParentEscalationGameAddress(client, escalationGameAddress) : undefined
	if (parentEscalationGameAddress !== undefined) {
		const parentLeaves = await loadRecursiveHistoricalCarryLeaves(client, parentEscalationGameAddress, outcome)
		if (BigInt(parentLeaves.length) < snapshotLeafCount) throw new Error('Inherited historical carry snapshot is incomplete.')
		inheritedLeaves = parentLeaves.slice(0, bigintToSafeNumber(snapshotLeafCount, 'Snapshot leaf count'))
	}
	if (BigInt(inheritedLeaves.length) !== snapshotLeafCount) throw new Error('Inherited historical carry snapshot is not locally reconstructible.')
	for (const [localIndex, leaf] of localLeaves.entries()) {
		if (leaf.carryLeafIndex !== snapshotLeafCount + BigInt(localIndex)) throw new Error('Historical carry leaf order is not locally reconstructible.')
	}
	const localEntries = await buildHistoricalLocalCarrySnapshotEntries(client, escalationGameAddress, outcome, localLeaves)
	return [...inheritedLeaves, ...localEntries]
}

async function loadProofConsumedCarriedDepositIndexes(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey) {
	let startIndex = 0n
	const parentDepositIndexes: bigint[] = []
	while (true) {
		const page = requireArrayValue(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'getProofConsumedCarriedDepositIndexesByOutcome',
				args: [getReportingOutcomeValue(outcome), startIndex, CONTRACT_PAGE_SIZE],
			}),
			'consumed carried deposit index page',
		).map(item => requireBigintValue(item, 'consumed carried deposit index page'))
		parentDepositIndexes.push(...page)
		if (BigInt(page.length) !== CONTRACT_PAGE_SIZE) break
		startIndex += CONTRACT_PAGE_SIZE
	}
	return parentDepositIndexes
}

async function loadRecursiveProofConsumedCarriedDepositIndexes(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<bigint[]> {
	const [localConsumedIndexes, forkContinuation] = await Promise.all([loadProofConsumedCarriedDepositIndexes(client, escalationGameAddress, outcome), readForkContinuation(client, escalationGameAddress)])
	if (forkContinuation !== true || (await readAppendOnlyCarry(client, escalationGameAddress))) return localConsumedIndexes
	const parentEscalationGameAddress = await readParentEscalationGameAddress(client, escalationGameAddress)
	if (parentEscalationGameAddress === undefined) return localConsumedIndexes
	const inheritedConsumedIndexes = await loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome)
	return [...inheritedConsumedIndexes, ...localConsumedIndexes]
}

/** The escalation game of the parent pool a fork continuation inherits from, or `undefined` when there is none. */
async function readParentEscalationGameAddress(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address) {
	const questionLedgerAddress = await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'questionLedger',
		args: [],
	})
	const parentQuestionLedgerAddress = await client.readContract({
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		address: questionLedgerAddress,
		functionName: 'parent',
		args: [],
	})
	if (parentQuestionLedgerAddress === zeroAddress) return undefined
	const parentEscalationGameAddress = await client.readContract({
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		address: parentQuestionLedgerAddress,
		functionName: 'escalationGame',
		args: [],
	})
	return parentEscalationGameAddress === zeroAddress ? undefined : parentEscalationGameAddress
}

export async function readForkContinuation(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address) {
	return await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'forkContinuation',
		args: [],
	})
}

export async function readEscalationOutcomeState(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey) {
	return await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'getOutcomeState',
		args: [getReportingOutcomeValue(outcome)],
	})
}

async function loadRecursiveCarrySnapshot(
	client: Pick<ReadClient, 'readContract'>,
	escalationGameAddress: Address,
	outcome: ReportingOutcomeKey,
): Promise<{
	orderedLeaves: CarryLeafViewStruct[]
	carryRoot: Hex
	carryLeafCount: bigint
	nullifierRoot: Hex
}> {
	const [outcomeState, forkContinuation, localLeaves] = await Promise.all([readEscalationOutcomeState(client, escalationGameAddress, outcome), readForkContinuation(client, escalationGameAddress), loadCarryLeafPage(client, escalationGameAddress, outcome)])
	const { currentCarryRoot: carryRoot, currentLeafCount: carryLeafCount, currentNullifierRoot: nullifierRoot } = outcomeState
	const orderedLocalLeaves = [...localLeaves].sort((left, right) => compareBigint(left.sourceNodeId, right.sourceNodeId))
	const parentEscalationGameAddress = forkContinuation === true ? await readParentEscalationGameAddress(client, escalationGameAddress) : undefined
	if (parentEscalationGameAddress === undefined) {
		return {
			orderedLeaves: orderedLocalLeaves,
			carryRoot,
			carryLeafCount,
			nullifierRoot,
		}
	}
	const parentSnapshot = await loadRecursiveCarrySnapshot(client, parentEscalationGameAddress, outcome)
	return {
		orderedLeaves: [...parentSnapshot.orderedLeaves, ...orderedLocalLeaves],
		carryRoot,
		carryLeafCount,
		nullifierRoot,
	}
}

function authenticateCarrySnapshot(parentHistoricalLeaves: readonly HistoricalCarrySnapshotEntry[], childOutcomeState: Awaited<ReturnType<typeof readEscalationOutcomeState>>) {
	const { snapshotLeafCount: parentCarryLeafCount, snapshotCarryRoot: snapshotRoot } = childOutcomeState
	if (BigInt(parentHistoricalLeaves.length) < parentCarryLeafCount) throw new Error('Parent carry snapshot is not locally reconstructible.')
	const orderedEntries = parentHistoricalLeaves.slice(0, bigintToSafeNumber(parentCarryLeafCount, 'Parent carry leaf count'))
	const orderedLeaves = orderedEntries.map(entry => entry.leaf)
	const leafHashes = orderedEntries.map(entry => entry.leafHash)
	if (leafHashes.length > 0 && buildCarryMerkleMountainRangeProof(leafHashes, 0).root !== snapshotRoot) throw new Error('Parent carry snapshot root is not locally reconstructible.')
	return { orderedEntries, orderedLeaves, leafHashes, snapshotRoot }
}

async function loadParentSnapshot(client: Pick<ReadClient, 'readContract'>, childEscalationGameAddress: Address, parentQuestionLedgerAddress: Address, outcome: ReportingOutcomeKey, depositor: Address): Promise<ImportedEscalationDeposit[]> {
	const parentEscalationGameAddress = await client.readContract({
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		address: parentQuestionLedgerAddress,
		functionName: 'escalationGame',
		args: [],
	})
	if (parentEscalationGameAddress === zeroAddress) return []
	const [{ orderedLeaves: parentSnapshotLeaves }, inheritedConsumedParentDepositIndexes, localConsumedParentDepositIndexes, historicalLeaves, childOutcomeState] = await Promise.all([
		loadRecursiveCarrySnapshot(client, parentEscalationGameAddress, outcome),
		loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome),
		loadProofConsumedCarriedDepositIndexes(client, childEscalationGameAddress, outcome),
		loadRecursiveHistoricalCarryLeaves(client, parentEscalationGameAddress, outcome),
		readEscalationOutcomeState(client, childEscalationGameAddress, outcome),
	])
	const { orderedEntries, snapshotRoot } = authenticateCarrySnapshot(historicalLeaves, childOutcomeState)
	const consumedParentDepositIndexes = [...inheritedConsumedParentDepositIndexes, ...localConsumedParentDepositIndexes]
	const consumedParentDepositIndexSet = new Set(consumedParentDepositIndexes.map(value => value.toString()))
	return await Promise.all(
		parentSnapshotLeaves
			.filter(leaf => sameAddress(leaf.depositor, depositor) && !consumedParentDepositIndexSet.has(leaf.parentDepositIndex.toString()))
			.map(async leaf => {
				const leafIndex = orderedEntries.findIndex(entry => entry.leaf.parentDepositIndex === leaf.parentDepositIndex && entry.leafHash === hashCarryLeaf(leaf, outcome))
				if (leafIndex < 0) throw new Error('Inherited claim history is incomplete.')
				const claimIdentity: AuthenticatedForkClaim = {
					escalationGame: childEscalationGameAddress,
					outcome,
					snapshotRoot,
					snapshotLeafCount: childOutcomeState.snapshotLeafCount,
					amountAttoRep: leaf.amountAttoRep,
					cumulativeAmountAttoRep: leaf.cumulativeAmountAttoRep,
					depositor: leaf.depositor,
					parentDepositIndex: leaf.parentDepositIndex,
					leafIndex: BigInt(leafIndex),
				}
				return { amountAttoRep: leaf.amountAttoRep, cumulativeAmountAttoRep: leaf.cumulativeAmountAttoRep, depositor: leaf.depositor, parentDepositIndex: leaf.parentDepositIndex, claimIdentity }
			}),
	)
}
export async function loadForkCarriedEscalationDepositsFromParentSnapshot(client: Parameters<typeof withClaimReadContext>[0], childEscalationGameAddress: Address, parentQuestionLedgerAddress: Address, outcome: ReportingOutcomeKey, depositor: Address): Promise<ImportedEscalationDeposit[]> {
	return await withClaimReadContext(client, context => loadParentSnapshot(context, childEscalationGameAddress, parentQuestionLedgerAddress, outcome, depositor))
}

export async function buildForkCarriedEscalationProofs(client: ReadClient, questionLedgerAddress: Address, outcome: ReportingOutcomeKey, parentDepositIndexes: readonly bigint[]): Promise<CarriedDepositProof[]> {
	return await withClaimReadContext(client, async (context, blockNumber) => {
		const [parentQuestionLedgerAddress, childEscalationGameAddress] = await readRequiredMulticall(
			client,
			[
				{ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'parent', args: [] },
				{ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'escalationGame', args: [] },
			],
			blockNumber,
		)
		return await buildCarriedProofs(context, parentQuestionLedgerAddress, childEscalationGameAddress, outcome, parentDepositIndexes)
	})
}

async function buildCarriedProofs(client: Pick<ReadClient, 'readContract'>, parentQuestionLedgerAddress: Address, childEscalationGameAddress: Address, outcome: ReportingOutcomeKey, parentDepositIndexes: readonly bigint[]): Promise<CarriedDepositProof[]> {
	if (parentQuestionLedgerAddress === zeroAddress) throw new Error('Parent deposits can only be settled in a child question.')
	if (childEscalationGameAddress === zeroAddress) throw new Error('The child escalation game is unavailable for settling parent deposits.')
	const parentEscalationGameAddress = await client.readContract({
		address: parentQuestionLedgerAddress,
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		functionName: 'escalationGame',
		args: [],
	})
	if (parentEscalationGameAddress === zeroAddress) throw new Error('The parent escalation game is unavailable for settling parent deposits.')
	const [parentHistoricalLeaves, inheritedConsumedParentDepositIndexes, localConsumedParentDepositIndexes, childOutcomeState] = await Promise.all([
		loadRecursiveHistoricalCarryLeaves(client, parentEscalationGameAddress, outcome),
		loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome),
		loadProofConsumedCarriedDepositIndexes(client, childEscalationGameAddress, outcome),
		readEscalationOutcomeState(client, childEscalationGameAddress, outcome),
	])
	const consumedParentDepositIndexes = [...inheritedConsumedParentDepositIndexes, ...localConsumedParentDepositIndexes]
	const { currentNullifierRoot: childNullifierRoot } = childOutcomeState
	const { orderedLeaves, leafHashes } = authenticateCarrySnapshot(parentHistoricalLeaves, childOutcomeState)
	const appendOnly = await readAppendOnlyCarry(client, childEscalationGameAddress)
	const nullifierTree = appendOnly
		? undefined
		: createSparseNullifier(
				consumedParentDepositIndexes.map(parentIndex => {
					const index = orderedLeaves.findIndex(leaf => leaf.parentDepositIndex === parentIndex)
					if (index < 0) throw new Error('Consumed carry deposit is absent from the snapshot')
					return BigInt(index)
				}),
			)
	if (nullifierTree !== undefined && nullifierTree.getRoot() !== childNullifierRoot) throw new Error('Child proof-consumed carry state is not locally reconstructible.')
	const consumedParentDepositIndexSet = new Set(consumedParentDepositIndexes.map(parentDepositIndex => parentDepositIndex.toString()))
	const proofs: CarriedDepositProof[] = []
	for (const parentDepositIndex of parentDepositIndexes) {
		const parentDepositIndexKey = parentDepositIndex.toString()
		if (consumedParentDepositIndexSet.has(parentDepositIndexKey)) throw claimStateChanged(`Parent deposit #${parentDepositIndexKey} is already settled.`)
		const leafIndex = orderedLeaves.findIndex(leaf => leaf.parentDepositIndex === parentDepositIndex)
		if (leafIndex === -1) throw new Error(`Parent deposit #${parentDepositIndex.toString()} is unavailable.`)
		const targetLeaf = orderedLeaves[leafIndex]
		if (targetLeaf === undefined) throw new Error(`Parent deposit #${parentDepositIndex.toString()} is unavailable.`)
		const { leafIndex: globalLeafIndex, merkleMountainRangePeakIndex, merkleMountainRangeSiblings } = buildCarryMerkleMountainRangeProof(leafHashes, leafIndex)
		const nullifierSiblings = nullifierTree?.getProof(globalLeafIndex) ?? []
		proofs.push({
			amountAttoRep: targetLeaf.amountAttoRep,
			cumulativeAmountAttoRep: targetLeaf.cumulativeAmountAttoRep,
			depositor: targetLeaf.depositor,
			leafIndex: globalLeafIndex,
			merkleMountainRangePeakIndex,
			merkleMountainRangeSiblings,
			nullifierSiblings,
			parentDepositIndex: targetLeaf.parentDepositIndex,
			sourceNodeId: targetLeaf.sourceNodeId,
		})
		nullifierTree?.consume(globalLeafIndex)
		consumedParentDepositIndexSet.add(parentDepositIndexKey)
	}
	return proofs
}

export async function withdrawForkedEscalationDeposits(client: WriteClient, questionLedgerAddress: Address, outcome: ReportingOutcomeKey, proofs: readonly CarriedDepositProof[]) {
	const universeId = await readQuestionLedgerUniverseId(client, questionLedgerAddress)
	return await executeForkAuctionAction(
		'settleForkedEscalation',
		questionLedgerAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: questionLedgerAddress,
				abi: statoblast_QuestionLedger_QuestionLedger.abi,
				functionName: 'withdrawForkedEscalationDeposits',
				args: [
					getReportingOutcomeValue(outcome),
					proofs.map(proof => ({
						...proof,
						merkleMountainRangeSiblings: Array.from(proof.merkleMountainRangeSiblings),
						nullifierSiblings: Array.from(proof.nullifierSiblings),
					})),
				],
			})),
	)
}
