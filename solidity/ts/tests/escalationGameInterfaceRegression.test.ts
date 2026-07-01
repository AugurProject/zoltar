import { test } from 'bun:test'
import assert from '../testsuite/simulator/utils/assert'
import { readFileSync, writeFileSync } from 'node:fs'
import { keccak256, type Hex } from '@zoltar/shared/ethereum'
import { getArray, getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

const escalationGameSourcePath = 'contracts/peripherals/EscalationGame.sol'
const escalationGameContractName = 'EscalationGame'
const escalationGameAbiSnapshotPath = `${import.meta.dir}/fixtures/escalationGameAbi.snapshot`
const escalationGameBytecodeSnapshotPath = `${import.meta.dir}/fixtures/escalationGameBytecode.snapshot.json`
const eip170DeployedBytecodeLimitBytes = 24_576
// The size goal is the post-observability project budget, not the smaller pre-audit origin/main artifact.
const escalationGameDeployedBytecodeBudgetBytes = 24_000

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
		type: getString(entry.type.label, `Missing normalized type label for ${entry.label}`),
	}
}

function getStorageTypes(contractOutput: Record<string, unknown>): Record<string, unknown> {
	const storageLayout = getRecord(contractOutput.storageLayout, 'EscalationGame output is missing storageLayout')
	return getRecord(storageLayout.types, 'EscalationGame storageLayout is missing types')
}

function findStorageTypeByLabel(typeTable: Record<string, unknown>, typeLabel: string): Record<string, unknown> {
	for (const typeDefinition of Object.values(typeTable)) {
		const normalizedType = getRecord(typeDefinition, `Invalid storage type while looking for ${typeLabel}`)
		if (normalizedType.label === typeLabel) return normalizedType
	}
	throw new Error(`Storage layout missing type ${typeLabel}`)
}

function storageMemberSummary(typeTable: Record<string, unknown>, typeLabel: string) {
	const typeDefinition = findStorageTypeByLabel(typeTable, typeLabel)
	const members = getArray(typeDefinition.members, `Storage type ${typeLabel} is missing members`)
	return members.map((member, index) => {
		const normalizedMember = getRecord(member, `Invalid ${typeLabel} storage member ${index}`)
		const memberTypeId = getString(normalizedMember.type, `Missing ${typeLabel} storage member type ${index}`)
		const memberType = getRecord(typeTable[memberTypeId], `Missing ${typeLabel} storage member type ${memberTypeId}`)
		return {
			label: getString(normalizedMember.label, `Missing ${typeLabel} storage member label ${index}`),
			slot: getString(normalizedMember.slot, `Missing ${typeLabel} storage member slot ${index}`),
			offset: Number(normalizedMember.offset),
			type: getString(memberType.label, `Missing ${typeLabel} storage member type label ${index}`),
		}
	})
}

function getOptionalArray(value: unknown): unknown[] {
	if (value === undefined) return []
	return getArray(value, 'Expected ABI array field')
}

function getOptionalString(value: unknown): string {
	if (value === undefined) return ''
	return getString(value, 'Expected ABI string field')
}

function getNumber(value: unknown, errorMessage: string): number {
	if (typeof value !== 'number') throw new Error(errorMessage)
	return value
}

function normalizeAbiParameter(parameter: unknown): string {
	const normalizedParameter = getRecord(parameter, 'Invalid ABI parameter')
	const parameterType = getString(normalizedParameter.type, 'ABI parameter missing type')
	const components = getOptionalArray(normalizedParameter.components)
	const componentSuffix = components.length === 0 ? '' : `(${components.map(component => normalizeAbiParameter(component)).join(',')})`
	const indexedSuffix = normalizedParameter.indexed === true ? ' indexed' : ''
	const parameterName = getOptionalString(normalizedParameter.name)
	const nameSuffix = parameterName === '' ? '' : ` ${parameterName}`
	return `${parameterType}${componentSuffix}${indexedSuffix}${nameSuffix}`
}

function normalizeAbiEntry(entry: unknown): string {
	const normalizedEntry = getRecord(entry, 'Invalid ABI entry')
	const entryType = getString(normalizedEntry.type, 'ABI entry missing type')
	const inputs = getOptionalArray(normalizedEntry.inputs)
		.map(input => normalizeAbiParameter(input))
		.join(',')
	if (entryType === 'event') {
		const name = getString(normalizedEntry.name, 'ABI event missing name')
		return `event ${name}(${inputs})${normalizedEntry.anonymous === true ? ' anonymous' : ''}`
	}
	if (entryType === 'error') {
		const name = getString(normalizedEntry.name, 'ABI error missing name')
		return `error ${name}(${inputs})`
	}
	if (entryType === 'function') {
		const name = getString(normalizedEntry.name, 'ABI function missing name')
		const stateMutability = getString(normalizedEntry.stateMutability, `ABI function ${name} missing mutability`)
		const outputs = getOptionalArray(normalizedEntry.outputs)
			.map(output => normalizeAbiParameter(output))
			.join(',')
		return `function ${name}(${inputs}) ${stateMutability} -> (${outputs})`
	}
	return ''
}

function getExpectedEscalationGameAbiSnapshot(normalizedAbi: readonly string[]): string[] {
	const snapshotText = `${normalizedAbi.join('\n')}\n`
	if (process.env.UPDATE_ESCALATION_GAME_ABI_SNAPSHOT === '1') {
		writeFileSync(escalationGameAbiSnapshotPath, snapshotText)
	}
	return readFileSync(escalationGameAbiSnapshotPath, 'utf8').trimEnd().split('\n')
}

function getBytecodeObject(contractOutput: Record<string, unknown>, sectionName: 'bytecode' | 'deployedBytecode'): string {
	const evm = getRecord(contractOutput.evm, 'EscalationGame output is missing EVM bytecode')
	const bytecodeSection = getRecord(evm[sectionName], `EscalationGame output is missing EVM ${sectionName}`)
	return getString(bytecodeSection.object, `EscalationGame EVM ${sectionName} is missing object`)
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
	if (process.env.UPDATE_ESCALATION_GAME_BYTECODE_SNAPSHOT === '1') {
		writeFileSync(escalationGameBytecodeSnapshotPath, snapshotText)
	}
	const parsedSnapshot: unknown = JSON.parse(readFileSync(escalationGameBytecodeSnapshotPath, 'utf8'))
	const snapshot = getRecord(parsedSnapshot, 'EscalationGame bytecode snapshot must be an object')
	return {
		creationBytes: getNumber(snapshot.creationBytes, 'EscalationGame bytecode snapshot missing creationBytes'),
		deployedBytes: getNumber(snapshot.deployedBytes, 'EscalationGame bytecode snapshot missing deployedBytes'),
		deployedBytecodeWithoutMetadataHash: getString(snapshot.deployedBytecodeWithoutMetadataHash, 'EscalationGame bytecode snapshot missing runtime hash') as Hex,
	}
}

test('EscalationGame storage layout keeps inherited state slots stable', () => {
	const escalationGameOutput = getEscalationGameOutput()
	const storageLayout = normalizeStorageLayout(escalationGameOutput)

	assert.deepStrictEqual(
		storageLayout.map(entry => storageEntrySummary(entry)),
		[
			{ label: 'activationTime', slot: '0', offset: 0, type: 'uint256' },
			{ label: 'nonDecisionThreshold', slot: '1', offset: 0, type: 'uint256' },
			{ label: 'startBond', slot: '2', offset: 0, type: 'uint256' },
			{ label: 'lnRatioScaled', slot: '3', offset: 0, type: 'uint256' },
			{ label: 'nonDecisionTimestamp', slot: '4', offset: 0, type: 'uint256' },
			{ label: 'forkContinuation', slot: '5', offset: 0, type: 'bool' },
			{ label: 'forkElapsedAtStart', slot: '6', offset: 0, type: 'uint256' },
			{ label: 'forkResumedAt', slot: '7', offset: 0, type: 'uint256' },
			{ label: 'outcomeState', slot: '8', offset: 0, type: 'struct OutcomeState[3]' },
			{ label: 'nextNodeId', slot: '428', offset: 0, type: 'uint256' },
			{ label: 'nodes', slot: '429', offset: 0, type: 'mapping(uint256 => struct Node)' },
			{ label: 'escrowedRepByVault', slot: '430', offset: 0, type: 'mapping(address => uint256)' },
			{ label: 'totalEscrowedRep', slot: '431', offset: 0, type: 'uint256' },
			{ label: 'unresolvedRepByVault', slot: '432', offset: 0, type: 'mapping(address => uint256)' },
			{ label: 'totalLocalUnresolvedRep', slot: '433', offset: 0, type: 'uint256' },
			{ label: 'unresolvedLocalDepositRefsByVault', slot: '434', offset: 0, type: 'mapping(address => uint256[])' },
			{ label: 'unresolvedLocalDepositExportCursorByVault', slot: '435', offset: 0, type: 'mapping(address => uint256)' },
			{
				label: 'forkedEscrowByVaultAndOutcome',
				slot: '436',
				offset: 0,
				type: 'mapping(address => mapping(uint8 => struct ForkedEscrowState))',
			},
			{ label: 'forkCarrySnapshotRequiresForkedEscrow', slot: '437', offset: 0, type: 'bool' },
		],
	)

	const typeTable = getStorageTypes(escalationGameOutput)
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct OutcomeState'), [
		{ label: 'balance', slot: '0', offset: 0, type: 'uint256' },
		{ label: 'deposits', slot: '1', offset: 0, type: 'struct Deposit[]' },
		{ label: 'snapshotLeafCount', slot: '2', offset: 0, type: 'uint256' },
		{ label: 'snapshotPeaks', slot: '3', offset: 0, type: 'bytes32[64]' },
		{ label: 'inheritedUnresolvedTotal', slot: '67', offset: 0, type: 'uint256' },
		{ label: 'currentLeafCount', slot: '68', offset: 0, type: 'uint256' },
		{ label: 'currentPeaks', slot: '69', offset: 0, type: 'bytes32[64]' },
		{ label: 'currentNullifierRoot', slot: '133', offset: 0, type: 'bytes32' },
		{ label: 'localHeadNodeId', slot: '134', offset: 0, type: 'uint256' },
		{ label: 'localUnresolvedTotal', slot: '135', offset: 0, type: 'uint256' },
		{ label: 'localNodeIds', slot: '136', offset: 0, type: 'uint256[]' },
		{ label: 'currentCarryNodeHashes', slot: '137', offset: 0, type: 'mapping(uint256 => mapping(uint256 => bytes32))' },
		{ label: 'consumedParentDepositIndexes', slot: '138', offset: 0, type: 'mapping(uint256 => bool)' },
		{ label: 'proofConsumedDepositIndexes', slot: '139', offset: 0, type: 'uint256[]' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct Deposit'), [
		{ label: 'depositor', slot: '0', offset: 0, type: 'address' },
		{ label: 'amount', slot: '1', offset: 0, type: 'uint256' },
		{ label: 'cumulativeAmount', slot: '2', offset: 0, type: 'uint256' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct Node'), [
		{ label: 'parentNodeId', slot: '0', offset: 0, type: 'uint256' },
		{ label: 'depositor', slot: '1', offset: 0, type: 'address' },
		{ label: 'outcome', slot: '1', offset: 20, type: 'enum BinaryOutcomes.BinaryOutcome' },
		{ label: 'amount', slot: '2', offset: 0, type: 'uint256' },
		{ label: 'parentDepositIndex', slot: '3', offset: 0, type: 'uint256' },
		{ label: 'cumulativeAmount', slot: '4', offset: 0, type: 'uint256' },
		{ label: 'carryLeafIndex', slot: '5', offset: 0, type: 'uint256' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct ForkedEscrowState'), [
		{ label: 'sourcePrincipal', slot: '0', offset: 0, type: 'uint256' },
		{ label: 'sourcePrincipalClaimed', slot: '1', offset: 0, type: 'uint256' },
		{ label: 'childRep', slot: '2', offset: 0, type: 'uint256' },
		{ label: 'childRepClaimed', slot: '3', offset: 0, type: 'uint256' },
	])
})

test('EscalationGame ABI preserves public functions, events, and tuple shapes', () => {
	const escalationGameOutput = getEscalationGameOutput()
	const abi = getArray(escalationGameOutput.abi, 'EscalationGame output is missing ABI')
	const normalizedAbi = abi
		.map(entry => normalizeAbiEntry(entry))
		.filter(entry => entry !== '')
		.sort()

	assert.deepStrictEqual(normalizedAbi, getExpectedEscalationGameAbiSnapshot(normalizedAbi))
})

test('EscalationGame bytecode stays within size budgets and preserves runtime snapshot', () => {
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
	assert.ok(actualSnapshot.deployedBytes <= escalationGameDeployedBytecodeBudgetBytes, `EscalationGame deployed bytecode exceeds project budget: ${actualSnapshot.deployedBytes}`)
	assert.deepStrictEqual(actualSnapshot, getExpectedEscalationGameBytecodeSnapshot(actualSnapshot))
})
