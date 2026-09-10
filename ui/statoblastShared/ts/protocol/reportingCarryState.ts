import { bigintToSafeNumber, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool, statoblast_SecurityPoolForker_SecurityPoolForker } from '../contractArtifact.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { CarriedDepositProof, ImportedEscalationDeposit, ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { requireAddressValue, requireArrayValue, requireBigintValue, requireBooleanValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js'
import { getReportingOutcomeValue } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { executeForkAuctionAction, readSecurityPoolUniverseId } from './securityPoolActions.js'
import { bagCarryPeaks, buildCarryMerkleMountainRangeProof, buildCarryPeakHeights, compareBigintAscending, createSparseNullifier, hashCarryLeaf } from './reportingCarryProof.js'
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
	return carryLeaves.sort((left, right) => compareBigintAscending(left.carryLeafIndex, right.carryLeafIndex))
}

async function buildHistoricalLocalCarrySnapshotEntries(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey, localLeaves: readonly HistoricalCarryLeafViewStruct[]): Promise<HistoricalCarrySnapshotEntry[]> {
	const activeLeaves = await loadCarryLeafPage(client, escalationGameAddress, outcome)
	const activeSourceNodeIds = new Set(activeLeaves.map(leaf => leaf.sourceNodeId.toString()))
	const inactiveLeaves = localLeaves.filter(leaf => !activeSourceNodeIds.has(leaf.sourceNodeId.toString()))
	const directlyClaimedSourceNodeIds = new Set<string>()
	if (inactiveLeaves.length > 0) {
		const securityPoolAddress = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'securityPool',
			args: [],
		})
		const securityPoolForkerAddress = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPoolAddress,
			functionName: 'securityPoolForker',
			args: [],
		})
		const directlyClaimed = await Promise.all(
			inactiveLeaves.map(async leaf =>
				requireBooleanValue(
					await client.readContract({
						abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
						address: securityPoolForkerAddress,
						functionName: 'isEscalationDepositClaimedDirectly',
						args: [securityPoolAddress, getReportingOutcomeValue(outcome), leaf.parentDepositIndex],
					}),
					'historical carry direct-claim status',
				),
			),
		)
		for (const [index, directlyClaimedLeaf] of directlyClaimed.entries()) {
			if (directlyClaimedLeaf) {
				const leaf = inactiveLeaves[index]
				if (leaf === undefined) throw new Error('Missing directly claimed historical carry leaf.')
				directlyClaimedSourceNodeIds.add(leaf.sourceNodeId.toString())
			}
		}
	}
	return localLeaves.map(leaf => {
		const sourceNodeId = leaf.sourceNodeId.toString()
		return {
			leaf,
			leafHash: activeSourceNodeIds.has(sourceNodeId) || directlyClaimedSourceNodeIds.has(sourceNodeId) ? hashCarryLeaf(leaf, outcome) : EMPTY_CARRY_LEAF_HASH,
		}
	})
}

async function loadRecursiveHistoricalCarryLeaves(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<HistoricalCarrySnapshotEntry[]> {
	const [outcomeState, forkContinuation] = await Promise.all([readEscalationOutcomeState(client, escalationGameAddress, outcome), readForkContinuation(client, escalationGameAddress)])
	const snapshotLeafCount = outcomeState.snapshotLeafCount
	const localLeaves = await loadHistoricalLocalCarryLeaves(client, escalationGameAddress, outcome, outcomeState.localHeadNodeId)
	let inheritedLeaves: HistoricalCarrySnapshotEntry[] = []
	if (forkContinuation === true) {
		const securityPoolAddress = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'securityPool',
			args: [],
		})
		const parentSecurityPoolAddress = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPoolAddress,
			functionName: 'parent',
			args: [],
		})
		if (parentSecurityPoolAddress !== zeroAddress) {
			const parentEscalationGameAddress = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: parentSecurityPoolAddress,
				functionName: 'escalationGame',
				args: [],
			})
			if (parentEscalationGameAddress !== zeroAddress) {
				const parentLeaves = await loadRecursiveHistoricalCarryLeaves(client, parentEscalationGameAddress, outcome)
				if (BigInt(parentLeaves.length) < snapshotLeafCount) throw new Error('Inherited historical carry snapshot is incomplete.')
				inheritedLeaves = parentLeaves.slice(0, bigintToSafeNumber(snapshotLeafCount, 'Snapshot leaf count'))
			}
		}
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
	if (forkContinuation !== true) return localConsumedIndexes
	const securityPoolAddress = await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'securityPool',
		args: [],
	})
	const parentSecurityPoolAddress = await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		address: securityPoolAddress,
		functionName: 'parent',
		args: [],
	})
	if (parentSecurityPoolAddress === zeroAddress) return localConsumedIndexes
	const parentEscalationGameAddress = await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		address: parentSecurityPoolAddress,
		functionName: 'escalationGame',
		args: [],
	})
	if (parentEscalationGameAddress === zeroAddress) return localConsumedIndexes
	const inheritedConsumedIndexes = await loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome)
	return [...inheritedConsumedIndexes, ...localConsumedIndexes]
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
	const orderedLocalLeaves = [...localLeaves].sort((left, right) => compareBigintAscending(left.sourceNodeId, right.sourceNodeId))
	if (forkContinuation !== true) {
		return {
			orderedLeaves: orderedLocalLeaves,
			carryRoot,
			carryLeafCount,
			nullifierRoot,
		}
	}
	const securityPoolAddress = await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'securityPool',
		args: [],
	})
	const parentSecurityPoolAddress = await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		address: securityPoolAddress,
		functionName: 'parent',
		args: [],
	})
	if (parentSecurityPoolAddress === zeroAddress) {
		return {
			orderedLeaves: orderedLocalLeaves,
			carryRoot,
			carryLeafCount,
			nullifierRoot,
		}
	}
	const parentEscalationGameAddress = await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		address: parentSecurityPoolAddress,
		functionName: 'escalationGame',
		args: [],
	})
	if (parentEscalationGameAddress === zeroAddress) {
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

export async function loadForkCarriedEscalationDepositsFromParentSnapshot(client: Pick<ReadClient, 'readContract'>, childEscalationGameAddress: Address, parentSecurityPoolAddress: Address, outcome: ReportingOutcomeKey, depositor: Address): Promise<ImportedEscalationDeposit[]> {
	const parentEscalationGameAddress = await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		address: parentSecurityPoolAddress,
		functionName: 'escalationGame',
		args: [],
	})
	if (parentEscalationGameAddress === zeroAddress) return []
	const [{ orderedLeaves: parentSnapshotLeaves }, inheritedConsumedParentDepositIndexes, localConsumedParentDepositIndexes] = await Promise.all([
		loadRecursiveCarrySnapshot(client, parentEscalationGameAddress, outcome),
		loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome),
		loadProofConsumedCarriedDepositIndexes(client, childEscalationGameAddress, outcome),
	])
	const consumedParentDepositIndexes = [...inheritedConsumedParentDepositIndexes, ...localConsumedParentDepositIndexes]
	const consumedParentDepositIndexSet = new Set(consumedParentDepositIndexes.map(value => value.toString()))
	return parentSnapshotLeaves
		.filter(leaf => sameAddress(leaf.depositor, depositor) && !consumedParentDepositIndexSet.has(leaf.parentDepositIndex.toString()))
		.map(leaf => ({
			amountAttoRep: leaf.amountAttoRep,
			cumulativeAmountAttoRep: leaf.cumulativeAmountAttoRep,
			depositor: leaf.depositor,
			parentDepositIndex: leaf.parentDepositIndex,
		}))
}
export async function buildForkCarriedEscalationProofs(client: ReadClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, parentDepositIndexes: readonly bigint[]): Promise<CarriedDepositProof[]> {
	const [parentSecurityPoolAddress, childEscalationGameAddress] = await readRequiredMulticall(client, [
		{
			address: securityPoolAddress,
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'parent',
			args: [],
		},
		{
			address: securityPoolAddress,
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			args: [],
		},
	])
	if (parentSecurityPoolAddress === zeroAddress) throw new Error('Fork-carried escalation proofs require a child pool.')
	if (childEscalationGameAddress === zeroAddress) throw new Error('Child escalation game unavailable for fork-carried settlement.')
	const parentEscalationGameAddress = await client.readContract({
		address: parentSecurityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		args: [],
	})
	if (parentEscalationGameAddress === zeroAddress) throw new Error('Parent escalation game unavailable for fork-carried settlement.')
	const [parentHistoricalLeaves, inheritedConsumedParentDepositIndexes, localConsumedParentDepositIndexes, childOutcomeState] = await Promise.all([
		loadRecursiveHistoricalCarryLeaves(client, parentEscalationGameAddress, outcome),
		loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome),
		loadProofConsumedCarriedDepositIndexes(client, childEscalationGameAddress, outcome),
		readEscalationOutcomeState(client, childEscalationGameAddress, outcome),
	])
	const consumedParentDepositIndexes = [...inheritedConsumedParentDepositIndexes, ...localConsumedParentDepositIndexes]
	const { currentNullifierRoot: childNullifierRoot, snapshotLeafCount: parentCarryLeafCount, snapshotPeaks } = childOutcomeState
	if (BigInt(parentHistoricalLeaves.length) < parentCarryLeafCount) throw new Error('Parent carry snapshot is not locally reconstructible.')
	const orderedEntries = parentHistoricalLeaves.slice(0, bigintToSafeNumber(parentCarryLeafCount, 'Parent carry leaf count'))
	const orderedLeaves = orderedEntries.map(entry => entry.leaf)
	const leafHashes = orderedEntries.map(entry => entry.leafHash)
	if (leafHashes.length > 0) {
		const { root: reconstructedRoot } = buildCarryMerkleMountainRangeProof(leafHashes, 0)
		const snapshotPeakHeights = buildCarryPeakHeights(parentCarryLeafCount).sort((left, right) => left - right)
		const snapshotRoot = bagCarryPeaks(
			snapshotPeakHeights.map(peakHeight => {
				const peak = snapshotPeaks[peakHeight]
				if (peak === undefined) throw new Error('Missing parent carry snapshot peak.')
				return peak
			}),
		)
		if (reconstructedRoot !== snapshotRoot) throw new Error('Parent carry snapshot root is not locally reconstructible.')
	}
	const nullifierTree = createSparseNullifier(consumedParentDepositIndexes)
	if (nullifierTree.getRoot() !== childNullifierRoot) throw new Error('Child proof-consumed carry state is not locally reconstructible.')
	const consumedParentDepositIndexSet = new Set(consumedParentDepositIndexes.map(parentDepositIndex => parentDepositIndex.toString()))
	const proofs: CarriedDepositProof[] = []
	for (const parentDepositIndex of parentDepositIndexes) {
		const parentDepositIndexKey = parentDepositIndex.toString()
		if (consumedParentDepositIndexSet.has(parentDepositIndexKey)) throw new Error(`Parent carry leaf ${parentDepositIndexKey} is already settled.`)
		const leafIndex = orderedLeaves.findIndex(leaf => leaf.parentDepositIndex === parentDepositIndex)
		if (leafIndex === -1) throw new Error(`Parent carry leaf ${parentDepositIndex.toString()} is unavailable.`)
		const targetLeaf = orderedLeaves[leafIndex]
		if (targetLeaf === undefined) throw new Error(`Parent carry leaf ${parentDepositIndex.toString()} is unavailable.`)
		const { merkleMountainRangePeakIndex, merkleMountainRangeSiblings, peakRelativeLeafIndex } = buildCarryMerkleMountainRangeProof(leafHashes, leafIndex)
		const nullifierSiblings = nullifierTree.getProof(parentDepositIndex)
		proofs.push({
			amountAttoRep: targetLeaf.amountAttoRep,
			cumulativeAmountAttoRep: targetLeaf.cumulativeAmountAttoRep,
			depositor: targetLeaf.depositor,
			leafIndex: BigInt(peakRelativeLeafIndex),
			merkleMountainRangePeakIndex,
			merkleMountainRangeSiblings,
			nullifierSiblings,
			parentDepositIndex: targetLeaf.parentDepositIndex,
			sourceNodeId: targetLeaf.sourceNodeId,
		})
		nullifierTree.consume(parentDepositIndex)
		consumedParentDepositIndexSet.add(parentDepositIndexKey)
	}
	return proofs
}

export async function withdrawForkedEscalationDeposits(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, proofs: readonly CarriedDepositProof[]) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	return await executeForkAuctionAction(
		client,
		'settleForkedEscalation',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: securityPoolAddress,
				abi: statoblast_SecurityPool_SecurityPool.abi,
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
