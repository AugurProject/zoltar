import { concatHex, decodeEventLog, encodeAbiParameters, keccak256, parseAbiItem, parseAbiParameters, zeroAddress, type Address, type ContractFunctionParameters, type Hash, type Hex, type TransactionReceipt } from 'viem'
import { ABIS } from './abis.js'
import { sortBigIntsAscending } from '@zoltar/shared/bigInt'
import { assertNever } from './lib/assert.js'
import { sameAddress } from './lib/address.js'
import { isIgnorableLogDecodeError } from './lib/errors.js'
import { deriveHasForkActivity } from './lib/forkAuction.js'
import { getOracleManagerPriceValidUntilTimestamp } from './lib/securityVault.js'
import { addOpenOracleBountyBuffer } from './lib/openOracle.js'
import { getWethAddress } from './lib/uniswapQuoter.js'
import {
	Zoltar_Zoltar,
	peripherals_EscalationGame_EscalationGame,
	peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator,
	peripherals_SecurityPool_SecurityPool,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_tokens_ShareToken_ShareToken,
} from './contractArtifact.js'
import type {
	CarriedDepositProof,
	DeploymentStepId,
	EscalationDeposit,
	EscalationSide,
	ForkAuctionAction,
	ForkAuctionActionResult,
	ForkAuctionDetails,
	ImportedEscalationDeposit,
	ListedSecurityPool,
	OpenOracleActionResult,
	OracleManagerDetails,
	OracleQueueOperation,
	ReadClient,
	OpenOracleReportSummary,
	OpenOracleReportSummaryPage,
	ReportingActionResult,
	ReportingDetails,
	ReportingOutcomeKey,
	ReportingSettlementState,
	SecurityPoolVaultSummary,
	StagedOracleExecutionResult,
	StagedOracleQueuedResult,
	SecurityVaultActionResult,
	TradingActionResult,
	TradingDetails,
	TradingShareBalances,
	TruthAuctionBidView,
	TruthAuctionBidderBidPage,
	TruthAuctionTickSummary,
	TruthAuctionTickBidPage,
	TruthAuctionTickPage,
	TruthAuctionMetrics,
	WriteClient,
	ZoltarChildUniverseActionResult,
	ZoltarForkActionResult,
	ZoltarMigrationActionResult,
} from './types/contracts.js'
import {
	getEscalationSideLabel,
	getForkOutcomeKey,
	getMinBigintValue,
	getQuestionIdHex,
	getReportingOutcomeKey,
	getReportingOutcomeValue,
	getSecurityPoolSystemState,
	hasTimestamp,
	hasTimestampAndNumber,
	isBigintTriple,
	requireOpenOracleExtraDataTuple,
	requireOpenOracleExtraDataTupleArray,
	requireOpenOracleReportMetaTuple,
	requireOpenOracleReportMetaTupleArray,
	requireOpenOracleReportStatusTuple,
	requireOpenOracleReportStatusTupleArray,
	requireSecurityVaultTupleArray,
	toUint8Array,
} from './contracts/helpers.js'
import { type ContractRevertReasonParams, type WriteContractClient, readRequiredMulticall, writeContractAndWait, writeContractAndWaitForReceipt } from './contracts/core.js'
import { getInfraContractAddresses, getOpenOracleAddress, getZoltarAddress } from './contracts/deploymentHelpers.js'
export { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Allowance, loadErc20Balance } from './contracts/deployment.js'
import { getDeploymentSteps } from './contracts/deployment.js'
export { createSecurityPool, loadSecurityPoolPage, loadSecurityVaultDetails, originSecurityPoolExists } from './contracts/securityPools.js'
export { createMarket, loadAllZoltarQuestions, loadMarketDetails, loadZoltarQuestionCount, loadZoltarQuestionPage, loadZoltarUniverseSummary } from './contracts/zoltar.js'
import { loadMarketDetails } from './contracts/zoltar.js'
export { readOptionalMulticall } from './contracts/core.js'
export { getMulticall3Address, getOpenOracleAddress, getZoltarAddress } from './contracts/deploymentHelpers.js'
const LIQUIDATION_OPERATION_TYPE = 0
const MIGRATION_TIME_LENGTH = 4838400n
const TRUTH_AUCTION_TIME_LENGTH = 604800n
const QUESTION_OUTCOME_ABI = [parseAbiItem('function getQuestionOutcome(address securityPool) view returns (uint8 outcome)')]
const CONTRACT_PAGE_SIZE = 30n
const UNRESOLVED_ESCALATION_MIGRATION_BATCH_LIMIT = 128
const OPEN_ORACLE_PRICE_UNITS = 30n
const NULLIFIER_DEPTH = 64
const CARRY_LEAF_ABI = parseAbiParameters('address depositor, uint8 outcome, uint256 amount, uint256 parentDepositIndex, uint256 cumulativeAmount, uint256 sourceNodeId')
type ReadWriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<ReadClient, 'readContract'> & WriteContractClient<TReceipt>
type ForkDataTuple = readonly [bigint, Address, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean, bigint]
type AuctionClearingTuple = readonly [boolean, bigint, bigint, bigint]
type TruthAuctionTickSummaryStruct = {
	tick: bigint
	price: bigint
	currentTotalEth: bigint
	submissionCount: bigint
	active: boolean
}
type TruthAuctionBidViewStruct = {
	tick: bigint
	bidIndex: bigint
	bidder: Address
	ethAmount: bigint
	cumulativeEth: bigint
	activeCumulativeEthBeforeBid: bigint
	claimed: boolean
	refunded: boolean
}
type ReportingBootstrapReadResult = readonly [bigint, Address, bigint, bigint, Address, bigint, bigint, bigint, Address]
type CarryLeafViewStruct = {
	cumulativeAmount: bigint
	depositor: Address
	parentDepositIndex: bigint
	amount: bigint
	sourceNodeId: bigint
}
type LoadAllSecurityPoolsOptions = {
	accountAddress?: Address
	selectedSecurityPoolAddress?: Address | string
	vaultDetailMode?: 'all' | 'selected'
}
type SecurityPoolDeploymentQueryResult = {
	completeSetCollateralAmount: bigint
	currentRetentionRate: bigint
	parent: Address
	priceOracleManagerAndOperatorQueuer: Address
	questionId: bigint
	securityMultiplier: bigint
	securityPool: Address
	shareToken: Address
	truthAuction: Address
	universeId: bigint
}

const ACTIVE_SECURITY_POOL_VAULT_PREVIEW_LIMIT = 50n
const ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT = 25n
function getOracleQueueOperationFromEventOperation(operation: bigint) {
	switch (operation) {
		case 0n:
			return 'liquidation'
		case 1n:
			return 'withdrawRep'
		case 2n:
			return 'setSecurityBondsAllowance'
		default:
			throw new Error(`Unexpected staged oracle operation: ${operation.toString()}`)
	}
}
function getStagedOracleExecutionResult(receipt: TransactionReceipt, expectedOperation: OracleQueueOperation): StagedOracleExecutionResult | undefined {
	for (const log of receipt.logs) {
		try {
			const decodedLog = decodeEventLog({
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'ExecutedStagedOperation') continue
			const operation = getOracleQueueOperationFromEventOperation(BigInt(decodedLog.args.operation))
			if (operation !== expectedOperation) continue
			const errorMessage = decodedLog.args.errorMessage.trim() === '' ? undefined : decodedLog.args.errorMessage
			return {
				errorMessage,
				operation,
				operationId: decodedLog.args.operationId,
				success: decodedLog.args.success,
			} satisfies StagedOracleExecutionResult
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}
	return undefined
}

function getStagedOracleQueuedResult(receipt: TransactionReceipt, expectedOperation: OracleQueueOperation): StagedOracleQueuedResult | undefined {
	for (const log of receipt.logs) {
		try {
			const decodedLog = decodeEventLog({
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'StagedOperationQueued') continue
			const operation = getOracleQueueOperationFromEventOperation(BigInt(decodedLog.args.operation))
			if (operation !== expectedOperation) continue
			return {
				isPendingSlot: decodedLog.args.isPendingSlot,
				operation,
				operationId: decodedLog.args.operationId,
			} satisfies StagedOracleQueuedResult
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}
	return undefined
}

function getTruthAuctionPageOffset(pageIndex: number, pageSize: number) {
	if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('Page index must be a non-negative integer')
	if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('Page size must be a positive integer')
	return BigInt(pageIndex) * BigInt(pageSize)
}

function requireBigintValue(value: unknown, context: string) {
	if (typeof value === 'bigint') return value
	throw new Error(`Unexpected ${context} response`)
}

async function readSecurityPoolUniverseId(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address) {
	return await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'universeId',
		args: [],
	})
}
function getDeploymentStep(id: DeploymentStepId) {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step
}
export async function loadEscalationDeposits(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<EscalationDeposit[]> {
	let currentIndex = 0n
	const deposits: EscalationDeposit[] = []
	while (true) {
		const page = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getDepositsByOutcome',
			args: [getReportingOutcomeValue(outcome), currentIndex, CONTRACT_PAGE_SIZE],
		})
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

function isCarryLeafView(value: unknown): value is CarryLeafViewStruct {
	if (typeof value !== 'object' || value === undefined || value === null) return false
	const candidate = value as Record<string, unknown>
	return typeof candidate['depositor'] === 'string' && typeof candidate['amount'] === 'bigint' && typeof candidate['parentDepositIndex'] === 'bigint' && typeof candidate['cumulativeAmount'] === 'bigint' && typeof candidate['sourceNodeId'] === 'bigint'
}

async function loadCarryLeafPage(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey) {
	let startNodeId = 0n
	const carryLeaves: CarryLeafViewStruct[] = []
	while (true) {
		const result = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getCarryLeafPageByOutcome',
			args: [getReportingOutcomeValue(outcome), startNodeId, CONTRACT_PAGE_SIZE],
		})
		if (!Array.isArray(result) || result.length !== 2) throw new Error('Unexpected carry leaf page response')
		const [page, nextNodeId] = result
		if (!Array.isArray(page) || typeof nextNodeId !== 'bigint') throw new Error('Unexpected carry leaf page response')
		const normalizedPage = page.filter(isCarryLeafView)
		carryLeaves.push(...normalizedPage)
		if (nextNodeId === 0n) break
		startNodeId = nextNodeId
	}
	return carryLeaves
}

async function loadProofConsumedCarriedDepositIndexes(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey) {
	let startIndex = 0n
	const parentDepositIndexes: bigint[] = []
	while (true) {
		const page = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getProofConsumedCarriedDepositIndexesByOutcome',
			args: [getReportingOutcomeValue(outcome), startIndex, CONTRACT_PAGE_SIZE],
		})
		if (!Array.isArray(page)) throw new Error('Unexpected consumed carried deposit index page response')
		const normalizedPage = page.filter((value): value is bigint => typeof value === 'bigint')
		parentDepositIndexes.push(...normalizedPage)
		if (BigInt(normalizedPage.length) !== CONTRACT_PAGE_SIZE) break
		startIndex += CONTRACT_PAGE_SIZE
	}
	return parentDepositIndexes
}

async function readForkContinuation(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address) {
	try {
		return await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'forkContinuation',
			args: [],
		})
	} catch (error) {
		if (isIgnorableLogDecodeError(error)) return undefined
		return undefined
	}
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
	const orderedLocalLeaves = [...localLeaves].sort((left, right) => compareBigintAscending(left.parentDepositIndex, right.parentDepositIndex))
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
		orderedLeaves: [...parentSnapshot.orderedLeaves, ...orderedLocalLeaves].sort((left, right) => compareBigintAscending(left.parentDepositIndex, right.parentDepositIndex)),
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
			viewerVaultExists: false,
			viewerVaultEscrowedRep: undefined,
			viewerVaultRepDepositShare: undefined,
		}
	const viewerVaultTuple = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityVaults',
		address: securityPoolAddress,
		args: [accountAddress],
	})
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
	const [questionId, escalationGameAddress, completeSetCollateralAmount, universeId, zoltarAddress, initialEscalationGameDeposit, systemStateValue, questionOutcomeValue, parentSecurityPoolAddress] = (await readRequiredMulticall(client, reportingPoolReads)) as unknown as ReportingBootstrapReadResult
	const systemState = getSecurityPoolSystemState(systemStateValue)
	const normalizedQuestionOutcome = getReportingOutcomeKey(questionOutcomeValue)
	const [marketDetails, block, escalationGameCode, viewerVaultState, forkThreshold, forkContinuationSnapshot] = await Promise.all([
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
		escalationGameAddress === zeroAddress ? Promise.resolve(undefined) : readForkContinuation(client, escalationGameAddress),
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
	const sides: EscalationSide[] = [
		{
			balance: balances[0] ?? 0n,
			deposits: invalidDeposits,
			importedUserDeposits: invalidParentSnapshotDeposits,
			key: 'invalid',
			label: getEscalationSideLabel('invalid'),
			userDeposits: accountAddress === undefined ? [] : invalidDeposits.filter(deposit => deposit.depositor === accountAddress),
		},
		{ balance: balances[1] ?? 0n, deposits: yesDeposits, importedUserDeposits: yesParentSnapshotDeposits, key: 'yes', label: getEscalationSideLabel('yes'), userDeposits: accountAddress === undefined ? [] : yesDeposits.filter(deposit => deposit.depositor === accountAddress) },
		{ balance: balances[2] ?? 0n, deposits: noDeposits, importedUserDeposits: noParentSnapshotDeposits, key: 'no', label: getEscalationSideLabel('no'), userDeposits: accountAddress === undefined ? [] : noDeposits.filter(deposit => deposit.depositor === accountAddress) },
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
async function getSecurityPoolVaultCount(client: ReadClient, securityPoolAddress: Address) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getActiveVaultCount',
		address: securityPoolAddress,
		args: [],
	})
}
async function getSecurityPoolVaults(client: ReadClient, securityPoolAddress: Address, startIndex: bigint, count: bigint) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getActiveVaults',
		address: securityPoolAddress,
		args: [startIndex, count],
	})
}

function isActiveSecurityVaultTuple(vaultData: readonly [bigint, bigint, bigint, bigint] | readonly [bigint, bigint, bigint, bigint, bigint]) {
	const [poolOwnership, securityBondAllowance, unpaidEthFees] = vaultData
	return poolOwnership > 0n || securityBondAllowance > 0n || unpaidEthFees > 0n
}

async function loadSecurityPoolVaultSummaries(
	client: ReadClient,
	securityPoolAddress: Address,
	options: {
		accountAddress?: Address
		previewLimit?: bigint
	} = {},
): Promise<{
	hasLoadedVaults: boolean
	vaultCount: bigint
	vaults: SecurityPoolVaultSummary[]
}> {
	const vaultCount = await getSecurityPoolVaultCount(client, securityPoolAddress)
	const previewLimit = options.previewLimit ?? ACTIVE_SECURITY_POOL_VAULT_PREVIEW_LIMIT
	const previewCount = vaultCount < previewLimit ? vaultCount : previewLimit
	const previewVaultAddresses = previewCount === 0n ? [] : await getSecurityPoolVaults(client, securityPoolAddress, 0n, previewCount)
	const summaryVaultAddresses = [...previewVaultAddresses]
	if (options.accountAddress !== undefined && !summaryVaultAddresses.some(vaultAddress => sameAddress(vaultAddress, options.accountAddress))) {
		summaryVaultAddresses.push(options.accountAddress)
	}
	if (summaryVaultAddresses.length === 0) return { hasLoadedVaults: true, vaultCount, vaults: [] }
	const vaultDataContracts: ContractFunctionParameters[] = summaryVaultAddresses.map(vaultAddress => ({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityVaults',
		address: securityPoolAddress,
		args: [vaultAddress],
	}))
	const [vaultDataResults, totalRepBalance, poolOwnershipDenominator] = await Promise.all([
		readRequiredMulticall(client, vaultDataContracts),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalRepBalance',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'poolOwnershipDenominator',
			address: securityPoolAddress,
			args: [],
		}),
	])
	const vaultData = requireSecurityVaultTupleArray(vaultDataResults, 'security vault tuple')
	const escalationGameAddress = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		address: securityPoolAddress,
		args: [],
	})
	const escrowedRepByVault = sameAddress(escalationGameAddress, zeroAddress)
		? summaryVaultAddresses.map(() => 0n)
		: await Promise.all(
				summaryVaultAddresses.map(
					async vaultAddress =>
						await client.readContract({
							abi: peripherals_EscalationGame_EscalationGame.abi,
							functionName: 'escrowedRepByVault',
							address: escalationGameAddress,
							args: [vaultAddress],
						}),
				),
			)
	const vaults = summaryVaultAddresses.flatMap((vaultAddress, index) => {
		const currentVaultData = vaultData[index]
		if (currentVaultData === undefined) throw new Error('Unexpected vault data response')
		const currentEscrowedRep = escrowedRepByVault[index]
		if (currentEscrowedRep === undefined) throw new Error('Unexpected escrowed REP response')
		if (!previewVaultAddresses.some(currentPreviewAddress => sameAddress(currentPreviewAddress, vaultAddress)) && !isActiveSecurityVaultTuple(currentVaultData) && currentEscrowedRep === 0n) return []
		const [poolOwnership, securityBondAllowance, unpaidEthFees] = currentVaultData
		return [
			{
				escalationEscrowedRep: currentEscrowedRep,
				repDepositShare: poolOwnershipDenominator === 0n || poolOwnership === 0n ? 0n : (poolOwnership * totalRepBalance) / poolOwnershipDenominator,
				securityBondAllowance,
				unpaidEthFees,
				vaultAddress,
			} satisfies SecurityPoolVaultSummary,
		]
	})
	return { hasLoadedVaults: true, vaultCount, vaults }
}
export async function approveErc20<Action extends SecurityVaultActionResult['action'] | OpenOracleActionResult['action'] | ZoltarForkActionResult['action']>(client: WriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: Action) {
	const hash = await writeContractAndWait(client, () => ({
		address: tokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [spenderAddress, amount],
	}))
	return { action, hash }
}
export async function depositRepToSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositRep',
		args: [amount],
	}))
	return {
		action: 'depositRep',
		hash,
	} satisfies SecurityVaultActionResult
}
export async function updateSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'updateVaultFees',
		args: [vaultAddress],
	}))
	return {
		action: 'updateVaultFees',
		hash,
	} satisfies SecurityVaultActionResult
}
export async function redeemSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemFees',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemFees',
		hash,
	} satisfies SecurityVaultActionResult
}
export async function redeemRepFromSecurityPool(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemRep',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemRep',
		hash,
	} satisfies SecurityVaultActionResult
}
export async function loadOracleManagerDetails(client: ReadClient, managerAddress: Address, openOracleAddress?: Address): Promise<OracleManagerDetails> {
	const [lastPrice, pendingOperationSlotId, pendingReportId, requestPriceEthCost, rawIsPriceValid, lastSettlementTimestamp, activeStagedOperationCount, priceRoundId, priceRoundMaxNotional, priceRoundConsumedNotional, priceRoundRemainingNotional] = await readRequiredMulticall(client, [
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'lastPrice',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'pendingOperationSlotId',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'pendingReportId',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'getRequestPriceEthCost',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'isPriceValid',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'getActiveStagedOperationCount',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'priceRoundId',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'priceRoundMaxNotional',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'priceRoundConsumedNotional',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'getPriceRoundRemainingNotional',
			address: managerAddress,
			args: [],
		},
	])
	const normalizedPriceRoundMaxNotional = requireBigintValue(priceRoundMaxNotional, 'price round max notional')
	const normalizedPriceRoundConsumedNotional = requireBigintValue(priceRoundConsumedNotional, 'price round consumed notional')
	const normalizedPriceRoundRemainingNotional = requireBigintValue(priceRoundRemainingNotional, 'price round remaining notional')
	const normalizedPriceRoundId = requireBigintValue(priceRoundId, 'price round id')
	const resolvedOracleAddress = openOracleAddress ?? getInfraContractAddresses().openOracle
	let callbackStateHash: Hex | undefined
	let exactToken1Report: bigint | undefined
	let pendingOperation: import('./types/contracts.js').StagedOracleOperation | undefined
	let stagedOperations: import('./types/contracts.js').StagedOracleOperation[] = []
	let token1: Address | undefined
	let token2: Address | undefined
	if (activeStagedOperationCount > 0n) {
		const previewCount = activeStagedOperationCount < ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT ? activeStagedOperationCount : ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT
		const [operationIds, activeOperations] = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'getActiveStagedOperations',
			address: managerAddress,
			args: [0n, previewCount],
		})
		stagedOperations = operationIds
			.map((operationId, index) => {
				const stagedOperation = activeOperations[index]
				if (stagedOperation === undefined) throw new Error('Missing staged operation details')
				return {
					amount: stagedOperation.amount,
					initiatorVault: stagedOperation.initiatorVault,
					operation: resolveOracleQueueOperation(stagedOperation.operation),
					operationId,
					targetVault: stagedOperation.targetVault,
				}
			})
			.sort(compareStagedOperationIdsDescending)
		pendingOperation = stagedOperations.find(operation => operation.operationId === pendingOperationSlotId)
		if (pendingOperation === undefined && pendingOperationSlotId > 0n) {
			const stagedOperation = await client.readContract({
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
				functionName: 'getPendingOperationSlot',
				address: managerAddress,
				args: [],
			})
			if (stagedOperation.initiatorVault !== zeroAddress) {
				pendingOperation = {
					amount: stagedOperation.amount,
					initiatorVault: stagedOperation.initiatorVault,
					operation: resolveOracleQueueOperation(stagedOperation.operation),
					operationId: pendingOperationSlotId,
					targetVault: stagedOperation.targetVault,
				}
				if (!stagedOperations.some(operation => operation.operationId === pendingOperationSlotId)) {
					stagedOperations = [pendingOperation, ...stagedOperations].sort(compareStagedOperationIdsDescending)
				}
			}
		}
	}
	if (pendingReportId > 0n) {
		const [extraData, reportMeta] = await readRequiredMulticall(client, [
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'extraData',
				address: resolvedOracleAddress,
				args: [pendingReportId],
			},
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportMeta',
				address: resolvedOracleAddress,
				args: [pendingReportId],
			},
		])
		callbackStateHash = extraData[0]
		exactToken1Report = reportMeta[0]
		token1 = reportMeta[4]
		token2 = reportMeta[6]
	}
	return {
		activeStagedOperationCount,
		callbackStateHash,
		exactToken1Report,
		isPriceValid: lastSettlementTimestamp > 0n && rawIsPriceValid,
		lastPrice,
		lastSettlementTimestamp,
		managerAddress,
		openOracleAddress: resolvedOracleAddress,
		pendingOperation,
		pendingOperationSlotId,
		pendingReportId,
		priceRoundConsumedNotional: normalizedPriceRoundConsumedNotional,
		priceRoundId: normalizedPriceRoundId,
		priceRoundMaxNotional: normalizedPriceRoundMaxNotional,
		priceRoundRemainingNotional: normalizedPriceRoundRemainingNotional,
		priceValidUntilTimestamp: getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp),
		requestPriceEthCost,
		stagedOperations,
		token1,
		token2,
	}
}
function resolveOracleQueueOperation(operation: bigint | number): OracleQueueOperation {
	const operationValue = typeof operation === 'bigint' ? operation : BigInt(operation)
	switch (operationValue) {
		case 0n:
			return 'liquidation'
		case 1n:
			return 'withdrawRep'
		case 2n:
			return 'setSecurityBondsAllowance'
		default:
			throw new Error(`Unknown oracle operation: ${operation}`)
	}
}

function compareStagedOperationIdsDescending(left: { operationId: bigint }, right: { operationId: bigint }) {
	if (left.operationId > right.operationId) return -1
	if (left.operationId < right.operationId) return 1
	return 0
}

function calculateOpenOraclePrice(amount1: bigint, amount2: bigint) {
	return amount2 === 0n ? 0n : (amount1 * 10n ** OPEN_ORACLE_PRICE_UNITS) / amount2
}

function hasOpenOracleDisputeOccurred(currentReporter: Address, initialReporter: Address, numReports: bigint) {
	if (numReports > 1n) return true
	if (currentReporter === zeroAddress || initialReporter === zeroAddress) return false
	return !sameAddress(currentReporter, initialReporter)
}
export async function loadOpenOracleReportDetails(client: ReadClient, openOracleAddress: Address, reportId: bigint): Promise<import('./types/contracts.js').OpenOracleReportDetails> {
	const [[meta, status, extra], block] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportMeta',
				address: openOracleAddress,
				args: [reportId],
			},
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportStatus',
				address: openOracleAddress,
				args: [reportId],
			},
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'extraData',
				address: openOracleAddress,
				args: [reportId],
			},
		]),
		client.getBlock(),
	])
	const reportMeta = requireOpenOracleReportMetaTuple(meta, 'open oracle report meta')
	const reportStatus = requireOpenOracleReportStatusTuple(status, 'open oracle report status')
	const reportExtra = requireOpenOracleExtraDataTuple(extra, 'open oracle report extra')
	if (!hasTimestampAndNumber(block)) throw new Error('Unexpected block response')
	if (reportMeta[4] === zeroAddress) throw new Error(`Oracle report #${reportId.toString()} does not exist`)
	const [token1Decimals, token2Decimals, token1Symbol, token2Symbol] = await readRequiredMulticall(client, [
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'decimals',
			address: reportMeta[4],
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'decimals',
			address: reportMeta[6],
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'symbol',
			address: reportMeta[4],
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'symbol',
			address: reportMeta[6],
			args: [],
		},
	])
	return {
		reportId,
		openOracleAddress,
		currentTime: block.timestamp,
		currentBlockNumber: block.number,
		exactToken1Report: reportMeta[0],
		escalationHalt: reportMeta[1],
		fee: reportMeta[2],
		settlerReward: reportMeta[3],
		token1: reportMeta[4],
		settlementTime: BigInt(reportMeta[5]),
		token2: reportMeta[6],
		timeType: reportMeta[7],
		feePercentage: BigInt(reportMeta[8]),
		protocolFee: BigInt(reportMeta[9]),
		multiplier: BigInt(reportMeta[10]),
		disputeDelay: BigInt(reportMeta[11]),
		currentAmount1: reportStatus[0],
		currentAmount2: reportStatus[1],
		price: calculateOpenOraclePrice(reportStatus[0], reportStatus[1]),
		currentReporter: reportStatus[2],
		reportTimestamp: BigInt(reportStatus[3]),
		settlementTimestamp: BigInt(reportStatus[4]),
		initialReporter: reportStatus[5],
		disputeOccurred: hasOpenOracleDisputeOccurred(reportStatus[2], reportStatus[5], BigInt(reportExtra[2])),
		isDistributed: BigInt(reportStatus[4]) > 0n,
		stateHash: reportExtra[0],
		callbackContract: reportExtra[1],
		numReports: BigInt(reportExtra[2]),
		callbackGasLimit: Number(reportExtra[3]),
		protocolFeeRecipient: reportExtra[4],
		trackDisputes: reportExtra[5],
		lastReportOppoTime: BigInt(reportStatus[6]),
		token1Decimals: Number(token1Decimals),
		token2Decimals: Number(token2Decimals),
		token1Symbol: String(token1Symbol),
		token2Symbol: String(token2Symbol),
	}
}
export async function loadOpenOracleReportSummaries(client: ReadClient, pageIndex: number, pageSize: number): Promise<OpenOracleReportSummaryPage> {
	if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('Page index must be a non-negative integer')
	if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('Page size must be a positive integer')
	const openOracleAddress = getOpenOracleAddress()
	const nextReportId = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'nextReportId',
		address: openOracleAddress,
		args: [],
	})
	const reportCount = nextReportId > 0n ? nextReportId - 1n : 0n
	if (reportCount === 0n)
		return {
			nextReportId,
			pageIndex,
			pageSize,
			reportCount,
			reports: [],
		}
	const pageSizeBigInt = BigInt(pageSize)
	const pageIndexBigInt = BigInt(pageIndex)
	const pageEndId = reportCount - pageIndexBigInt * pageSizeBigInt
	if (pageEndId <= 0n)
		return {
			nextReportId,
			pageIndex,
			pageSize,
			reportCount,
			reports: [],
		}
	const pageStartId = pageEndId > pageSizeBigInt ? pageEndId - pageSizeBigInt + 1n : 1n
	const reportIds: bigint[] = []
	for (let reportId = pageEndId; reportId >= pageStartId; reportId--) {
		reportIds.push(reportId)
		if (reportId === pageStartId) break
	}
	const [metaResults, statusResults, extraResults] = await Promise.all([
		readRequiredMulticall(
			client,
			reportIds.map(reportId => ({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportMeta',
				address: openOracleAddress,
				args: [reportId],
			})),
		),
		readRequiredMulticall(
			client,
			reportIds.map(reportId => ({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportStatus',
				address: openOracleAddress,
				args: [reportId],
			})),
		),
		readRequiredMulticall(
			client,
			reportIds.map(reportId => ({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'extraData',
				address: openOracleAddress,
				args: [reportId],
			})),
		),
	])
	const metas = requireOpenOracleReportMetaTupleArray(metaResults, 'open oracle report metas')
	const statuses = requireOpenOracleReportStatusTupleArray(statusResults, 'open oracle report statuses')
	const extras = requireOpenOracleExtraDataTupleArray(extraResults, 'open oracle report extras')
	const tokenAddresses = new Set<Address>()
	for (const meta of metas) {
		if (meta[4] !== zeroAddress) tokenAddresses.add(meta[4])
		if (meta[6] !== zeroAddress) tokenAddresses.add(meta[6])
	}
	const uniqueTokenAddresses = [...tokenAddresses]
	const tokenMetadata = new Map<
		Address,
		{
			decimals: number
			symbol: string
		}
	>()
	if (uniqueTokenAddresses.length > 0) {
		const tokenDecimals = await readRequiredMulticall(
			client,
			uniqueTokenAddresses.map(tokenAddress => ({
				abi: ABIS.mainnet.erc20,
				functionName: 'decimals',
				address: tokenAddress,
				args: [],
			})),
		)
		const tokenSymbols = await readRequiredMulticall(
			client,
			uniqueTokenAddresses.map(tokenAddress => ({
				abi: ABIS.mainnet.erc20,
				functionName: 'symbol',
				address: tokenAddress,
				args: [],
			})),
		)
		for (const [index, tokenAddress] of uniqueTokenAddresses.entries()) {
			const decimals = tokenDecimals[index]
			const symbol = tokenSymbols[index]
			if (decimals === undefined || symbol === undefined) throw new Error('Unexpected token metadata response')
			tokenMetadata.set(tokenAddress, {
				decimals: Number(decimals),
				symbol: String(symbol),
			})
		}
	}
	const reports = reportIds.map((reportId, index) => {
		const meta = metas[index]
		const status = statuses[index]
		const extra = extras[index]
		if (meta === undefined || status === undefined || extra === undefined) throw new Error('Unexpected oracle report summary response')
		const token1Metadata = tokenMetadata.get(meta[4])
		const token2Metadata = tokenMetadata.get(meta[6])
		if (token1Metadata === undefined || token2Metadata === undefined) throw new Error('Unexpected oracle token metadata response')
		return {
			currentAmount1: status[0],
			currentAmount2: status[1],
			currentReporter: status[2],
			disputeOccurred: hasOpenOracleDisputeOccurred(status[2], status[5], BigInt(extra[2])),
			exactToken1Report: meta[0],
			isDistributed: BigInt(status[4]) > 0n,
			price: calculateOpenOraclePrice(status[0], status[1]),
			reportId,
			reportTimestamp: BigInt(status[3]),
			settlementTimestamp: BigInt(status[4]),
			token1: meta[4],
			token2: meta[6],
			token1Decimals: token1Metadata.decimals,
			token2Decimals: token2Metadata.decimals,
			token1Symbol: token1Metadata.symbol,
			token2Symbol: token2Metadata.symbol,
		} satisfies OpenOracleReportSummary
	})
	return {
		nextReportId,
		pageIndex,
		pageSize,
		reportCount,
		reports,
	}
}
export async function createOpenOracleReportInstance(
	client: WriteClient,
	parameters: {
		disputeDelay: number
		escalationHalt: bigint
		exactToken1Report: bigint
		ethValue: bigint
		feePercentage: number
		multiplier: number
		protocolFee: number
		settlementTime: number
		settlerReward: bigint
		token1Address: Address
		token2Address: Address
	},
) {
	const assertSafeInteger = (value: number, label: string) => {
		if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds the maximum safe integer range`)
	}
	assertSafeInteger(parameters.disputeDelay, 'Dispute delay')
	assertSafeInteger(parameters.feePercentage, 'Fee percentage')
	assertSafeInteger(parameters.multiplier, 'Multiplier')
	assertSafeInteger(parameters.protocolFee, 'Protocol fee')
	assertSafeInteger(parameters.settlementTime, 'Settlement time')
	const callParams = {
		address: getOpenOracleAddress(),
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'createReportInstance',
		args: [parameters.token1Address, parameters.token2Address, parameters.exactToken1Report, parameters.feePercentage, parameters.multiplier, parameters.settlementTime, parameters.escalationHalt, parameters.disputeDelay, parameters.protocolFee, parameters.settlerReward],
		value: parameters.ethValue,
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'createReportInstance',
		hash,
	} satisfies OpenOracleActionResult
}
async function loadBufferedOracleRequestEthCost(client: WriteClient, managerAddress: Address) {
	const requestPriceEthCost = await client.readContract({
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getRequestPriceEthCost',
		args: [],
	})
	return addOpenOracleBountyBuffer(requestPriceEthCost)
}
export async function requestOraclePrice(client: WriteClient, managerAddress: Address) {
	const callParams = {
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'requestPrice',
		args: [],
		value: await loadBufferedOracleRequestEthCost(client, managerAddress),
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'requestPrice',
		hash,
	} satisfies OpenOracleActionResult
}
export async function executeOracleManagerStagedOperation(client: WriteClient, managerAddress: Address, operationId: bigint) {
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'executeStagedOperation',
		args: [operationId],
	}))
	const stagedExecution = getStagedOracleExecutionResult(receipt, 'liquidation') ?? getStagedOracleExecutionResult(receipt, 'withdrawRep') ?? getStagedOracleExecutionResult(receipt, 'setSecurityBondsAllowance')
	return {
		action: 'executeStagedOperation',
		hash,
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	} satisfies OpenOracleActionResult
}
export async function wrapWeth(client: WriteClient, amount: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getWethAddress(),
		abi: [
			{
				type: 'function',
				name: 'deposit',
				stateMutability: 'payable',
				inputs: [],
				outputs: [],
			},
		],
		functionName: 'deposit',
		value: amount,
	}))
	return {
		action: 'wrapWeth',
		hash,
	} satisfies OpenOracleActionResult
}
export async function submitInitialOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint, amount1: bigint, amount2: bigint, stateHash: Hex) {
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'submitInitialReport',
		args: [reportId, amount1, amount2, stateHash],
	}))
	return {
		action: 'submitInitialReport',
		hash,
	} satisfies OpenOracleActionResult
}
export async function settleOracleReport<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, openOracleAddress: Address, reportId: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'settle',
		gas: 5000000n,
		args: [reportId],
	}))
	return {
		action: 'settle',
		hash,
	} satisfies OpenOracleActionResult
}
export async function disputeOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, amt2Expected: bigint, stateHash: Hex) {
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'disputeAndSwap',
		args: [reportId, tokenToSwap, newAmount1, newAmount2, amt2Expected, stateHash],
	}))
	return {
		action: 'dispute',
		hash,
	} satisfies OpenOracleActionResult
}
export async function loadForkOutcomeMigrationSeedStatus(
	client: Pick<ReadClient, 'readContract'>,
	{
		childSecurityPoolAddress,
		outcome,
		securityPoolAddress,
		universeId,
	}: {
		childSecurityPoolAddress?: Address | undefined
		outcome: ReportingOutcomeKey
		securityPoolAddress: Address
		universeId: bigint
	},
) {
	const childUniverseId = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getChildUniverseId',
		address: getZoltarAddress(),
		args: [universeId, BigInt(getReportingOutcomeValue(outcome))],
	})
	const migrationProxyAddress = await client.readContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'getMigrationProxyAddress',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
	const childRepToken = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getRepToken',
		address: getZoltarAddress(),
		args: [childUniverseId],
	})
	if (childRepToken === zeroAddress) {
		return {
			childPoolRepBalance: 0n,
			childRepToken: undefined,
			childUniverseId,
			migrationProxyAddress,
			pendingProxyRepBalance: 0n,
			seeded: false,
		}
	}
	const pendingProxyRepBalance = await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: childRepToken,
		args: [migrationProxyAddress],
	})
	const childPoolRepBalance =
		childSecurityPoolAddress === undefined
			? 0n
			: await client.readContract({
					abi: ABIS.mainnet.erc20,
					functionName: 'balanceOf',
					address: childRepToken,
					args: [childSecurityPoolAddress],
				})

	return {
		childPoolRepBalance,
		childRepToken,
		childUniverseId,
		migrationProxyAddress,
		pendingProxyRepBalance,
		seeded: pendingProxyRepBalance > 0n || childPoolRepBalance > 0n,
	}
}

export async function loadForkAuctionDetails(client: ReadClient, securityPoolAddress: Address): Promise<ForkAuctionDetails> {
	const [[questionId, parentSecurityPoolAddress, universeId, systemStateValue, truthAuctionAddress, completeSetCollateralAmount, forkData, questionOutcome], ownForkMigrationStatusTuple, block] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'questionId',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'parent',
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
				functionName: 'systemState',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'truthAuction',
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
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkData',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
			{
				abi: QUESTION_OUTCOME_ABI,
				functionName: 'getQuestionOutcome',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
		]),
		client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getOwnForkMigrationStatus',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		client.getBlock(),
	])
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')
	const marketDetails = await loadMarketDetails(client, questionId)
	const forkDataTuple: ForkDataTuple = forkData
	const [auctionableRepAtFork, , truthAuctionStartedAt, migratedRep, auctionedSecurityBondAllowance, , , , forkOwnSecurityPool, , forkOutcomeIndex] = forkDataTuple
	const [ownForkMigrationOwnFork, ownForkMigrationAuctionableRepAtFork, vaultRepAtFork, unallocatedEscrowChildRep, escrowSourceRepAtFork] = ownForkMigrationStatusTuple
	const systemState = getSecurityPoolSystemState(systemStateValue)
	const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parentSecurityPoolAddress)
	const hasForkActivity = deriveHasForkActivity({
		forkOutcome,
		migratedRep,
		systemState,
		truthAuctionStartedAt,
	})
	const universeForkTime = (
		await readRequiredMulticall(client, [
			{
				abi: Zoltar_Zoltar.abi,
				functionName: 'getForkTime',
				address: getInfraContractAddresses().zoltar,
				args: [universeId],
			},
		])
	)[0]
	const migrationEndsAt = universeForkTime === 0n ? undefined : universeForkTime + MIGRATION_TIME_LENGTH
	let truthAuction: TruthAuctionMetrics | undefined
	if (truthAuctionAddress !== zeroAddress && truthAuctionStartedAt > 0n) {
		const [computeClearingResult, ethRaiseCap, ethRaised, finalized, maxRepBeingSold, minBidSize, totalRepPurchased, underfunded] = await readRequiredMulticall(client, [
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'computeClearing',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'ethRaiseCap',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'ethRaised',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'finalized',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'maxRepBeingSold',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'minBidSize',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'totalRepPurchased',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfunded',
				address: truthAuctionAddress,
				args: [],
			},
		])
		const computeClearingTuple: AuctionClearingTuple = computeClearingResult
		const [hitCap, clearingTick, accumulatedEth, ethAtClearingTick] = computeClearingTuple
		const clearingPrice =
			clearingTick === 0n && accumulatedEth === 0n
				? undefined
				: await client.readContract({
						abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
						functionName: 'tickToPrice',
						address: truthAuctionAddress,
						args: [clearingTick],
					})
		truthAuction = {
			accumulatedEth,
			auctionEndsAt: truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH,
			clearingPrice,
			clearingTick,
			ethAtClearingTick,
			ethRaiseCap,
			ethRaised,
			finalized,
			hitCap,
			maxRepBeingSold,
			minBidSize,
			repPurchasableAtBid: clearingPrice === undefined || clearingPrice === 0n ? undefined : (ethRaiseCap * 10n ** 18n) / clearingPrice,
			timeRemaining: finalized || block.timestamp >= truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH ? 0n : truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH - block.timestamp,
			totalRepPurchased,
			underfunded,
		}
	}
	return {
		auctionedSecurityBondAllowance,
		claimingAvailable: systemState === 'operational' && truthAuctionAddress !== zeroAddress,
		completeSetCollateralAmount,
		currentTime: block.timestamp,
		forkOutcome,
		forkOwnSecurityPool,
		hasForkActivity,
		marketDetails,
		migratedRep,
		migrationEndsAt,
		parentSecurityPoolAddress,
		questionOutcome: getReportingOutcomeKey(questionOutcome),
		...(ownForkMigrationOwnFork
			? {
					ownForkRepBuckets: {
						vaultRepAtFork,
						unallocatedEscrowChildRep,
						escrowSourceRepAtFork,
					},
				}
			: {}),
		auctionableRepAtFork: ownForkMigrationOwnFork ? ownForkMigrationAuctionableRepAtFork : auctionableRepAtFork,
		securityPoolAddress,
		systemState,
		truthAuction,
		truthAuctionAddress,
		truthAuctionStartedAt,
		universeId,
	}
}

function mapTruthAuctionTickSummary(summary: TruthAuctionTickSummaryStruct): TruthAuctionTickSummary {
	return {
		tick: summary.tick,
		price: summary.price,
		currentTotalEth: summary.currentTotalEth,
		submissionCount: summary.submissionCount,
		active: summary.active,
	}
}

function mapTruthAuctionBidView(bid: TruthAuctionBidViewStruct): TruthAuctionBidView {
	return {
		tick: bid.tick,
		bidIndex: bid.bidIndex,
		bidder: bid.bidder,
		ethAmount: bid.ethAmount,
		cumulativeEth: bid.cumulativeEth,
		activeCumulativeEthBeforeBid: bid.activeCumulativeEthBeforeBid,
		claimed: bid.claimed,
		refunded: bid.refunded,
	}
}

export async function loadTruthAuctionTickSummary(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint): Promise<TruthAuctionTickSummary> {
	const summary = (await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getTickSummary',
		address: truthAuctionAddress,
		args: [tick],
	})) as TruthAuctionTickSummaryStruct
	return mapTruthAuctionTickSummary(summary)
}

export async function loadTruthAuctionTickPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionTickPage> {
	const offset = getTruthAuctionPageOffset(pageIndex, pageSize)
	const tickCount = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getTickCount',
		address: truthAuctionAddress,
		args: [],
	})
	const tickPage = (await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getTickPage',
		address: truthAuctionAddress,
		args: [offset, BigInt(pageSize)],
	})) as readonly TruthAuctionTickSummaryStruct[]
	return {
		pageIndex,
		pageSize,
		tickCount,
		ticks: tickPage.map(summary => mapTruthAuctionTickSummary(summary)),
	}
}

export async function loadTruthAuctionActiveTickPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionTickPage> {
	const offset = getTruthAuctionPageOffset(pageIndex, pageSize)
	const tickCount = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'activeTickCount',
		address: truthAuctionAddress,
		args: [],
	})
	const tickPage = (await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getActiveTickPage',
		address: truthAuctionAddress,
		args: [offset, BigInt(pageSize)],
	})) as readonly TruthAuctionTickSummaryStruct[]
	return {
		pageIndex,
		pageSize,
		tickCount,
		ticks: tickPage.map(summary => mapTruthAuctionTickSummary(summary)),
	}
}

export async function loadTruthAuctionTickBidPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint, pageIndex: number, pageSize: number): Promise<TruthAuctionTickBidPage> {
	const offset = getTruthAuctionPageOffset(pageIndex, pageSize)
	const bidCount = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getBidCountAtTick',
		address: truthAuctionAddress,
		args: [tick],
	})
	const bidPage = (await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getBidPageAtTick',
		address: truthAuctionAddress,
		args: [tick, offset, BigInt(pageSize)],
	})) as readonly TruthAuctionBidViewStruct[]
	return {
		tick,
		pageIndex,
		pageSize,
		bidCount,
		bids: bidPage.map(bid => mapTruthAuctionBidView(bid)),
	}
}

export async function loadTruthAuctionBidderBidPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, bidder: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionBidderBidPage> {
	const offset = getTruthAuctionPageOffset(pageIndex, pageSize)
	const bidCount = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getBidderBidCount',
		address: truthAuctionAddress,
		args: [bidder],
	})
	const bidPage = (await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getBidderBidPage',
		address: truthAuctionAddress,
		args: [bidder, offset, BigInt(pageSize)],
	})) as readonly TruthAuctionBidViewStruct[]
	return {
		bidder,
		pageIndex,
		pageSize,
		bidCount,
		bids: bidPage.map(bid => mapTruthAuctionBidView(bid)),
	}
}

async function executeForkAuctionAction(client: WriteClient, action: ForkAuctionAction, securityPoolAddress: Address, universeId: bigint, request: () => Promise<Hash>) {
	const hash = await request()
	await client.waitForTransactionReceipt({ hash })
	return {
		action,
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}

export async function forkZoltarWithOwnEscalation(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'forkWithOwnEscalation',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkZoltarWithOwnEscalationGame',
				args: [securityPoolAddress],
			})),
	)
}
export async function initiateSecurityPoolFork(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'initiateFork',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'initiateSecurityPoolFork',
				args: [securityPoolAddress],
			})),
	)
}
export async function createChildUniverseFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(
		client,
		'createChildUniverse',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'createChildUniverse',
				args: [securityPoolAddress, BigInt(getReportingOutcomeValue(outcome))],
			})),
	)
}
export async function createZoltarChildUniverse(client: WriteClient, universeId: bigint, outcomeIndex: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'deployChild',
		args: [universeId, outcomeIndex],
	}))
	return {
		action: 'createChildUniverse',
		hash,
		outcomeIndex,
		universeId,
	} satisfies ZoltarChildUniverseActionResult
}
async function executeZoltarMigrationAction<TCallParams extends ContractRevertReasonParams>(client: WriteClient, action: ZoltarMigrationActionResult['action'], universeId: bigint, amount: bigint, outcomeIndexes: bigint[], callParams: TCallParams) {
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action,
		amount,
		hash,
		outcomeIndexes,
		universeId,
	} satisfies ZoltarMigrationActionResult
}
export async function prepareRepForMigrationInZoltar(client: WriteClient, universeId: bigint, amount: bigint) {
	const callParams = {
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'addRepToMigrationBalance',
		args: [universeId, amount],
	}
	return await executeZoltarMigrationAction(client, 'addRepToMigrationBalance', universeId, amount, [], callParams)
}
export async function migrateInternalRepInZoltar(client: WriteClient, universeId: bigint, amount: bigint, outcomeIndexes: bigint[]) {
	const callParams = {
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'splitMigrationRep',
		args: [universeId, amount, outcomeIndexes],
	}
	return await executeZoltarMigrationAction(client, 'splitMigrationRep', universeId, amount, outcomeIndexes, callParams)
}
export async function migrateRepToZoltarFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[]) {
	return await executeForkAuctionAction(
		client,
		'migrateRepToZoltar',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateRepToZoltar',
				args: [securityPoolAddress, outcomes.map(outcome => BigInt(getReportingOutcomeValue(outcome)))],
			})),
	)
}
export async function migrateSecurityVault(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(
		client,
		'migrateVault',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateVault',
				args: [securityPoolAddress, BigInt(getReportingOutcomeValue(outcome))],
			})),
	)
}
export async function migrateEscalationDeposits(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	const outcomeIndex = getReportingOutcomeValue(outcome)
	return await executeForkAuctionAction(client, 'migrateEscalationDeposits', securityPoolAddress, universeId, async () => {
		return await writeContractAndWait(client, () => ({
			address: getInfraContractAddresses().securityPoolForker,
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'claimForkedEscalationDeposits',
			args: [securityPoolAddress, vaultAddress, outcomeIndex, toUint8Array(depositIndexes)],
		}))
	})
}
export async function migrateVaultWithUnresolvedEscalation(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	const outcomeIndex = getReportingOutcomeValue(outcome)
	return await executeForkAuctionAction(client, 'migrateUnresolvedEscalation', securityPoolAddress, universeId, async () => {
		let lastHash: Hash | undefined
		for (let batchIndex = 0; batchIndex < UNRESOLVED_ESCALATION_MIGRATION_BATCH_LIMIT; batchIndex += 1) {
			lastHash = await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateVaultWithUnresolvedEscalation',
				args: [securityPoolAddress, vaultAddress, BigInt(outcomeIndex)],
			}))
			if (!(await hasPendingUnresolvedEscalationMigration(client, securityPoolAddress, vaultAddress))) return lastHash
		}
		throw new Error('Unresolved escalation migration still has pending batches after the transaction limit')
	})
}

async function hasPendingUnresolvedEscalationMigration(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address, vaultAddress: Address) {
	const escalationGame = await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		args: [],
	})
	if (sameAddress(escalationGame, zeroAddress)) return false
	const [hasUnexportedLocalDepositRefs, hasUnexportedForkedEscrow] = await Promise.all([
		client.readContract({
			address: escalationGame,
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'hasUnexportedLocalDepositRefs',
			args: [vaultAddress],
		}),
		client.readContract({
			address: escalationGame,
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'hasUnexportedForkedEscrow',
			args: [vaultAddress],
		}),
	])
	return hasUnexportedLocalDepositRefs || hasUnexportedForkedEscrow
}
export async function startTruthAuctionForSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'startTruthAuction',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'startTruthAuction',
				args: [securityPoolAddress],
			})),
	)
}
export async function submitTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) {
	return await executeForkAuctionAction(client, 'submitBid', securityPoolAddress, universeId, async () => {
		const callParams = {
			address: truthAuctionAddress,
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'submitBid',
			args: [tick],
			value: amount,
		}
		return await writeContractAndWait(client, () => callParams)
	})
}

type TruthAuctionSettlementBidIdentifier = {
	tick: bigint
	bidIndex: bigint
}
type TruthAuctionSettlementBidBatch = readonly TruthAuctionSettlementBidIdentifier[]

export async function refundTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint, selectedBids?: readonly TruthAuctionSettlementBidIdentifier[]) {
	return await executeForkAuctionAction(
		client,
		'refundLosingBids',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: truthAuctionAddress,
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'refundLosingBids',
				args: selectedBids === undefined ? [{ tick, bidIndex }] : selectedBids,
			})),
	)
}

export async function settleTruthAuctionBids(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, claimTickIndices: TruthAuctionSettlementBidBatch, refundTickIndices: TruthAuctionSettlementBidBatch) {
	return await executeForkAuctionAction(
		client,
		'claimAuctionProceeds',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'settleAuctionBids',
				args: [securityPoolAddress, vaultAddress, claimTickIndices, refundTickIndices],
			})),
	)
}
export async function finalizeSecurityPoolTruthAuction(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'finalizeTruthAuction',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'finalizeTruthAuction',
				args: [securityPoolAddress],
			})),
	)
}
export async function loadAllSecurityPools(client: ReadClient, options: LoadAllSecurityPoolsOptions = {}): Promise<ListedSecurityPool[]> {
	const accountAddress = options.accountAddress
	const vaultDetailMode = options.vaultDetailMode ?? 'all'
	const selectedSecurityPoolAddress = options.selectedSecurityPoolAddress
	const deploymentCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})
	const deployments: readonly SecurityPoolDeploymentQueryResult[] =
		deploymentCount === 0n
			? []
			: await client.readContract({
					address: getInfraContractAddresses().securityPoolFactory,
					abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
					functionName: 'securityPoolDeploymentsRange',
					args: [0n, deploymentCount],
				})
	const loadedPools = await Promise.all(
		deployments.map(async deployment => {
			const { parent, priceOracleManagerAndOperatorQueuer: managerAddress, questionId, securityMultiplier, securityPool: securityPoolAddress, truthAuction: truthAuctionAddress, universeId } = deployment
			const shouldLoadVaults = vaultDetailMode === 'all' || (selectedSecurityPoolAddress !== undefined && (sameAddress(securityPoolAddress, selectedSecurityPoolAddress) || sameAddress(parent, selectedSecurityPoolAddress)))
			const [[completeSetCollateralAmount, currentRetentionRate, forkData, lastOraclePrice, lastSettlementTimestamp, questionOutcome, systemState, totalRepDeposit, totalSecurityBondAllowance, universeForkTime], marketDetails, vaultSummary] = await Promise.all([
				readRequiredMulticall(client, [
					{
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'completeSetCollateralAmount',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'currentRetentionRate',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
						functionName: 'forkData',
						address: getInfraContractAddresses().securityPoolForker,
						args: [securityPoolAddress],
					},
					{
						abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
						functionName: 'lastPrice',
						address: managerAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
						functionName: 'lastSettlementTimestamp',
						address: managerAddress,
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
						functionName: 'systemState',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'getTotalRepBalance',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'totalSecurityBondAllowance',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: Zoltar_Zoltar.abi,
						functionName: 'getForkTime',
						address: getInfraContractAddresses().zoltar,
						args: [universeId],
					},
				]),
				loadMarketDetails(client, questionId),
				shouldLoadVaults
					? loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
							...(accountAddress === undefined ? {} : { accountAddress }),
							previewLimit: ACTIVE_SECURITY_POOL_VAULT_PREVIEW_LIMIT,
						})
					: Promise.all([getSecurityPoolVaultCount(client, securityPoolAddress)]).then(([vaultCount]) => ({ hasLoadedVaults: vaultCount === 0n, vaultCount, vaults: [] })),
			])
			const forkDataTuple: ForkDataTuple = forkData
			const [, , truthAuctionStartedAt, migratedRep, , , , , forkOwnSecurityPool, , forkOutcomeIndex] = forkDataTuple
			const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parent)
			const poolSystemState = getSecurityPoolSystemState(systemState)
			const hasForkActivity = deriveHasForkActivity({
				forkOutcome,
				migratedRep,
				systemState: poolSystemState,
				truthAuctionStartedAt,
			})
			const { hasLoadedVaults, vaultCount, vaults } = vaultSummary
			return {
				completeSetCollateralAmount,
				currentRetentionRate,
				forkOutcome,
				forkOwnSecurityPool,
				hasForkActivity,
				lastOraclePrice: lastSettlementTimestamp > 0n ? lastOraclePrice : undefined,
				lastOracleSettlementTimestamp: lastSettlementTimestamp,
				managerAddress,
				marketDetails,
				migratedRep,
				parent,
				questionOutcome: getReportingOutcomeKey(questionOutcome),
				questionId: getQuestionIdHex(questionId),
				securityMultiplier,
				securityPoolAddress,
				systemState: poolSystemState,
				totalRepDeposit,
				totalSecurityBondAllowance,
				truthAuctionAddress,
				truthAuctionStartedAt,
				universeHasForked: universeForkTime > 0n,
				universeId,
				hasLoadedVaults,
				vaultCount,
				vaults,
			}
		}),
	)
	return loadedPools.map(pool => ({
		...pool,
		hasForkActivity: pool.hasForkActivity || loadedPools.some(candidate => sameAddress(candidate.parent, pool.securityPoolAddress)),
	}))
}
export async function loadTradingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<TradingDetails> {
	if (accountAddress === undefined) {
		const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
		return {
			maxRedeemableCompleteSets: undefined,
			shareBalances: undefined,
			universeId,
		}
	}
	const [universeId, shareTokenAddress] = await readRequiredMulticall(client, [
		{
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'universeId',
			args: [],
		},
		{
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareToken',
			args: [],
		},
	])
	const shareBalancesResult = await client.readContract({
		address: shareTokenAddress,
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		args: [universeId, accountAddress],
	})
	if (!isBigintTriple(shareBalancesResult)) throw new Error('Unexpected trading share balances response')
	const shareBalances: TradingShareBalances = {
		invalid: shareBalancesResult[0],
		no: shareBalancesResult[2],
		yes: shareBalancesResult[1],
	}
	return {
		maxRedeemableCompleteSets: getMinBigintValue([shareBalances.invalid, shareBalances.yes, shareBalances.no]),
		shareBalances,
		universeId,
	}
}
export async function queueSecurityPoolLiquidation(client: WriteClient, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint) {
	const callParams = {
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'requestPriceIfNeededAndStageOperation',
		args: [LIQUIDATION_OPERATION_TYPE, targetVault, amount, validForSeconds],
		value: await loadBufferedOracleRequestEthCost(client, managerAddress),
	}
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	const queuedOperation = getStagedOracleQueuedResult(receipt, 'liquidation')
	const stagedExecution = getStagedOracleExecutionResult(receipt, 'liquidation')
	return {
		hash,
		...(queuedOperation === undefined ? {} : { queuedOperation }),
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	}
}
function getOracleOperationType(operation: OracleQueueOperation) {
	switch (operation) {
		case 'liquidation':
			return 0
		case 'withdrawRep':
			return 1
		case 'setSecurityBondsAllowance':
			return 2
		default:
			return assertNever(operation)
	}
}
function getShareMigrationOutcomeValue(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0n
		case 'yes':
			return 1n
		case 'no':
			return 2n
		default:
			return assertNever(outcome)
	}
}
function getShareTokenId(universeId: bigint, outcome: ReportingOutcomeKey) {
	const universeMask = (1n << 248n) - 1n
	return ((universeId & universeMask) << 8n) | (getShareMigrationOutcomeValue(outcome) & 255n)
}
export async function queueOracleManagerOperation(client: WriteClient, managerAddress: Address, operation: OracleQueueOperation, targetVault: Address, amount: bigint, validForSeconds: bigint) {
	const callParams = {
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'requestPriceIfNeededAndStageOperation',
		args: [getOracleOperationType(operation), targetVault, amount, validForSeconds],
		value: await loadBufferedOracleRequestEthCost(client, managerAddress),
	}
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	const queuedOperation = getStagedOracleQueuedResult(receipt, operation)
	const stagedExecution = getStagedOracleExecutionResult(receipt, operation)
	return {
		action: 'queueOperation',
		hash,
		...(queuedOperation === undefined ? {} : { queuedOperation }),
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	} satisfies OpenOracleActionResult
}
export async function redeemSharesInSecurityPool(client: WriteClient, securityPoolAddress: Address) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemShares',
		args: [],
	}))
	return {
		action: 'redeemShares',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}
export async function migrateSharesFromUniverse<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: ReadWriteContractClient<TReceipt>, securityPoolAddress: Address, shareOutcome: ReportingOutcomeKey, targetOutcomeIndexes: bigint[]) {
	const sortedTargetOutcomeIndexes = sortBigIntsAscending(targetOutcomeIndexes)
	const [universeId, shareTokenAddress] = await Promise.all([
		readSecurityPoolUniverseId(client, securityPoolAddress),
		client.readContract({
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareToken',
			args: [],
		}),
	])
	const hash = await writeContractAndWait(client, () => ({
		address: shareTokenAddress,
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'migrate',
		args: [getShareTokenId(universeId, shareOutcome), sortedTargetOutcomeIndexes],
	}))
	return {
		action: 'migrateShares',
		hash,
		securityPoolAddress,
		shareOutcome,
		targetOutcomeIndexes: sortedTargetOutcomeIndexes,
		universeId,
	} satisfies TradingActionResult
}
export async function forkUniverseDirectly(client: WriteClient, universeId: bigint, questionId: bigint, securityPoolAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: getInfraContractAddresses().zoltar,
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return {
		action: 'forkUniverse',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}
export async function forkZoltarUniverse(client: WriteClient, universeId: bigint, questionId: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getInfraContractAddresses().zoltar,
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return {
		action: 'forkZoltar',
		hash,
		questionId: getQuestionIdHex(questionId),
		universeId,
	} satisfies ZoltarForkActionResult
}
export async function createCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const callParams = {
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'createCompleteSet',
		args: [],
		value: amount,
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'createCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}
export async function redeemCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemCompleteSet',
		args: [amount],
	}))
	return {
		action: 'redeemCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
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
