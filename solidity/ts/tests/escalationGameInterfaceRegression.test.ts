import { test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { readFileSync, writeFileSync } from 'node:fs'
import { keccak256, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getArray, getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

const escalationGameSourcePath = 'contracts/statoblast/EscalationGame.sol'
const escalationGameContractName = 'EscalationGame'
const escalationGameBytecodeSnapshotPath = `${import.meta.dir}/fixtures/escalationGameBytecode.snapshot.json`
const eip170DeployedBytecodeLimitBytes = 24_576

test('production games expose no ancestor checkpoint interface or linked libraries', () => {
	const output = getEscalationGameOutput()
	const abi = getArray(output['abi'], 'Game ABI missing')
	const names = abi.map(entry => getRecord(entry, 'Invalid ABI entry')['name'])
	for (const removed of ['processClaimCheckpoint', 'getInheritedClaimAllocation', 'getClaimCheckpointProgress', 'rootClaimSourceGame']) assert.ok(!names.includes(removed))
	const evm = getRecord(output['evm'], 'Game EVM missing')
	assert.deepStrictEqual(getRecord(evm['bytecode'], 'Creation bytecode missing')['linkReferences'], {})
})

type EscalationGameBytecodeSnapshot = {
	creationBytes: number
	deployedBytes: number
	deployedBytecodeWithoutMetadataHash: Hex
}

function getEscalationGameOutput(): Record<string, unknown> {
	const artifacts = loadContractsJson(import.meta.dir)
	return getContractOutput(artifacts, escalationGameSourcePath, escalationGameContractName)
}

function storageEntrySummary(entry: { label: string; slot: string; offset: number; type: Record<string, unknown> }) {
	return {
		label: entry.label,
		slot: entry.slot,
		offset: entry.offset,
		type: getString(entry.type['label'], `Missing normalized type label for ${entry.label}`),
	}
}

function getStorageTypes(contractOutput: Record<string, unknown>): Record<string, unknown> {
	const storageLayout = getRecord(contractOutput['storageLayout'], 'EscalationGame output is missing storageLayout')
	return getRecord(storageLayout['types'], 'EscalationGame storageLayout is missing types')
}

function findStorageTypeByLabel(typeTable: Record<string, unknown>, typeLabel: string): Record<string, unknown> {
	for (const typeDefinition of Object.values(typeTable)) {
		const normalizedType = getRecord(typeDefinition, `Invalid storage type while looking for ${typeLabel}`)
		if (normalizedType['label'] === typeLabel) return normalizedType
	}
	throw new Error(`Storage layout missing type ${typeLabel}`)
}

function storageMemberSummary(typeTable: Record<string, unknown>, typeLabel: string) {
	const typeDefinition = findStorageTypeByLabel(typeTable, typeLabel)
	const members = getArray(typeDefinition['members'], `Storage type ${typeLabel} is missing members`)
	return members.map((member, index) => {
		const normalizedMember = getRecord(member, `Invalid ${typeLabel} storage member ${index}`)
		const memberTypeId = getString(normalizedMember['type'], `Missing ${typeLabel} storage member type ${index}`)
		const memberType = getRecord(typeTable[memberTypeId], `Missing ${typeLabel} storage member type ${memberTypeId}`)
		return {
			label: getString(normalizedMember['label'], `Missing ${typeLabel} storage member label ${index}`),
			slot: getString(normalizedMember['slot'], `Missing ${typeLabel} storage member slot ${index}`),
			offset: getNumber(normalizedMember['offset'], `Missing ${typeLabel} storage member offset ${index}`),
			type: getString(memberType['label'], `Missing ${typeLabel} storage member type label ${index}`),
		}
	})
}

function getNumber(value: unknown, errorMessage: string): number {
	if (typeof value !== 'number') throw new Error(errorMessage)
	return value
}

function getBytecodeObject(contractOutput: Record<string, unknown>, sectionName: 'bytecode' | 'deployedBytecode'): string {
	const evm = getRecord(contractOutput['evm'], 'EscalationGame output is missing EVM bytecode')
	const bytecodeSection = getRecord(evm[sectionName], `EscalationGame output is missing EVM ${sectionName}`)
	return getString(bytecodeSection['object'], `EscalationGame EVM ${sectionName} is missing object`)
}

function normalizeHexBytecode(bytecode: string): string {
	return bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode
}

function getBytecodeBytes(bytecode: string): number {
	return normalizeHexBytecode(bytecode).length / 2
}

function stripSolidityMetadata(bytecode: string): string {
	const normalizedBytecode = normalizeHexBytecode(bytecode)
	const metadataStart = normalizedBytecode.lastIndexOf('a2646970667358')
	if (metadataStart === -1) return normalizedBytecode
	return normalizedBytecode.slice(0, metadataStart)
}

function getExpectedEscalationGameBytecodeSnapshot(actualSnapshot: EscalationGameBytecodeSnapshot): EscalationGameBytecodeSnapshot {
	const snapshotText = `${JSON.stringify(actualSnapshot, undefined, '\t')}\n`
	if (process.env['UPDATE_ESCALATION_GAME_BYTECODE_SNAPSHOT'] === '1') {
		writeFileSync(escalationGameBytecodeSnapshotPath, snapshotText)
	}
	const parsedSnapshot: unknown = JSON.parse(readFileSync(escalationGameBytecodeSnapshotPath, 'utf8'))
	const snapshot = getRecord(parsedSnapshot, 'EscalationGame bytecode snapshot must be an object')
	return {
		creationBytes: getNumber(snapshot['creationBytes'], 'EscalationGame bytecode snapshot missing creationBytes'),
		deployedBytes: getNumber(snapshot['deployedBytes'], 'EscalationGame bytecode snapshot missing deployedBytes'),
		deployedBytecodeWithoutMetadataHash: getString(snapshot['deployedBytecodeWithoutMetadataHash'], 'EscalationGame bytecode snapshot missing runtime hash') as Hex,
	}
}

test('EscalationGame storage layout matches the shared delegate accounting', () => {
	const escalationGameOutput = getEscalationGameOutput()
	const storageLayout = normalizeStorageLayout(escalationGameOutput)

	assert.deepStrictEqual(
		storageLayout.map(entry => storageEntrySummary(entry)),
		[
			{ label: 'activationTime', slot: '0', offset: 0, type: 'uint256' },
			{ label: 'nonDecisionThresholdAttoRep', slot: '1', offset: 0, type: 'uint256' },
			{ label: 'startBondAttoRep', slot: '2', offset: 0, type: 'uint256' },
			{ label: 'lnRatioScaled', slot: '3', offset: 0, type: 'uint256' },
			{ label: 'nonDecisionTimestamp', slot: '4', offset: 0, type: 'uint256' },
			{ label: 'forkContinuation', slot: '5', offset: 0, type: 'bool' },
			{ label: 'forkElapsedAtStart', slot: '6', offset: 0, type: 'int256' },
			{ label: 'forkResumedAt', slot: '7', offset: 0, type: 'uint256' },
			{ label: 'outcomeState', slot: '8', offset: 0, type: 'struct OutcomeState[3]' },
			{ label: 'nextNodeId', slot: '242', offset: 0, type: 'uint256' },
			{ label: 'nodes', slot: '243', offset: 0, type: 'mapping(uint256 => struct Node)' },
			{ label: 'vaultAccounting', slot: '244', offset: 0, type: 'mapping(address => struct EscalationGameStorage.VaultAccounting)' },
			{ label: 'totalDisputeStakedAttoRep', slot: '245', offset: 0, type: 'uint256' },
			{ label: 'totalLocalUnresolvedAttoRep', slot: '246', offset: 0, type: 'uint256' },
			{ label: 'forkCarrySnapshotRequiresForkedEscrow', slot: '247', offset: 0, type: 'bool' },
			{ label: 'winnerHaircutPaidByFork', slot: '247', offset: 1, type: 'bool' },
			{ label: 'forkCarryInitialBackingAttoRep', slot: '248', offset: 0, type: 'uint256' },
			{ label: 'forkCarryDisputeStakedAttoRep', slot: '249', offset: 0, type: 'uint256' },
			{ label: 'forkCarrySourceGame', slot: '250', offset: 0, type: 'address' },
			{ label: 'fixedQuestionOutcome', slot: '250', offset: 20, type: 'enum BinaryOutcomes.BinaryOutcome' },
			{ label: 'nonDecisionState', slot: '250', offset: 21, type: 'enum NonDecisionState' },
			{ label: 'forkCarrySnapshotOutcomesInitialized', slot: '250', offset: 22, type: 'uint8' },
			{ label: 'forkCarrySnapshotId', slot: '251', offset: 0, type: 'bytes32' },
			{ label: 'ordinarySettlementInitialized', slot: '252', offset: 0, type: 'bool' },
			{ label: 'ordinarySettlementOutcome', slot: '252', offset: 1, type: 'enum BinaryOutcomes.BinaryOutcome' },
			{ label: 'ordinaryWinningReserveAttoRep', slot: '253', offset: 0, type: 'uint256' },
			{ label: 'creditedSurplusAttoRep', slot: '254', offset: 0, type: 'uint256' },
			{ label: 'settlementForkThresholdAttoRep', slot: '255', offset: 0, type: 'uint256' },
		],
	)

	const typeTable = getStorageTypes(escalationGameOutput)
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct EscalationGameStorage.VaultAccounting'), [
		{ label: 'claimBundle', slot: '0', offset: 0, type: 'struct EscalationClaimBundle' },
		{ label: 'unresolvedAttoRep', slot: '1', offset: 0, type: 'uint256' },
		{ label: 'localUnresolvedPrincipalByOutcome', slot: '2', offset: 0, type: 'uint256[3]' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct OutcomeState'), [
		{ label: 'balanceAttoRep', slot: '0', offset: 0, type: 'uint256' },
		{ label: 'snapshotLeafCount', slot: '1', offset: 0, type: 'uint256' },
		{ label: 'snapshotCarryRoot', slot: '2', offset: 0, type: 'bytes32' },
		{ label: 'inheritedUnresolvedTotalAttoRep', slot: '3', offset: 0, type: 'uint256' },
		{ label: 'inheritedConsumedSourceAttoRep', slot: '4', offset: 0, type: 'uint256' },
		{ label: 'inheritedConsumedRetainedAttoRep', slot: '5', offset: 0, type: 'uint256' },
		{ label: 'currentLeafCount', slot: '6', offset: 0, type: 'uint256' },
		{ label: 'currentPeaks', slot: '7', offset: 0, type: 'bytes32[64]' },
		{ label: 'currentNullifierRoot', slot: '71', offset: 0, type: 'bytes32' },
		{ label: 'localHeadNodeId', slot: '72', offset: 0, type: 'uint256' },
		{ label: 'localUnresolvedTotalAttoRep', slot: '73', offset: 0, type: 'uint256' },
		{ label: 'localNodeIds', slot: '74', offset: 0, type: 'uint256[]' },
		{ label: 'currentCarryNodeHashes', slot: '75', offset: 0, type: 'mapping(uint256 => mapping(uint256 => bytes32))' },
		{ label: 'consumedParentDepositIndexes', slot: '76', offset: 0, type: 'mapping(uint256 => bool)' },
		{ label: 'proofConsumedDepositIndexes', slot: '77', offset: 0, type: 'uint256[]' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct Node'), [
		{ label: 'parentNodeId', slot: '0', offset: 0, type: 'uint256' },
		{ label: 'depositor', slot: '1', offset: 0, type: 'address' },
		{ label: 'outcome', slot: '1', offset: 20, type: 'enum BinaryOutcomes.BinaryOutcome' },
		{ label: 'amountAttoRep', slot: '2', offset: 0, type: 'uint256' },
		{ label: 'parentDepositIndex', slot: '3', offset: 0, type: 'uint256' },
		{ label: 'cumulativeAmountAttoRep', slot: '4', offset: 0, type: 'uint256' },
		{ label: 'carryLeafIndex', slot: '5', offset: 0, type: 'uint256' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct EscalationClaimBundle'), [{ label: 'disputeStakedRepClaimUnits', slot: '0', offset: 0, type: 'uint256' }])
})

test('EscalationGame bytecode stays within EIP-170 and preserves runtime snapshot', () => {
	const escalationGameOutput = getEscalationGameOutput()
	const creationBytecode = getBytecodeObject(escalationGameOutput, 'bytecode')
	const deployedBytecode = getBytecodeObject(escalationGameOutput, 'deployedBytecode')
	const deployedBytecodeWithoutMetadata = stripSolidityMetadata(deployedBytecode)
	const actualSnapshot: EscalationGameBytecodeSnapshot = {
		creationBytes: getBytecodeBytes(creationBytecode),
		deployedBytes: getBytecodeBytes(deployedBytecode),
		deployedBytecodeWithoutMetadataHash: keccak256(`0x${deployedBytecodeWithoutMetadata}` as Hex),
	}

	assert.ok(actualSnapshot.deployedBytes <= eip170DeployedBytecodeLimitBytes, `EscalationGame deployed bytecode exceeds EIP-170: ${actualSnapshot.deployedBytes}`)
	assert.deepStrictEqual(actualSnapshot, getExpectedEscalationGameBytecodeSnapshot(actualSnapshot), 'EscalationGame bytecode changed; review the change and refresh the snapshot with bun run update:escalation-game-bytecode-snapshot')
})
