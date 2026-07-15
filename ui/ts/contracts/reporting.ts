import { concatHex, encodeAbiParameters, keccak256, parseAbiParameters, zeroAddress, type Address, type ContractFunctionParameters, type Hex } from '@zoltar/shared/ethereum'
import { Zoltar_Zoltar, peripherals_EscalationGame_EscalationGame, peripherals_SecurityPool_SecurityPool } from '../contractArtifact.js'
import { sameAddress } from '../lib/address.js'
import type { CarriedDepositProof, EscalationDeposit, EscalationSide, ImportedEscalationDeposit, ReadClient, ReportingActionResult, ReportingDetails, ReportingOutcomeKey, ReportingSettlementState, WriteClient } from '../types/contracts.js'
import { readRequiredMulticall, writeContractAndWait } from './core.js'
import { requireAddressValue, requireArrayValue, requireBigintValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { getEscalationSideLabel, getReportingOutcomeKey, getReportingOutcomeValue, getSecurityPoolSystemState, hasTimestamp, requireSecurityVaultTupleArray } from './helpers.js'
import { executeForkAuctionAction, readSecurityPoolUniverseId } from './securityPoolActions.js'
import { loadMarketDetails } from './zoltar.js'

const MIGRATION_TIME_LENGTH = 4838400n
const QUESTION_OUTCOME_ABI = [
	{
		inputs: [{ name: 'securityPool', type: 'address' }],
		name: 'getQuestionOutcome',
		outputs: [{ name: 'outcome', type: 'uint8' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const
const ESCALATION_MIGRATION_ENTITLEMENT_STATUS_ABI = [
	{
		inputs: [
			{ name: 'securityPool', type: 'address' },
			{ name: 'vault', type: 'address' },
		],
		name: 'getEscalationMigrationEntitlementStatus',
		outputs: [
			{ name: 'initialized', type: 'bool' },
			{ name: 'totalCurrentRep', type: 'uint256' },
			{ name: 'materializedByOutcome', type: 'bool[3]' },
		],
		stateMutability: 'view',
		type: 'function',
	},
] as const
const CONTRACT_PAGE_SIZE = 30n
const NULLIFIER_DEPTH = 64
const CARRY_LEAF_ABI = parseAbiParameters('address depositor, uint8 outcome, uint256 amount, uint256 parentDepositIndex, uint256 cumulativeAmount, uint256 sourceNodeId')

type ReportingBootstrapReadResult = {
	questionId: bigint
	escalationGameAddress: Address
	completeSetCollateralAmount: bigint
	universeId: bigint
	zoltarAddress: Address
	initialEscalationGameDeposit: bigint
	systemStateValue: bigint | number
	questionOutcomeValue: bigint | number
	parentSecurityPoolAddress: Address
}

type CarryLeafViewStruct = {
	cumulativeAmount: bigint
	depositor: Address
	parentDepositIndex: bigint
	amount: bigint
	sourceNodeId: bigint
}

type EscalationDepositViewStruct = {
	amount: bigint
	cumulativeAmount: bigint
	depositor: Address
}

function requireReportingBootstrapReadResult(value: unknown): ReportingBootstrapReadResult {
	const [questionId, escalationGameAddress, completeSetCollateralAmount, universeId, zoltarAddress, initialEscalationGameDeposit, systemStateValue, questionOutcomeValue, parentSecurityPoolAddress] = requireTupleValue(value, 9, 'reporting bootstrap')
	return {
		questionId: requireBigintValue(questionId, 'reporting question id'),
		escalationGameAddress: requireAddressValue(escalationGameAddress, 'reporting escalation game address'),
		completeSetCollateralAmount: requireBigintValue(completeSetCollateralAmount, 'reporting complete set collateral amount'),
		universeId: requireBigintValue(universeId, 'reporting universe id'),
		zoltarAddress: requireAddressValue(zoltarAddress, 'reporting zoltar address'),
		initialEscalationGameDeposit: requireBigintValue(initialEscalationGameDeposit, 'reporting initial escalation game deposit'),
		systemStateValue: requireIntegerLikeValue(systemStateValue, 'reporting system state'),
		questionOutcomeValue: requireIntegerLikeValue(questionOutcomeValue, 'reporting question outcome'),
		parentSecurityPoolAddress: requireAddressValue(parentSecurityPoolAddress, 'reporting parent security pool address'),
	}
}

function requireEscalationDepositView(value: unknown, context: string): EscalationDepositViewStruct {
	const deposit = requireObjectValue(value, context)
	if ('amount' in deposit && 'cumulativeAmount' in deposit && 'depositor' in deposit) {
		return {
			amount: requireBigintValue(deposit.amount, context),
			cumulativeAmount: requireBigintValue(deposit.cumulativeAmount, context),
			depositor: requireAddressValue(deposit.depositor, context),
		}
	}
	throw new Error(`Unexpected ${context} response`)
}

function requireEscalationDepositArray(value: unknown, context: string): EscalationDepositViewStruct[] {
	return requireArrayValue(value, context).map(deposit => requireEscalationDepositView(deposit, context))
}

export async function loadEscalationDeposits(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<EscalationDeposit[]> {
	let currentIndex = 0n
	const deposits: EscalationDeposit[] = []
	while (true) {
		const page = requireEscalationDepositArray(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'getDepositsByOutcome',
				args: [getReportingOutcomeValue(outcome), currentIndex, CONTRACT_PAGE_SIZE],
			}),
			'escalation deposit page',
		)
		const normalizedPage = page
			.map((deposit, index) => ({
				amount: deposit.amount,
				cumulativeAmount: deposit.cumulativeAmount,
				depositIndex: currentIndex + BigInt(index),
				depositor: deposit.depositor,
			}))
			.filter(deposit => deposit.depositor !== zeroAddress && deposit.amount > 0n)
		deposits.push(...normalizedPage)
		if (BigInt(page.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	}
	return deposits
}

function requireCarryLeafView(value: unknown, context: string): CarryLeafViewStruct {
	const leaf = requireObjectValue(value, context)
	if ('amount' in leaf && 'cumulativeAmount' in leaf && 'depositor' in leaf && 'parentDepositIndex' in leaf && 'sourceNodeId' in leaf) {
		return {
			cumulativeAmount: requireBigintValue(leaf.cumulativeAmount, context),
			depositor: requireAddressValue(leaf.depositor, context),
			parentDepositIndex: requireBigintValue(leaf.parentDepositIndex, context),
			amount: requireBigintValue(leaf.amount, context),
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
				abi: peripherals_EscalationGame_EscalationGame.abi,
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

async function loadProofConsumedCarriedDepositIndexes(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey) {
	let startIndex = 0n
	const parentDepositIndexes: bigint[] = []
	while (true) {
		const page = requireArrayValue(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
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

async function readForkContinuation(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address) {
	return await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'forkContinuation',
		args: [],
	})
}

async function readEscalationOutcomeState(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey) {
	return await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
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
		abi: peripherals_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'securityPool',
		args: [],
	})
	const parentSecurityPoolAddress = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
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
		abi: peripherals_SecurityPool_SecurityPool.abi,
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

async function loadForkCarriedEscalationDepositsFromParentSnapshot(client: Pick<ReadClient, 'readContract'>, childEscalationGameAddress: Address, parentSecurityPoolAddress: Address, outcome: ReportingOutcomeKey, depositor: Address): Promise<ImportedEscalationDeposit[]> {
	const parentEscalationGameAddress = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		address: parentSecurityPoolAddress,
		functionName: 'escalationGame',
		args: [],
	})
	if (parentEscalationGameAddress === zeroAddress) return []
	const [{ orderedLeaves: parentSnapshotLeaves }, consumedParentDepositIndexes] = await Promise.all([loadRecursiveCarrySnapshot(client, parentEscalationGameAddress, outcome), loadProofConsumedCarriedDepositIndexes(client, childEscalationGameAddress, outcome)])
	const consumedParentDepositIndexSet = new Set(consumedParentDepositIndexes.map(value => value.toString()))
	return parentSnapshotLeaves
		.filter(leaf => sameAddress(leaf.depositor, depositor) && !consumedParentDepositIndexSet.has(leaf.parentDepositIndex.toString()))
		.map(leaf => ({
			amount: leaf.amount,
			cumulativeAmount: leaf.cumulativeAmount,
			depositor: leaf.depositor,
			parentDepositIndex: leaf.parentDepositIndex,
		}))
}

function hashCarryLeaf(leaf: CarryLeafViewStruct, outcome: ReportingOutcomeKey): Hex {
	return keccak256(encodeAbiParameters(CARRY_LEAF_ABI, [leaf.depositor, getReportingOutcomeValue(outcome), leaf.amount, leaf.parentDepositIndex, leaf.cumulativeAmount, leaf.sourceNodeId]))
}

function hashCarryParent(left: Hex, right: Hex): Hex {
	return keccak256(concatHex([left, right]))
}

function bagCarryPeaks(peaks: readonly Hex[]): Hex {
	if (peaks.length === 0) return ('0x' + '00'.repeat(32)) as Hex
	let root = peaks[peaks.length - 1]
	if (root === undefined) throw new Error('Missing carry peak root')
	for (let index = peaks.length - 1; index > 0; index -= 1) {
		const previousPeak = peaks[index - 1]
		if (previousPeak === undefined) throw new Error('Missing carry peak root')
		root = hashCarryParent(previousPeak, root)
	}
	return root
}

function buildCarryPeakHeights(leafCount: bigint) {
	const peakHeights: number[] = []
	let remainingLeafCount = leafCount
	let currentHeight = 0
	while (remainingLeafCount > 0n) {
		if ((remainingLeafCount & 1n) === 1n) peakHeights.unshift(currentHeight)
		remainingLeafCount >>= 1n
		currentHeight += 1
	}
	return peakHeights
}

function compareBigintAscending(left: bigint, right: bigint) {
	if (left < right) return -1
	if (left > right) return 1
	return 0
}

function buildCarryMerkleMountainRangeProof(leafHashes: readonly Hex[], targetLeafIndex: number) {
	const leafCount = BigInt(leafHashes.length)
	const peakHeights = buildCarryPeakHeights(leafCount)
	let offset = 0
	let targetPeakHeight: number | undefined
	let targetPeakLeaves: Hex[] | undefined
	let targetPeakOffset: number | undefined
	const peakRootsByHeight = new Map<number, Hex>()
	for (const peakHeight of peakHeights) {
		const peakSize = 1 << peakHeight
		const peakLeaves = leafHashes.slice(offset, offset + peakSize)
		let levelHashes = [...peakLeaves]
		while (levelHashes.length > 1) {
			const nextLevelHashes: Hex[] = []
			for (let index = 0; index < levelHashes.length; index += 2) {
				const left = levelHashes[index]
				const right = levelHashes[index + 1]
				if (left === undefined || right === undefined) throw new Error('Invalid carry Merkle Mountain Range level')
				nextLevelHashes.push(hashCarryParent(left, right))
			}
			levelHashes = nextLevelHashes
		}
		const peakRoot = levelHashes[0]
		if (peakRoot === undefined) throw new Error('Missing carry Merkle Mountain Range peak root')
		peakRootsByHeight.set(peakHeight, peakRoot)
		if (targetLeafIndex >= offset && targetLeafIndex < offset + peakSize) {
			targetPeakHeight = peakHeight
			targetPeakLeaves = peakLeaves
			targetPeakOffset = offset
		}
		offset += peakSize
	}
	if (targetPeakHeight === undefined || targetPeakLeaves === undefined || targetPeakOffset === undefined) {
		throw new Error('Target carry leaf is not inside the Merkle Mountain Range')
	}
	let relativeLeafIndex = targetLeafIndex - targetPeakOffset
	let levelHashes = [...targetPeakLeaves]
	const merkleMountainRangeSiblings: Hex[] = []
	while (levelHashes.length > 1) {
		const siblingIndex = relativeLeafIndex ^ 1
		const siblingHash = levelHashes[siblingIndex]
		if (siblingHash === undefined) throw new Error('Missing carry Merkle Mountain Range sibling')
		merkleMountainRangeSiblings.push(siblingHash)
		const nextLevelHashes: Hex[] = []
		for (let index = 0; index < levelHashes.length; index += 2) {
			const left = levelHashes[index]
			const right = levelHashes[index + 1]
			if (left === undefined || right === undefined) throw new Error('Invalid carry Merkle Mountain Range level')
			nextLevelHashes.push(hashCarryParent(left, right))
		}
		levelHashes = nextLevelHashes
		relativeLeafIndex = Math.floor(relativeLeafIndex / 2)
	}
	const orderedPeakHeights = [...peakRootsByHeight.keys()].sort((left, right) => left - right)
	for (const peakHeight of orderedPeakHeights) {
		if (peakHeight === targetPeakHeight) continue
		const peakRoot = peakRootsByHeight.get(peakHeight)
		if (peakRoot === undefined) throw new Error('Missing carry Merkle Mountain Range peak root')
		merkleMountainRangeSiblings.push(peakRoot)
	}
	const orderedPeaks = orderedPeakHeights.map(peakHeight => {
		const peakRoot = peakRootsByHeight.get(peakHeight)
		if (peakRoot === undefined) throw new Error('Missing carry Merkle Mountain Range peak root')
		return peakRoot
	})
	const root = bagCarryPeaks(orderedPeaks)
	return { merkleMountainRangePeakIndex: BigInt(targetPeakHeight), merkleMountainRangeSiblings, root }
}

function buildZeroHashes() {
	const zeroHashes: Hex[] = []
	let currentHash = ('0x' + '00'.repeat(32)) as Hex
	for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
		zeroHashes.push(currentHash)
		currentHash = hashCarryParent(currentHash, currentHash)
	}
	return zeroHashes
}

class SparseNullifier {
	private readonly nodes = new Map<string, Hex>()
	private readonly zeroHashes = buildZeroHashes()

	constructor(consumedParentDepositIndexes: readonly bigint[]) {
		for (const parentDepositIndex of consumedParentDepositIndexes) this.consume(parentDepositIndex)
	}

	private getNode(level: number, index: bigint) {
		return this.nodes.get(`${level}:${index.toString()}`) ?? this.zeroHashes[level]
	}

	getProof(parentDepositIndex: bigint) {
		const siblings: Hex[] = []
		let index = BigInt.asUintN(64, BigInt(keccak256(encodeAbiParameters(parseAbiParameters('uint256 parentDepositIndex'), [parentDepositIndex]))))
		for (let level = 0; level < NULLIFIER_DEPTH; level += 1) {
			const siblingIndex = index ^ 1n
			const siblingHash = this.getNode(level, siblingIndex)
			if (siblingHash === undefined) throw new Error('Missing nullifier sibling hash')
			siblings.push(siblingHash)
			index >>= 1n
		}
		return siblings
	}

	consume(parentDepositIndex: bigint) {
		let index = BigInt.asUintN(64, BigInt(keccak256(encodeAbiParameters(parseAbiParameters('uint256 parentDepositIndex'), [parentDepositIndex]))))
		let currentHash = ('0x' + '00'.repeat(31) + '01') as Hex
		for (let level = 0; level < NULLIFIER_DEPTH; level += 1) {
			this.nodes.set(`${level}:${index.toString()}`, currentHash)
			const siblingIndex = index ^ 1n
			const siblingHash = this.getNode(level, siblingIndex)
			if (siblingHash === undefined) throw new Error('Missing nullifier sibling hash')
			currentHash = (index & 1n) === 0n ? hashCarryParent(currentHash, siblingHash) : hashCarryParent(siblingHash, currentHash)
			index >>= 1n
		}
		this.nodes.set(`${NULLIFIER_DEPTH}:0`, currentHash)
	}

	getRoot() {
		const root = this.nodes.get(`${NULLIFIER_DEPTH}:0`)
		const fallbackRoot = this.zeroHashes[this.zeroHashes.length - 1]
		if (fallbackRoot === undefined) throw new Error('Missing empty nullifier root')
		return root ?? fallbackRoot
	}
}

async function loadViewerReportingVaultState(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined) {
	if (accountAddress === undefined)
		return {
			viewerVaultAvailableEscalationRep: undefined,
			viewerEscalationMigrationEntitlement: undefined,
			viewerVaultExists: false,
			viewerVaultEscrowedRep: undefined,
			viewerVaultRepDepositShare: undefined,
		}
	const [viewerVaultTuple, escalationMigrationEntitlementTuple] = await Promise.all([
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'securityVaults',
			address: securityPoolAddress,
			args: [accountAddress],
		}),
		client.readContract({
			abi: ESCALATION_MIGRATION_ENTITLEMENT_STATUS_ABI,
			functionName: 'getEscalationMigrationEntitlementStatus',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress, accountAddress],
		}),
	])
	const [entitlementInitialized, entitlementTotalCurrentRep, materializedByOutcome] = escalationMigrationEntitlementTuple
	const viewerVaultTuples = requireSecurityVaultTupleArray([viewerVaultTuple], 'viewer security vault tuple')
	const [viewerPoolOwnership, viewerSecurityBondAllowance, viewerUnpaidEthFees, viewerFeeIndex] = viewerVaultTuples[0] ?? []
	if (typeof viewerPoolOwnership !== 'bigint' || typeof viewerSecurityBondAllowance !== 'bigint' || typeof viewerUnpaidEthFees !== 'bigint' || typeof viewerFeeIndex !== 'bigint') throw new Error('Unexpected viewer security vault tuple response')
	const viewerVaultRepDepositShare =
		viewerPoolOwnership === 0n
			? 0n
			: await client.readContract({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					functionName: 'poolOwnershipToRep',
					address: securityPoolAddress,
					args: [viewerPoolOwnership],
				})
	const escalationGameAddress = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		address: securityPoolAddress,
		args: [],
	})
	const viewerVaultEscrowedRep = sameAddress(escalationGameAddress, zeroAddress)
		? 0n
		: await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'escrowedRepByVault',
				address: escalationGameAddress,
				args: [accountAddress],
			})
	const viewerVaultExists = viewerPoolOwnership !== 0n || viewerSecurityBondAllowance !== 0n || viewerUnpaidEthFees !== 0n || viewerFeeIndex !== 0n || viewerVaultEscrowedRep !== 0n
	const viewerVaultAvailableEscalationRep = viewerVaultRepDepositShare
	return {
		viewerVaultAvailableEscalationRep,
		viewerEscalationMigrationEntitlement: {
			initialized: entitlementInitialized,
			materializedByOutcome: {
				invalid: materializedByOutcome[0],
				yes: materializedByOutcome[1],
				no: materializedByOutcome[2],
			},
			totalCurrentRep: entitlementTotalCurrentRep,
		},
		viewerVaultExists,
		viewerVaultEscrowedRep,
		viewerVaultRepDepositShare,
	}
}

export async function loadReportingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<ReportingDetails> {
	const reportingPoolReads: readonly ContractFunctionParameters[] = [
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'questionId',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'completeSetCollateralAmount',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'universeId',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'zoltar',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'initialEscalationGameDeposit',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'systemState',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'parent',
			address: securityPoolAddress,
			args: [],
		},
	]
	const { questionId, escalationGameAddress, completeSetCollateralAmount, universeId, zoltarAddress, initialEscalationGameDeposit, systemStateValue, questionOutcomeValue, parentSecurityPoolAddress } = requireReportingBootstrapReadResult(await readRequiredMulticall(client, reportingPoolReads))
	const systemState = getSecurityPoolSystemState(systemStateValue)
	const normalizedQuestionOutcome = getReportingOutcomeKey(questionOutcomeValue)
	const [marketDetails, block, escalationGameCode, viewerVaultState, forkThreshold] = await Promise.all([
		loadMarketDetails(client, questionId),
		client.getBlock(),
		escalationGameAddress === zeroAddress ? Promise.resolve('0x' as const) : client.getCode({ address: escalationGameAddress }),
		loadViewerReportingVaultState(client, securityPoolAddress, accountAddress),
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: zoltarAddress,
			functionName: 'getForkThreshold',
			args: [universeId],
		}),
	])
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')
	if (escalationGameAddress === zeroAddress || escalationGameCode === undefined || escalationGameCode === '0x')
		return {
			completeSetCollateralAmount,
			currentTime: block.timestamp,
			forkThreshold,
			marketDetails,
			nonDecisionThreshold: forkThreshold / 2n,
			parentSecurityPoolAddress,
			questionOutcome: normalizedQuestionOutcome,
			securityPoolAddress,
			settlementState: normalizedQuestionOutcome !== 'none' && systemState === 'operational' ? 'resolved' : 'locked',
			startBond: initialEscalationGameDeposit,
			status: 'not-started',
			systemState,
			universeId,
			parentWithdrawalEnabled: false,
			...viewerVaultState,
		}
	const forkContinuationSnapshot = await readForkContinuation(client, escalationGameAddress)
	const [startBond, nonDecisionThreshold, activationTime, totalCost, bindingCapital, invalidOutcomeState, yesOutcomeState, noOutcomeState, escalationEndTime, _questionOutcome, universeForkTime, hasReachedNonDecision] = await Promise.all([
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'startBond',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionThreshold',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'activationTime',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapital',
			address: escalationGameAddress,
			args: [],
		}),
		readEscalationOutcomeState(client, escalationGameAddress, 'invalid'),
		readEscalationOutcomeState(client, escalationGameAddress, 'yes'),
		readEscalationOutcomeState(client, escalationGameAddress, 'no'),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getEscalationGameEndDate',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getForkTime',
			address: getInfraContractAddresses().zoltar,
			args: [universeId],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'hasReachedNonDecision',
			address: escalationGameAddress,
			args: [],
		}),
	])
	const balances: [bigint, bigint, bigint] = [invalidOutcomeState.balance, yesOutcomeState.balance, noOutcomeState.balance]
	const useCarrySnapshot = forkContinuationSnapshot !== undefined
	const [invalidDeposits, yesDeposits, noDeposits, invalidParentSnapshotDeposits, yesParentSnapshotDeposits, noParentSnapshotDeposits] = await Promise.all([
		loadEscalationDeposits(client, escalationGameAddress, 'invalid'),
		loadEscalationDeposits(client, escalationGameAddress, 'yes'),
		loadEscalationDeposits(client, escalationGameAddress, 'no'),
		accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'invalid', accountAddress),
		accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'yes', accountAddress),
		accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'no', accountAddress),
	])
	const viewerEntitlementCaptured = viewerVaultState.viewerEscalationMigrationEntitlement?.initialized === true
	const sides: EscalationSide[] = [
		{
			balance: balances[0] ?? 0n,
			deposits: invalidDeposits,
			importedUserDeposits: viewerEntitlementCaptured ? [] : invalidParentSnapshotDeposits,
			key: 'invalid',
			label: getEscalationSideLabel('invalid'),
			userDeposits: accountAddress === undefined || viewerEntitlementCaptured ? [] : invalidDeposits.filter(deposit => deposit.depositor === accountAddress),
		},
		{
			balance: balances[1] ?? 0n,
			deposits: yesDeposits,
			importedUserDeposits: viewerEntitlementCaptured ? [] : yesParentSnapshotDeposits,
			key: 'yes',
			label: getEscalationSideLabel('yes'),
			userDeposits: accountAddress === undefined || viewerEntitlementCaptured ? [] : yesDeposits.filter(deposit => deposit.depositor === accountAddress),
		},
		{
			balance: balances[2] ?? 0n,
			deposits: noDeposits,
			importedUserDeposits: viewerEntitlementCaptured ? [] : noParentSnapshotDeposits,
			key: 'no',
			label: getEscalationSideLabel('no'),
			userDeposits: accountAddress === undefined || viewerEntitlementCaptured ? [] : noDeposits.filter(deposit => deposit.depositor === accountAddress),
		},
	]
	let settlementState: ReportingSettlementState = 'locked'
	if (normalizedQuestionOutcome !== 'none' && systemState === 'operational') {
		settlementState = 'resolved'
	} else if (universeForkTime > 0n && universeForkTime < escalationEndTime && hasReachedNonDecision === false) {
		settlementState = block.timestamp <= universeForkTime + MIGRATION_TIME_LENGTH ? 'migration-required' : 'migration-expired'
	}
	return {
		bindingCapital,
		completeSetCollateralAmount,
		currentRequiredBond: totalCost === 0n ? startBond : totalCost,
		currentTime: block.timestamp,
		escalationEndTime,
		escalationGameAddress,
		forkThreshold,
		hasReachedNonDecision,
		marketDetails,
		nonDecisionThreshold,
		parentSecurityPoolAddress,
		questionOutcome: normalizedQuestionOutcome,
		securityPoolAddress,
		sides,
		startBond,
		status: 'active',
		systemState,
		settlementState,
		activationTime,
		totalCost,
		universeId,
		parentWithdrawalEnabled: settlementState === 'resolved',
		...viewerVaultState,
	}
}

export async function reportOutcomeInSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositToEscalationGame',
		args: [getReportingOutcomeValue(outcome), amount],
	}))
	return {
		action: 'reportOutcome',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}

export async function withdrawEscalationFromSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'withdrawFromEscalationGame',
		args: [getReportingOutcomeValue(outcome), depositIndexes],
	}))
	return {
		action: 'withdrawEscalation',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}

export async function buildForkCarriedEscalationProofs(client: ReadClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, parentDepositIndexes: readonly bigint[]): Promise<CarriedDepositProof[]> {
	const [parentSecurityPoolAddress, childEscalationGameAddress] = await readRequiredMulticall(client, [
		{
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'parent',
			args: [],
		},
		{
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			args: [],
		},
	])
	if (parentSecurityPoolAddress === zeroAddress) throw new Error('Fork-carried escalation proofs require a child pool.')
	if (childEscalationGameAddress === zeroAddress) throw new Error('Child escalation game unavailable for fork-carried settlement.')
	const parentEscalationGameAddress = await client.readContract({
		address: parentSecurityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		args: [],
	})
	if (parentEscalationGameAddress === zeroAddress) throw new Error('Parent escalation game unavailable for fork-carried settlement.')
	const [parentSnapshot, consumedParentDepositIndexes, childOutcomeState] = await Promise.all([
		loadRecursiveCarrySnapshot(client, parentEscalationGameAddress, outcome),
		loadProofConsumedCarriedDepositIndexes(client, childEscalationGameAddress, outcome),
		readEscalationOutcomeState(client, childEscalationGameAddress, outcome),
	])
	const { currentNullifierRoot: childNullifierRoot } = childOutcomeState
	const { orderedLeaves, carryRoot: parentCarryRoot, carryLeafCount: parentCarryLeafCount } = parentSnapshot
	if (BigInt(orderedLeaves.length) !== parentCarryLeafCount) throw new Error('Parent carry snapshot is not locally reconstructible.')
	const leafHashes = orderedLeaves.map(leaf => hashCarryLeaf(leaf, outcome))
	if (leafHashes.length > 0) {
		const { root: reconstructedRoot } = buildCarryMerkleMountainRangeProof(leafHashes, 0)
		if (reconstructedRoot !== parentCarryRoot) throw new Error('Parent carry snapshot root is not locally reconstructible.')
	}
	const nullifierTree = new SparseNullifier(consumedParentDepositIndexes)
	if (nullifierTree.getRoot() !== childNullifierRoot) throw new Error('Child proof-consumed carry state is not locally reconstructible.')
	const proofs: CarriedDepositProof[] = []
	for (const parentDepositIndex of parentDepositIndexes) {
		const leafIndex = orderedLeaves.findIndex(leaf => leaf.parentDepositIndex === parentDepositIndex)
		if (leafIndex === -1) throw new Error(`Parent carry leaf ${parentDepositIndex.toString()} is unavailable.`)
		const targetLeaf = orderedLeaves[leafIndex]
		if (targetLeaf === undefined) throw new Error(`Parent carry leaf ${parentDepositIndex.toString()} is unavailable.`)
		const { merkleMountainRangePeakIndex, merkleMountainRangeSiblings } = buildCarryMerkleMountainRangeProof(leafHashes, leafIndex)
		const nullifierSiblings = nullifierTree.getProof(parentDepositIndex)
		proofs.push({
			amount: targetLeaf.amount,
			cumulativeAmount: targetLeaf.cumulativeAmount,
			depositor: targetLeaf.depositor,
			leafIndex: BigInt(leafIndex),
			merkleMountainRangePeakIndex,
			merkleMountainRangeSiblings,
			nullifierSiblings,
			parentDepositIndex: targetLeaf.parentDepositIndex,
			sourceNodeId: targetLeaf.sourceNodeId,
		})
		nullifierTree.consume(parentDepositIndex)
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
				abi: peripherals_SecurityPool_SecurityPool.abi,
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
