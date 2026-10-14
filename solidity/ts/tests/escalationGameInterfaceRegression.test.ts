import { test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { readFileSync, writeFileSync } from 'node:fs'
import { encodeFunctionData, keccak256, parseAbi, zeroHash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getArray, getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

const escalationGameSourcePath = 'contracts/statoblast/EscalationGame.sol'
const escalationGameContractName = 'EscalationGame'
const escalationGameBytecodeSnapshotPath = `${import.meta.dir}/fixtures/escalationGameBytecode.snapshot.json`
const eip170DeployedBytecodeLimitBytes = 24_576

test('claim checkpoint batches use one base commitment and forward-ordered transforms', () => {
	const output = getContractOutput(loadContractsJson(import.meta.dir), 'contracts/statoblast/EscalationGameClaimDelegate.sol', 'EscalationGameClaimDelegate')
	const abi = getArray(output['abi'], 'Claim delegate ABI missing')
	const process = abi.map(entry => getRecord(entry, 'Invalid claim ABI entry')).find(entry => entry['name'] === 'processClaimCheckpoint')
	if (process === undefined) throw new Error('Checkpoint processing ABI missing')
	const inputs = getArray(process['inputs'], 'Checkpoint inputs missing').map(entry => getRecord(entry, 'Invalid checkpoint input'))
	assert.deepStrictEqual(
		inputs.map(input => input['type']),
		['uint8', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32', 'tuple[]'],
	)
	assert.strictEqual(inputs[5]?.['name'], 'baseCommitment')
	assert.strictEqual(inputs[6]?.['name'], 'transforms')
	const transform = inputs[6]
	if (transform === undefined) throw new Error('Checkpoint transforms missing')
	assert.deepStrictEqual(
		getArray(transform['components'], 'Transform fields missing').map(entry => getRecord(entry, 'Invalid transform field')['name']),
		['repBeforeAttoRep', 'repRemainingAttoRep', 'consumedBeforeAttoRep'],
	)
})

test('compact checkpoint calldata adds one discovery word and removes seven eight-step commitment words', () => {
	const previousAbi = parseAbi(['function processClaimCheckpoint(uint8,uint256,uint256,uint256,uint256,((uint256,uint256,uint256),bytes32)[])'])
	const compactAbi = parseAbi(['function processClaimCheckpoint(uint8,uint256,uint256,uint256,uint256,bytes32,(uint256,uint256,uint256)[])'])
	const tuple = [1, 33n, 99n, 1n, 8n] as const
	const transform = [101n, 98n, 1n] as const
	for (const count of [0, 1, 8]) {
		const transforms = Array.from({ length: count }, () => transform)
		const previous = encodeFunctionData({ abi: previousAbi, functionName: 'processClaimCheckpoint', args: [...tuple, transforms.map(item => [item, zeroHash] as const)] })
		const compact = encodeFunctionData({ abi: compactAbi, functionName: 'processClaimCheckpoint', args: [...tuple, zeroHash, transforms] })
		const previousBytes = (previous.length - 2) / 2
		const compactBytes = (compact.length - 2) / 2
		assert.strictEqual(previousBytes, 228 + 128 * count)
		assert.strictEqual(compactBytes, 260 + 96 * count)
		assert.strictEqual(compactBytes - previousBytes, 32 * (1 - count))
	}
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
			{ label: 'forkElapsedAtStart', slot: '6', offset: 0, type: 'uint256' },
			{ label: 'forkResumedAt', slot: '7', offset: 0, type: 'uint256' },
			{ label: 'outcomeState', slot: '8', offset: 0, type: 'struct OutcomeState[3]' },
			{ label: 'nextNodeId', slot: '434', offset: 0, type: 'uint256' },
			{ label: 'nodes', slot: '435', offset: 0, type: 'mapping(uint256 => struct Node)' },
			{ label: 'escalationClaimBundles', slot: '436', offset: 0, type: 'mapping(address => struct EscalationClaimBundle)' },
			{ label: 'totalDisputeStakedAttoRep', slot: '437', offset: 0, type: 'uint256' },
			{ label: 'unresolvedRepByVaultAttoRep', slot: '438', offset: 0, type: 'mapping(address => uint256)' },
			{ label: 'totalLocalUnresolvedAttoRep', slot: '439', offset: 0, type: 'uint256' },
			{ label: 'localUnresolvedPrincipalByVaultAndOutcome', slot: '440', offset: 0, type: 'mapping(address => uint256[3])' },
			{ label: 'localUnresolvedTotalsExportedByVault', slot: '441', offset: 0, type: 'mapping(address => bool)' },
			{
				label: 'forkedEscrowByVaultAndOutcome',
				slot: '442',
				offset: 0,
				type: 'mapping(address => mapping(uint8 => struct ForkedEscrowState))',
			},
			{ label: 'forkCarrySnapshotRequiresForkedEscrow', slot: '443', offset: 0, type: 'bool' },
			{ label: 'winnerHaircutPaidByFork', slot: '443', offset: 1, type: 'bool' },
			{ label: 'forkCarryInitialBackingAttoRep', slot: '444', offset: 0, type: 'uint256' },
			{ label: 'forkCarryDisputeStakedAttoRep', slot: '445', offset: 0, type: 'uint256' },
			{ label: 'forkCarrySourceGame', slot: '446', offset: 0, type: 'address' },
			{ label: 'forkCarryRootClaimSourceGame', slot: '447', offset: 0, type: 'address' },
			{ label: 'fixedQuestionOutcome', slot: '447', offset: 20, type: 'enum BinaryOutcomes.BinaryOutcome' },
			{ label: 'nonDecisionState', slot: '447', offset: 21, type: 'enum NonDecisionState' },
			{ label: 'forkCarryBackingExportedBeforeResumeAttoRep', slot: '448', offset: 0, type: 'uint256' },
			{ label: 'truthAuctionRepBeforeAttoRep', slot: '449', offset: 0, type: 'uint256' },
			{ label: 'truthAuctionRepRemainingAttoRep', slot: '450', offset: 0, type: 'uint256' },
			{ label: 'forkCarrySnapshotOutcomesInitialized', slot: '451', offset: 0, type: 'uint8' },
			{ label: 'forkCarrySnapshotId', slot: '452', offset: 0, type: 'bytes32' },
			{ label: 'claimCheckpoints', slot: '453', offset: 0, type: 'mapping(bytes32 => struct EscalationClaimCheckpoint)' },
		],
	)

	const typeTable = getStorageTypes(escalationGameOutput)
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct OutcomeState'), [
		{ label: 'balanceAttoRep', slot: '0', offset: 0, type: 'uint256' },
		{ label: 'snapshotLeafCount', slot: '1', offset: 0, type: 'uint256' },
		{ label: 'snapshotPeaks', slot: '2', offset: 0, type: 'bytes32[64]' },
		{ label: 'inheritedUnresolvedTotalAttoRep', slot: '66', offset: 0, type: 'uint256' },
		{ label: 'inheritedConsumedSourceAttoRep', slot: '67', offset: 0, type: 'uint256' },
		{ label: 'inheritedConsumedRetainedAttoRep', slot: '68', offset: 0, type: 'uint256' },
		{ label: 'consumedPrincipalTree', slot: '69', offset: 0, type: 'mapping(uint256 => uint256)' },
		{ label: 'currentLeafCount', slot: '70', offset: 0, type: 'uint256' },
		{ label: 'currentPeaks', slot: '71', offset: 0, type: 'bytes32[64]' },
		{ label: 'currentNullifierRoot', slot: '135', offset: 0, type: 'bytes32' },
		{ label: 'localHeadNodeId', slot: '136', offset: 0, type: 'uint256' },
		{ label: 'localUnresolvedTotalAttoRep', slot: '137', offset: 0, type: 'uint256' },
		{ label: 'localNodeIds', slot: '138', offset: 0, type: 'uint256[]' },
		{ label: 'currentCarryNodeHashes', slot: '139', offset: 0, type: 'mapping(uint256 => mapping(uint256 => bytes32))' },
		{ label: 'consumedParentDepositIndexes', slot: '140', offset: 0, type: 'mapping(uint256 => bool)' },
		{ label: 'proofConsumedDepositIndexes', slot: '141', offset: 0, type: 'uint256[]' },
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
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct ForkedEscrowState'), [
		{ label: 'sourcePrincipalAttoRep', slot: '0', offset: 0, type: 'uint256' },
		{ label: 'sourcePrincipalClaimedAttoRep', slot: '1', offset: 0, type: 'uint256' },
		{ label: 'childAttoRep', slot: '2', offset: 0, type: 'uint256' },
		{ label: 'childRepClaimedAttoRep', slot: '3', offset: 0, type: 'uint256' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct EscalationClaimCheckpoint'), [
		{ label: 'nextSourceGame', slot: '0', offset: 0, type: 'address' },
		{ label: 'initialized', slot: '0', offset: 20, type: 'bool' },
		{ label: 'complete', slot: '0', offset: 21, type: 'bool' },
		{ label: 'stopAfterNextSource', slot: '0', offset: 22, type: 'bool' },
		{ label: 'pendingSteps', slot: '1', offset: 0, type: 'uint256' },
		{ label: 'interval', slot: '2', offset: 0, type: 'struct EscalationClaimInterval' },
		{ label: 'pendingCommitment', slot: '6', offset: 0, type: 'bytes32' },
		{ label: 'reusedCheckpointGame', slot: '7', offset: 0, type: 'address' },
		{ label: 'segments', slot: '8', offset: 0, type: 'mapping(uint256 => struct EscalationClaimCheckpointSegment)' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct EscalationClaimInterval'), [
		{ label: 'startAttoRep', slot: '0', offset: 0, type: 'uint256' },
		{ label: 'endAttoRep', slot: '1', offset: 0, type: 'uint256' },
		{ label: 'rewardStartAttoRep', slot: '2', offset: 0, type: 'uint256' },
		{ label: 'rewardEndAttoRep', slot: '3', offset: 0, type: 'uint256' },
	])
	assert.deepStrictEqual(storageMemberSummary(typeTable, 'struct EscalationClaimCheckpointSegment'), [
		{ label: 'sourceGame', slot: '0', offset: 0, type: 'address' },
		{ label: 'previousCommitment', slot: '1', offset: 0, type: 'bytes32' },
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
