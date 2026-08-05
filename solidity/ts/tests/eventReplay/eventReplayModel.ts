import { bytesToHex, concatHex, encodeAbiParameters, getAddress, hexToBytes, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'

export type ReplayLog = {
	chainId: bigint
	blockHash: Hex
	blockNumber: bigint
	transactionHash: Hex
	transactionIndex: number
	logIndex: number
	emitter: Address
	eventName: string
	args: Readonly<Record<string, unknown>>
}

export type PoolAccountingReplay = {
	reason: bigint
	vault: Address
	settlementCollateralAttoEth: bigint
	totalCoverageCommitmentAttoEth: bigint
	feeEligibleCoverageCommitmentAttoEth: bigint
	totalClaimableVaultFeesAttoEth: bigint
	unallocatedAccruedFeesAttoEth: bigint
	feeIndex: bigint
	feeIndexRemainder: bigint
	totalFeesOwedRemainder: bigint
	uncheckpointedFeeEligibleCoverageCommitmentAttoEth: bigint
	lastUpdatedFeeAccumulator: bigint
	currentRetentionRate: bigint
}

export type VaultAccountingReplay = {
	repBackingUnits: bigint
	coverageCommitmentAttoEth: bigint
	claimableFeesAttoEth: bigint
	feeIndex: bigint
	vaultFeeRemainder: bigint
	resultingTotalRepBackingUnits: bigint
	resultingFeeEligibleCoverageCommitmentAttoEth: bigint
}

export type PoolStateReplay = {
	shareTokenSupplyAttoShares?: bigint
	totalRepBackingUnits?: bigint
	systemState?: bigint
	awaitingForkContinuation?: boolean
	escalationGame?: Address
	forkModeActive?: boolean
	repTransferredAtFork?: bigint
	currentRetentionRate?: bigint
}

export type ForkReplay = {
	migrationProxy: Address
	ownFork: boolean
	unresolvedEscalation: boolean
	settlementCollateralAtForkAttoEth: bigint
	poolRepAtForkAttoRep: bigint
	auctionableRepAtForkAttoRep: bigint
	escalationSourceRepAtForkAttoRep: bigint
	escalationChildRepAtForkAttoRep: bigint
	escalationStartBondAtForkAttoRep: bigint
	escalationNonDecisionThresholdAtForkAttoRep: bigint
	escalationElapsedAtFork: bigint
	escalationSnapshotId: Hex
}

export type VaultMigrationReplay = {
	childPool: Address
	outcomeIndex: bigint
	migratedRepDeltaAttoRep: bigint
	resultingChildMigratedRepTotalAttoRep: bigint
	resultingParentRepBackingUnits: bigint
	resultingParentCoverageCommitmentAttoEth: bigint
	resultingChildRepBackingUnits: bigint
	resultingChildCoverageCommitmentAttoEth: bigint
	resultingParentTotalRepBackingUnits: bigint
	resultingChildTotalRepBackingUnits: bigint
	resultingParentTotalCoverageCommitmentAttoEth: bigint
	resultingChildTotalCoverageCommitmentAttoEth: bigint
	settlementCollateralTransferredAttoEth: bigint
	cumulativeSettlementCollateralTransferredAttoEth: bigint
}

export type AuctionBidReplay = {
	bidder: Address
	tick: bigint
	bidIndex: bigint
	bidAmountAttoEth: bigint
	cumulativeBidAtTickAttoEth: bigint
	bidUsedAttoEth?: bigint
	repFilledAttoRep?: bigint
	refundAttoEth?: bigint
	status?: bigint
}

export type PoolDeploymentReplay = {
	factory: Address
	parent: Address
	universeId: bigint
	questionId: bigint
	truthAuction: Address
	coordinator: Address
	shareToken: Address
	statoblastSecurityMultiplierBps: bigint
	initialReportPriorityFeeAttoEthPerGas: bigint
	currentRetentionRate: bigint
	settlementCollateralAttoEth: bigint
}

export type AuctionLifecycleReplay = {
	startTimestamp?: bigint
	endTimestamp?: bigint
	clearingTick?: bigint
	grossAcceptedAttoEth?: bigint
	repSoldAttoRep?: bigint
	funded?: boolean
}

export type CoordinatorOperationReplay = {
	operation: bigint
	initiatorVault: Address
	targetVault: Address
	amount: bigint
	queuedAt: bigint
	validForSeconds: bigint
	snapshotTargetBackingUnits: bigint
	snapshotTargetCoverageCommitmentAttoEth: bigint
	snapshotTargetDisputeStakedRepAttoRep: bigint
	snapshotTotalPoolHeldRepAttoRep: bigint
	snapshotDenominator: bigint
	isPendingSlot: boolean
	status: 'Queued' | 'Succeeded' | 'Failed' | 'Recovered'
	errorMessage?: string
}

export type DisputeStakedRepDepositReplay = {
	nodeId: bigint
	depositor: Address
	outcome: bigint
	repAmountAttoRep: bigint
	parentDepositIndex: bigint
	cumulativeRepAmountAttoRep: bigint
	carryLeafIndex: bigint
	consumed: boolean
	consumptionReason?: bigint
}

export type QuestionReplay = {
	createdTimestamp: bigint
	title: string
	description: string
	startTime: bigint
	endTime: bigint
	numTicks: bigint
	displayValueMin: bigint
	displayValueMax: bigint
	answerUnit: string
	outcomeOptions: readonly string[]
}

export type UniverseReplay = {
	forkTime: bigint
	forkQuestionId: bigint
	forkingOutcomeIndex: bigint
	reputationToken: Address
	parentUniverseId: string
	universeTheoreticalSupplyAttoRep: bigint
}

export type UniverseForkReplay = {
	forker: Address
	questionId: bigint
	forkTime: bigint
	forkThresholdAttoRep: bigint
	migrationRepBalanceAttoRep: bigint
	universeTheoreticalSupplyAttoRep: bigint
}

export type EscalationLifecycleReplay = {
	activationTime?: bigint
	startBondAttoRep?: bigint
	nonDecisionThresholdAttoRep?: bigint
	nonDecisionState?: 'none' | 'local' | 'inheritedThresholdTie'
	forkCarrySourceGame?: Address
	inheritedThresholdTieSourceGame?: Address
	forkContinuation?: boolean
	elapsedAtFork?: bigint
	resumedAt?: bigint
	nonDecisionTimestamp?: bigint
}

export type EscalationConsumptionReplay = {
	parentDepositIndex: bigint
	sourceNodeId: bigint
	depositor: Address
	outcome: bigint
	repAmountAttoRep: bigint
	reason: bigint
	resultingUnresolvedTotalAttoRep: bigint
	resultingNullifierRoot: Hex
	resultingCarryRoot: Hex
}

export type EscalationClaimReplay = {
	depositor: Address
	outcome: bigint
	parentDepositIndex: bigint
	originalDepositAmountAttoRep: bigint
	amountToWithdrawAttoRep: bigint
	burnAmountAttoRep: bigint
	transferredRep: boolean
}

export type ForkedEscrowReplay = {
	sourcePrincipalAttoRep: bigint
	sourcePrincipalClaimedAttoRep: bigint
	childRepAttoRep: bigint
	childRepClaimedAttoRep: bigint
}

export type VaultUnresolvedExportReplay = {
	repReceiver: Address
	principalByOutcomeAttoRep: BigIntTriple
	principalToTransferAttoRep: bigint
	transferredRep: boolean
}

export type ForkedEscrowExportReplay = {
	repReceiver: Address
	sourcePrincipalByOutcomeAttoRep: BigIntTriple
	childRepByOutcomeAttoRep: BigIntTriple
	totalChildRepToTransferAttoRep: bigint
	transferredRep: boolean
}

export type CoordinatorReportReplay = {
	status: 'Requested' | 'Reported' | 'Rejected' | 'Recovered'
	price?: bigint
	settlementTimestamp?: bigint
	reason?: string
}

export type CoordinatorReplay = {
	securityPool?: Address
	checkpointReason?: bigint
	checkpointReportId?: bigint
	checkpointOperationId?: bigint
	lastPrice: bigint
	lastSettlementTimestamp: bigint
	pendingReportId: bigint
	pendingReportSponsor: Address
	pendingOperationSlotId: bigint
	pendingReportMaxSettlementBaseFee: bigint
	stagedOperationCounter: bigint
	activeStagedOperationCount: bigint
	pendingSettlementOperationCount: bigint
	reports: Map<bigint, CoordinatorReportReplay>
}

type BigIntTriple = [bigint, bigint, bigint]
type HexTriple = [Hex, Hex, Hex]
type HexPeaksTriple = [Hex[], Hex[], Hex[]]
type EscalationCarrySnapshotReplay = {
	sourceGame: Address
	carryRoots: HexTriple
	carryPeaks: HexPeaksTriple
	carryLeaves: HexPeaksTriple
	leafCounts: BigIntTriple
}

export type EscalationClaimBundleReplay = {
	claimRepUnits: bigint
	depositor: Address
}

export type EscalationHaircutReplay = {
	repBefore: bigint
	repRemaining: bigint
}

export type ReplayState = {
	identities: Set<string>
	questions: Map<bigint, QuestionReplay>
	universes: Map<string, UniverseReplay>
	universeForks: Map<string, UniverseForkReplay>
	universeChildren: Map<string, Map<bigint, string>>
	universeRepTokens: Map<string, Address>
	universeTheoreticalSuppliesAttoRep: Map<string, bigint>
	repBalances: Map<string, Map<Address, bigint>>
	repSupply: Map<string, bigint>
	migrationRepBalancesAttoRep: Map<string, Map<Address, bigint>>
	childMigrationRepAmounts: Map<string, Map<Address, Map<string, bigint>>>
	poolDeployments: Map<Address, PoolDeploymentReplay>
	pools: Map<Address, PoolAccountingReplay>
	poolStates: Map<Address, PoolStateReplay>
	completeSetSupplies: Map<Address, bigint>
	vaults: Map<Address, Map<Address, VaultAccountingReplay>>
	forks: Map<Address, ForkReplay>
	vaultMigrations: Map<Address, Map<Address, Map<Address, VaultMigrationReplay>>>
	poolChildren: Map<Address, Map<bigint, Address>>
	forkEscalationSources: Map<Address, Address>
	escalationCarrySnapshots: Map<Hex, EscalationCarrySnapshotReplay>
	escalationSnapshots: Map<Address, Hex>
	escalationCarryRoots: Map<Address, HexTriple>
	escalationCarryPeaks: Map<Address, HexPeaksTriple>
	escalationCarryLeaves: Map<Address, HexPeaksTriple>
	escalationNullifierRoots: Map<Address, HexTriple>
	escalationLeafCounts: Map<Address, BigIntTriple>
	escalationUnresolvedTotals: Map<Address, BigIntTriple>
	escalationResolutionBalances: Map<Address, BigIntTriple>
	escalationDeposits: Map<Address, Map<string, DisputeStakedRepDepositReplay>>
	escalationLifecycles: Map<Address, EscalationLifecycleReplay>
	escalationConsumptions: Map<Address, Map<string, EscalationConsumptionReplay>>
	escalationClaims: Map<Address, Map<string, EscalationClaimReplay>>
	escalationClaimBundles: Map<Address, Map<Address, EscalationClaimBundleReplay>>
	escalationHaircuts: Map<Address, EscalationHaircutReplay>
	escalationVaultEscrowedRep: Map<Address, Map<Address, bigint>>
	escalationLocalUnresolvedByVault: Map<Address, Map<Address, BigIntTriple>>
	escalationForkedEscrow: Map<Address, Map<string, ForkedEscrowReplay>>
	escalationVaultExports: Map<Address, Map<Address, VaultUnresolvedExportReplay>>
	escalationForkedExports: Map<Address, Map<Address, ForkedEscrowExportReplay>>
	escalationResidualRepSwept: Map<Address, bigint>
	escalationTotalEscrowedRep: Map<Address, bigint>
	auctionBids: Map<Address, Map<string, AuctionBidReplay>>
	auctions: Map<Address, AuctionLifecycleReplay>
	authorizations: Map<Address, Map<Address, boolean>>
	shareTokenBalances: Map<Address, Map<bigint, Map<Address, bigint>>>
	shareTokenSupplies: Map<Address, Map<bigint, bigint>>
	coordinatorOperations: Map<Address, Map<bigint, CoordinatorOperationReplay>>
	coordinators: Map<Address, CoordinatorReplay>
}

export function createReplayState(): ReplayState {
	return {
		identities: new Set(),
		questions: new Map(),
		universes: new Map(),
		universeForks: new Map(),
		universeChildren: new Map(),
		universeRepTokens: new Map(),
		universeTheoreticalSuppliesAttoRep: new Map(),
		repBalances: new Map(),
		repSupply: new Map(),
		migrationRepBalancesAttoRep: new Map(),
		childMigrationRepAmounts: new Map(),
		poolDeployments: new Map(),
		pools: new Map(),
		poolStates: new Map(),
		completeSetSupplies: new Map(),
		vaults: new Map(),
		forks: new Map(),
		vaultMigrations: new Map(),
		poolChildren: new Map(),
		forkEscalationSources: new Map(),
		escalationCarrySnapshots: new Map(),
		escalationSnapshots: new Map(),
		escalationCarryRoots: new Map(),
		escalationCarryPeaks: new Map(),
		escalationCarryLeaves: new Map(),
		escalationNullifierRoots: new Map(),
		escalationLeafCounts: new Map(),
		escalationUnresolvedTotals: new Map(),
		escalationResolutionBalances: new Map(),
		escalationDeposits: new Map(),
		escalationLifecycles: new Map(),
		escalationConsumptions: new Map(),
		escalationClaims: new Map(),
		escalationClaimBundles: new Map(),
		escalationHaircuts: new Map(),
		escalationVaultEscrowedRep: new Map(),
		escalationLocalUnresolvedByVault: new Map(),
		escalationForkedEscrow: new Map(),
		escalationVaultExports: new Map(),
		escalationForkedExports: new Map(),
		escalationResidualRepSwept: new Map(),
		escalationTotalEscrowedRep: new Map(),
		auctionBids: new Map(),
		auctions: new Map(),
		authorizations: new Map(),
		shareTokenBalances: new Map(),
		shareTokenSupplies: new Map(),
		coordinatorOperations: new Map(),
		coordinators: new Map(),
	}
}

export function getCanonicalEventIdentity(log: Pick<ReplayLog, 'chainId' | 'blockHash' | 'transactionHash' | 'logIndex'>) {
	return `${log.chainId.toString()}:${log.blockHash.toLowerCase()}:${log.transactionHash.toLowerCase()}:${log.logIndex.toString()}`
}

function requireBigInt(args: Readonly<Record<string, unknown>>, field: string) {
	const value = args[field]
	if (typeof value !== 'bigint') throw new Error(`${field} must be a bigint`)
	return value
}

function requireBoolean(args: Readonly<Record<string, unknown>>, field: string) {
	const value = args[field]
	if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
	return value
}

function requireString(args: Readonly<Record<string, unknown>>, field: string) {
	const value = args[field]
	if (typeof value !== 'string') throw new Error(`${field} must be a string`)
	return value
}

function requireRecord(args: Readonly<Record<string, unknown>>, field: string): Readonly<Record<string, unknown>> {
	const value = args[field]
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
	return Object.fromEntries(Object.entries(value))
}

function requireStringArray(args: Readonly<Record<string, unknown>>, field: string) {
	const value = args[field]
	if (!Array.isArray(value)) throw new Error(`${field} must contain strings`)
	const strings: string[] = []
	for (const entry of value) {
		if (typeof entry !== 'string') throw new Error(`${field} must contain strings`)
		strings.push(entry)
	}
	return strings
}

function requireBigIntArray(args: Readonly<Record<string, unknown>>, field: string) {
	const value = args[field]
	if (!Array.isArray(value)) throw new Error(`${field} must contain bigints`)
	const bigints: bigint[] = []
	for (const entry of value) {
		if (typeof entry !== 'bigint') throw new Error(`${field} must contain bigints`)
		bigints.push(entry)
	}
	return bigints
}

function requireAddress(args: Readonly<Record<string, unknown>>, field: string) {
	const value = requireString(args, field)
	return getAddress(value)
}

function requireHex(args: Readonly<Record<string, unknown>>, field: string) {
	const value = requireString(args, field)
	if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`${field} must be hex`)
	return bytesToHex(hexToBytes(value))
}

function requireBigIntTriple(args: Readonly<Record<string, unknown>>, field: string): BigIntTriple {
	const value = args[field]
	if (!Array.isArray(value) || value.length !== 3 || value.some(entry => typeof entry !== 'bigint')) throw new Error(`${field} must contain three bigints`)
	const first = value[0]
	const second = value[1]
	const third = value[2]
	if (typeof first !== 'bigint' || typeof second !== 'bigint' || typeof third !== 'bigint') throw new Error(`${field} must contain three bigints`)
	return [first, second, third]
}

function requireHexTriple(args: Readonly<Record<string, unknown>>, field: string): HexTriple {
	const value = args[field]
	if (!Array.isArray(value) || value.length !== 3) throw new Error(`${field} must contain three roots`)
	const parseRoot = (entry: unknown) => {
		if (typeof entry !== 'string' || !/^0x[0-9a-fA-F]+$/.test(entry)) {
			throw new Error(`${field} must contain three hex roots`)
		}
		return bytesToHex(hexToBytes(entry))
	}
	return [parseRoot(value[0]), parseRoot(value[1]), parseRoot(value[2])]
}

function getOrCreateNestedMap<K, V>(outer: Map<Address, Map<K, V>>, emitter: Address) {
	let inner = outer.get(emitter)
	if (inner === undefined) {
		inner = new Map()
		outer.set(emitter, inner)
	}
	return inner
}

const ZERO_HASH = bytesToHex(new Uint8Array(32))
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

function hashParent(left: Hex, right: Hex) {
	return keccak256(concatHex([left, right]))
}

function getEmptyNullifierRoot() {
	let root = ZERO_HASH
	for (let depth = 0; depth < 64; depth += 1) root = hashParent(root, root)
	return root
}

function hashCarryLeaf(deposit: DisputeStakedRepDepositReplay) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [deposit.depositor, deposit.outcome, deposit.repAmountAttoRep, deposit.parentDepositIndex, deposit.cumulativeRepAmountAttoRep, deposit.nodeId]))
}

function bagCarryPeaks(peaks: readonly Hex[], leafCount: bigint) {
	if (leafCount === 0n) return ZERO_HASH
	let root: Hex | undefined
	for (let height = peaks.length - 1; height >= 0; height -= 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const peak = peaks[height]
		if (peak === undefined) throw new Error(`carry peak ${height.toString()} is missing`)
		root = root === undefined ? peak : hashParent(peak, root)
	}
	if (root === undefined) throw new Error('carry root cannot be bagged')
	return root
}

function appendCarryHash(peaks: Hex[], leafCount: bigint, leafHash: Hex) {
	let carryHash = leafHash
	let peakHeight = 0
	while (((leafCount >> BigInt(peakHeight)) & 1n) === 1n) {
		const priorPeak = peaks[peakHeight]
		if (priorPeak === undefined) throw new Error(`carry peak ${peakHeight.toString()} is missing`)
		carryHash = hashParent(priorPeak, carryHash)
		peaks[peakHeight] = ZERO_HASH
		peakHeight += 1
	}
	peaks[peakHeight] = carryHash
}

function rebuildCarryPeaks(leaves: readonly Hex[]) {
	const peaks: Hex[] = []
	for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
		const leaf = leaves[leafIndex]
		if (leaf === undefined) throw new Error(`carry leaf ${leafIndex.toString()} is missing`)
		appendCarryHash(peaks, BigInt(leafIndex), leaf)
	}
	return peaks
}

function cloneHexTriple(values: HexTriple): HexTriple {
	return [values[0], values[1], values[2]]
}

function cloneBigIntTriple(values: BigIntTriple): BigIntTriple {
	return [values[0], values[1], values[2]]
}

function cloneHexPeaksTriple(values: HexPeaksTriple): HexPeaksTriple {
	return [values[0].slice(), values[1].slice(), values[2].slice()]
}

function appendCarryLeaf(state: ReplayState, emitter: Address, deposit: DisputeStakedRepDepositReplay) {
	const outcomeIndex = Number(deposit.outcome)
	const counts = state.escalationLeafCounts.get(emitter) ?? [0n, 0n, 0n]
	const peaksByOutcome = state.escalationCarryPeaks.get(emitter) ?? [[], [], []]
	const peaks = peaksByOutcome[outcomeIndex]
	if (peaks === undefined) throw new Error('carry outcome is out of range')
	const leafCount = counts[outcomeIndex]
	if (leafCount === undefined) throw new Error('carry leaf count is missing')
	const leavesByOutcome = state.escalationCarryLeaves.get(emitter) ?? [[], [], []]
	const leaves = leavesByOutcome[outcomeIndex]
	if (leaves === undefined) throw new Error('carry outcome leaves are out of range')
	if (BigInt(leaves.length) !== leafCount) throw new Error('carry leaf history does not match the replayed leaf count')
	const leafHash = hashCarryLeaf(deposit)
	leaves.push(leafHash)
	appendCarryHash(peaks, leafCount, leafHash)
	counts[outcomeIndex] = leafCount + 1n
	state.escalationLeafCounts.set(emitter, counts)
	state.escalationCarryPeaks.set(emitter, peaksByOutcome)
	state.escalationCarryLeaves.set(emitter, leavesByOutcome)
	const roots = state.escalationCarryRoots.get(emitter) ?? [ZERO_HASH, ZERO_HASH, ZERO_HASH]
	roots[outcomeIndex] = bagCarryPeaks(peaks, counts[outcomeIndex])
	state.escalationCarryRoots.set(emitter, roots)
}

function setNestedBalance(balances: Map<string, Map<Address, bigint>>, key: string, account: Address, resultingBalance: bigint) {
	let accountBalances = balances.get(key)
	if (accountBalances === undefined) {
		accountBalances = new Map()
		balances.set(key, accountBalances)
	}
	if (resultingBalance < 0n) throw new Error('replayed balance cannot become negative')
	accountBalances.set(account, resultingBalance)
}

export function reduceZoltarEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName === 'QuestionCreated') {
		const questionData = requireRecord(log.args, 'questionData')
		state.questions.set(requireBigInt(log.args, 'questionId'), {
			createdTimestamp: requireBigInt(log.args, 'createdTimestamp'),
			title: requireString(questionData, 'title'),
			description: requireString(questionData, 'description'),
			startTime: requireBigInt(questionData, 'startTime'),
			endTime: requireBigInt(questionData, 'endTime'),
			numTicks: requireBigInt(questionData, 'numTicks'),
			displayValueMin: requireBigInt(questionData, 'displayValueMin'),
			displayValueMax: requireBigInt(questionData, 'displayValueMax'),
			answerUnit: requireString(questionData, 'answerUnit'),
			outcomeOptions: requireStringArray(log.args, 'outcomeOptions'),
		})
		return
	}
	if (log.eventName === 'UniverseInitialized') {
		const universeId = requireBigInt(log.args, 'universeId').toString()
		const reputationToken = requireAddress(log.args, 'reputationToken')
		const universeTheoreticalSupplyAttoRep = requireBigInt(log.args, 'universeTheoreticalSupplyAttoRep')
		state.universes.set(universeId, {
			forkTime: requireBigInt(log.args, 'forkTime'),
			forkQuestionId: requireBigInt(log.args, 'forkQuestionId'),
			forkingOutcomeIndex: requireBigInt(log.args, 'forkingOutcomeIndex'),
			reputationToken,
			parentUniverseId: requireBigInt(log.args, 'parentUniverseId').toString(),
			universeTheoreticalSupplyAttoRep,
		})
		state.universeRepTokens.set(universeId, reputationToken)
		state.universeTheoreticalSuppliesAttoRep.set(universeId, universeTheoreticalSupplyAttoRep)
		return
	}
	if (log.eventName === 'UniverseForked') {
		const universeId = requireBigInt(log.args, 'universeId').toString()
		const forkTime = requireBigInt(log.args, 'forkTime')
		const questionId = requireBigInt(log.args, 'questionId')
		const universeTheoreticalSupplyAttoRep = requireBigInt(log.args, 'universeTheoreticalSupplyAttoRep')
		const forker = requireAddress(log.args, 'forker')
		const migrationRepBalanceAttoRep = requireBigInt(log.args, 'migrationRepBalanceAttoRep')
		state.universeForks.set(universeId, {
			forker,
			questionId,
			forkTime,
			forkThresholdAttoRep: requireBigInt(log.args, 'forkThresholdAttoRep'),
			migrationRepBalanceAttoRep,
			universeTheoreticalSupplyAttoRep,
		})
		const universe = state.universes.get(universeId)
		if (universe !== undefined) {
			universe.forkTime = forkTime
			universe.forkQuestionId = questionId
			universe.universeTheoreticalSupplyAttoRep = universeTheoreticalSupplyAttoRep
		}
		setNestedBalance(state.migrationRepBalancesAttoRep, universeId, forker, migrationRepBalanceAttoRep)
		state.universeTheoreticalSuppliesAttoRep.set(universeId, universeTheoreticalSupplyAttoRep)
		return
	}
	if (log.eventName === 'DeployChild') {
		const parentUniverseId = requireBigInt(log.args, 'universeId').toString()
		const outcomeIndex = requireBigInt(log.args, 'outcomeIndex')
		const childUniverseId = requireBigInt(log.args, 'childUniverseId').toString()
		let children = state.universeChildren.get(parentUniverseId)
		if (children === undefined) {
			children = new Map()
			state.universeChildren.set(parentUniverseId, children)
		}
		children.set(outcomeIndex, childUniverseId)
		const childReputationToken = requireAddress(log.args, 'childReputationToken')
		const childUniverseTheoreticalSupplyAttoRep = requireBigInt(log.args, 'childUniverseTheoreticalSupplyAttoRep')
		const parentUniverse = state.universes.get(parentUniverseId)
		state.universes.set(childUniverseId, {
			forkTime: 0n,
			forkQuestionId: parentUniverse?.forkQuestionId ?? state.universeForks.get(parentUniverseId)?.questionId ?? 0n,
			forkingOutcomeIndex: outcomeIndex,
			reputationToken: childReputationToken,
			parentUniverseId,
			universeTheoreticalSupplyAttoRep: childUniverseTheoreticalSupplyAttoRep,
		})
		state.universeRepTokens.set(childUniverseId, childReputationToken)
		state.universeTheoreticalSuppliesAttoRep.set(childUniverseId, childUniverseTheoreticalSupplyAttoRep)
		return
	}
	if (log.eventName === 'MigrationRepAdded') {
		const universeId = requireBigInt(log.args, 'universeId').toString()
		setNestedBalance(state.migrationRepBalancesAttoRep, universeId, requireAddress(log.args, 'migrator'), requireBigInt(log.args, 'migrationRepBalanceAttoRep'))
		const universeTheoreticalSupplyAttoRep = requireBigInt(log.args, 'universeTheoreticalSupplyAttoRep')
		state.universeTheoreticalSuppliesAttoRep.set(universeId, universeTheoreticalSupplyAttoRep)
		const universe = state.universes.get(universeId)
		if (universe !== undefined) universe.universeTheoreticalSupplyAttoRep = universeTheoreticalSupplyAttoRep
		return
	}
	if (log.eventName === 'MigrationRepSplit') {
		const universeId = requireBigInt(log.args, 'universeId').toString()
		const migrator = requireAddress(log.args, 'migrator')
		let byMigrator = state.childMigrationRepAmounts.get(universeId)
		if (byMigrator === undefined) {
			byMigrator = new Map()
			state.childMigrationRepAmounts.set(universeId, byMigrator)
		}
		let byChild = byMigrator.get(migrator)
		if (byChild === undefined) {
			byChild = new Map()
			byMigrator.set(migrator, byChild)
		}
		byChild.set(requireBigInt(log.args, 'childUniverseId').toString(), requireBigInt(log.args, 'childMigrationRepAmountAttoRep'))
	}
}

export function reduceReputationTokenEvent(state: ReplayState, log: ReplayLog, recognizedRepTokens: ReadonlySet<Address>) {
	if (log.eventName !== 'Transfer') return
	const tokenAddress = getAddress(log.emitter)
	if (!recognizedRepTokens.has(tokenAddress)) return
	const token = tokenAddress.toLowerCase()
	const from = requireAddress(log.args, 'from')
	const to = requireAddress(log.args, 'to')
	const amountAttoRep = requireBigInt(log.args, 'value')
	const zero = '0x0000000000000000000000000000000000000000'
	if (from !== zero) {
		const currentFromBalance = state.repBalances.get(token)?.get(from) ?? 0n
		setNestedBalance(state.repBalances, token, from, currentFromBalance - amountAttoRep)
	}
	if (to !== zero) {
		const currentToBalance = state.repBalances.get(token)?.get(to) ?? 0n
		setNestedBalance(state.repBalances, token, to, currentToBalance + amountAttoRep)
	}
	let supplyDelta = 0n
	if (from === zero) supplyDelta = amountAttoRep
	if (to === zero) supplyDelta = -amountAttoRep
	const resultingSupply = (state.repSupply.get(token) ?? 0n) + supplyDelta
	if (resultingSupply < 0n) throw new Error('REP supply cannot become negative')
	state.repSupply.set(token, resultingSupply)
}

export function reducePoolFactoryEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName !== 'DeploySecurityPool') return
	const securityPool = requireAddress(log.args, 'securityPool')
	const parent = requireAddress(log.args, 'parent')
	const currentRetentionRate = requireBigInt(log.args, 'currentRetentionRate')
	state.poolDeployments.set(securityPool, {
		factory: log.emitter,
		parent,
		universeId: requireBigInt(log.args, 'universeId'),
		questionId: requireBigInt(log.args, 'questionId'),
		truthAuction: requireAddress(log.args, 'truthAuction'),
		coordinator: requireAddress(log.args, 'priceOracleManagerAndOperatorQueuer'),
		shareToken: requireAddress(log.args, 'shareToken'),
		statoblastSecurityMultiplierBps: requireBigInt(log.args, 'statoblastSecurityMultiplierBps'),
		initialReportPriorityFeeAttoEthPerGas: requireBigInt(log.args, 'initialReportPriorityFeeAttoEthPerGas'),
		currentRetentionRate,
		settlementCollateralAttoEth: requireBigInt(log.args, 'settlementCollateralAttoEth'),
	})
	const poolState = state.poolStates.get(securityPool) ?? {}
	poolState.systemState = parent === ZERO_ADDRESS ? 0n : 2n
	poolState.currentRetentionRate = currentRetentionRate
	state.poolStates.set(securityPool, poolState)
}

function applyShareTokenTransfer(state: ReplayState, token: Address, from: Address, to: Address, id: bigint, value: bigint) {
	let balancesById = state.shareTokenBalances.get(token)
	if (balancesById === undefined) {
		balancesById = new Map()
		state.shareTokenBalances.set(token, balancesById)
	}
	let balances = balancesById.get(id)
	if (balances === undefined) {
		balances = new Map()
		balancesById.set(id, balances)
	}
	if (from !== ZERO_ADDRESS) {
		const resultingFromBalance = (balances.get(from) ?? 0n) - value
		if (resultingFromBalance < 0n) throw new Error('share-token balance cannot become negative')
		balances.set(from, resultingFromBalance)
	}
	if (to !== ZERO_ADDRESS) balances.set(to, (balances.get(to) ?? 0n) + value)

	let supplies = state.shareTokenSupplies.get(token)
	if (supplies === undefined) {
		supplies = new Map()
		state.shareTokenSupplies.set(token, supplies)
	}
	let supplyDelta = 0n
	if (from === ZERO_ADDRESS) supplyDelta += value
	if (to === ZERO_ADDRESS) supplyDelta -= value
	const resultingSupply = (supplies.get(id) ?? 0n) + supplyDelta
	if (resultingSupply < 0n) throw new Error('share-token supply cannot become negative')
	supplies.set(id, resultingSupply)
}

export function reduceShareTokenEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName === 'AuthorizationUpdated') {
		let authorizations = state.authorizations.get(log.emitter)
		if (authorizations === undefined) {
			authorizations = new Map()
			state.authorizations.set(log.emitter, authorizations)
		}
		authorizations.set(requireAddress(log.args, 'account'), requireBoolean(log.args, 'authorized'))
		return
	}
	if (log.eventName === 'TransferSingle') {
		applyShareTokenTransfer(state, log.emitter, requireAddress(log.args, 'from'), requireAddress(log.args, 'to'), requireBigInt(log.args, 'id'), requireBigInt(log.args, 'value'))
		return
	}
	if (log.eventName !== 'TransferBatch') return
	const ids = requireBigIntArray(log.args, 'ids')
	const values = requireBigIntArray(log.args, 'values')
	if (ids.length !== values.length) throw new Error('TransferBatch ids and values length mismatch')
	const from = requireAddress(log.args, 'from')
	const to = requireAddress(log.args, 'to')
	for (let index = 0; index < ids.length; index += 1) {
		const id = ids[index]
		const value = values[index]
		if (id === undefined || value === undefined) throw new Error('TransferBatch item is missing')
		applyShareTokenTransfer(state, log.emitter, from, to, id, value)
	}
}

export function reduceSecurityPoolEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName === 'PoolAccountingCheckpoint') {
		state.pools.set(log.emitter, {
			reason: requireBigInt(log.args, 'reason'),
			vault: requireAddress(log.args, 'vault'),
			settlementCollateralAttoEth: requireBigInt(log.args, 'settlementCollateralAttoEth'),
			totalCoverageCommitmentAttoEth: requireBigInt(log.args, 'totalCoverageCommitmentAttoEth'),
			feeEligibleCoverageCommitmentAttoEth: requireBigInt(log.args, 'feeEligibleCoverageCommitmentAttoEth'),
			totalClaimableVaultFeesAttoEth: requireBigInt(log.args, 'totalClaimableVaultFeesAttoEth'),
			unallocatedAccruedFeesAttoEth: requireBigInt(log.args, 'unallocatedAccruedFeesAttoEth'),
			feeIndex: requireBigInt(log.args, 'feeIndex'),
			feeIndexRemainder: requireBigInt(log.args, 'feeIndexRemainder'),
			totalFeesOwedRemainder: requireBigInt(log.args, 'totalFeesOwedRemainder'),
			uncheckpointedFeeEligibleCoverageCommitmentAttoEth: requireBigInt(log.args, 'uncheckpointedFeeEligibleCoverageCommitmentAttoEth'),
			lastUpdatedFeeAccumulator: requireBigInt(log.args, 'lastUpdatedFeeAccumulator'),
			currentRetentionRate: requireBigInt(log.args, 'currentRetentionRate'),
		})
		return
	}
	if (log.eventName === 'CompleteSetCreated' || log.eventName === 'CompleteSetRedeemed' || log.eventName === 'SharesRedeemed') {
		const resultingShareTokenSupplyAttoShares = requireBigInt(log.args, 'resultingShareTokenSupplyAttoShares')
		state.completeSetSupplies.set(log.emitter, resultingShareTokenSupplyAttoShares)
		const poolState = state.poolStates.get(log.emitter) ?? {}
		poolState.shareTokenSupplyAttoShares = resultingShareTokenSupplyAttoShares
		state.poolStates.set(log.emitter, poolState)
		return
	}
	const poolState = state.poolStates.get(log.emitter) ?? {}
	if (log.eventName === 'ShareTokenSupplySet') {
		const shareTokenSupplyAttoShares = requireBigInt(log.args, 'shareTokenSupplyAttoShares')
		poolState.shareTokenSupplyAttoShares = shareTokenSupplyAttoShares
		state.poolStates.set(log.emitter, poolState)
		state.completeSetSupplies.set(log.emitter, shareTokenSupplyAttoShares)
		return
	}
	if (log.eventName === 'TotalRepBackingUnitsSet') {
		poolState.totalRepBackingUnits = requireBigInt(log.args, 'totalRepBackingUnits')
		state.poolStates.set(log.emitter, poolState)
		return
	}
	if (log.eventName === 'SystemStateSet') {
		poolState.systemState = requireBigInt(log.args, 'systemState')
		state.poolStates.set(log.emitter, poolState)
		return
	}
	if (log.eventName === 'AwaitingForkContinuationSet') {
		poolState.awaitingForkContinuation = requireBoolean(log.args, 'awaitingForkContinuation')
		state.poolStates.set(log.emitter, poolState)
		return
	}
	if (log.eventName === 'EscalationGameSet') {
		poolState.escalationGame = requireAddress(log.args, 'escalationGame')
		state.poolStates.set(log.emitter, poolState)
		return
	}
	if (log.eventName === 'PoolForkModeActivated') {
		poolState.forkModeActive = true
		poolState.repTransferredAtFork = requireBigInt(log.args, 'repTransferredAttoRep')
		poolState.currentRetentionRate = requireBigInt(log.args, 'currentRetentionRate')
		poolState.systemState = requireBigInt(log.args, 'systemState')
		state.poolStates.set(log.emitter, poolState)
		return
	}
	if (log.eventName === 'VaultAccountingCheckpoint') {
		let vaults = state.vaults.get(log.emitter)
		if (vaults === undefined) {
			vaults = new Map()
			state.vaults.set(log.emitter, vaults)
		}
		vaults.set(requireAddress(log.args, 'vault'), {
			repBackingUnits: requireBigInt(log.args, 'repBackingUnits'),
			coverageCommitmentAttoEth: requireBigInt(log.args, 'coverageCommitmentAttoEth'),
			claimableFeesAttoEth: requireBigInt(log.args, 'claimableFeesAttoEth'),
			feeIndex: requireBigInt(log.args, 'feeIndex'),
			vaultFeeRemainder: requireBigInt(log.args, 'vaultFeeRemainder'),
			resultingTotalRepBackingUnits: requireBigInt(log.args, 'resultingTotalRepBackingUnits'),
			resultingFeeEligibleCoverageCommitmentAttoEth: requireBigInt(log.args, 'resultingFeeEligibleCoverageCommitmentAttoEth'),
		})
		poolState.totalRepBackingUnits = requireBigInt(log.args, 'resultingTotalRepBackingUnits')
		state.poolStates.set(log.emitter, poolState)
	}
}

export function reduceForkerEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName === 'DisputeStakedRepDrainedAtFork') {
		state.forkEscalationSources.set(requireAddress(log.args, 'parentPool'), requireAddress(log.args, 'sourceGame'))
		return
	}
	if (log.eventName === 'SecurityPoolForkSnapshot') {
		const parentPool = requireAddress(log.args, 'parentPool')
		const unresolvedEscalation = requireBoolean(log.args, 'unresolvedEscalation')
		const escalationSnapshotId = requireHex(log.args, 'escalationSnapshotId')
		state.forks.set(parentPool, {
			migrationProxy: requireAddress(log.args, 'migrationProxy'),
			ownFork: requireBoolean(log.args, 'ownFork'),
			unresolvedEscalation,
			settlementCollateralAtForkAttoEth: requireBigInt(log.args, 'settlementCollateralAtForkAttoEth'),
			poolRepAtForkAttoRep: requireBigInt(log.args, 'poolRepAtForkAttoRep'),
			auctionableRepAtForkAttoRep: requireBigInt(log.args, 'auctionableRepAtForkAttoRep'),
			escalationSourceRepAtForkAttoRep: requireBigInt(log.args, 'escalationSourceRepAtForkAttoRep'),
			escalationChildRepAtForkAttoRep: requireBigInt(log.args, 'escalationChildRepAtForkAttoRep'),
			escalationStartBondAtForkAttoRep: requireBigInt(log.args, 'escalationStartBondAtForkAttoRep'),
			escalationNonDecisionThresholdAtForkAttoRep: requireBigInt(log.args, 'escalationNonDecisionThresholdAtForkAttoRep'),
			escalationElapsedAtFork: requireBigInt(log.args, 'escalationElapsedAtFork'),
			escalationSnapshotId,
		})
		if (unresolvedEscalation) {
			const sourceGame = state.forkEscalationSources.get(parentPool) ?? state.poolStates.get(parentPool)?.escalationGame
			if (sourceGame === undefined) throw new Error('fork snapshot references an unknown escalation game')
			const carryRoots = state.escalationCarryRoots.get(sourceGame)
			const carryPeaks = state.escalationCarryPeaks.get(sourceGame)
			const carryLeaves = state.escalationCarryLeaves.get(sourceGame)
			const leafCounts = state.escalationLeafCounts.get(sourceGame)
			if (carryRoots === undefined || carryPeaks === undefined || carryLeaves === undefined || leafCounts === undefined) {
				throw new Error('fork snapshot source carry state is incomplete')
			}
			state.escalationCarrySnapshots.set(escalationSnapshotId, {
				sourceGame,
				carryRoots: cloneHexTriple(carryRoots),
				carryPeaks: cloneHexPeaksTriple(carryPeaks),
				carryLeaves: cloneHexPeaksTriple(carryLeaves),
				leafCounts: cloneBigIntTriple(leafCounts),
			})
		}
		return
	}
	if (log.eventName === 'VaultMigrationCheckpoint') {
		const parentPool = requireAddress(log.args, 'parentPool')
		const childPool = requireAddress(log.args, 'childPool')
		const migrationsByChild = getOrCreateNestedMap(state.vaultMigrations, parentPool)
		let migrations = migrationsByChild.get(childPool)
		if (migrations === undefined) {
			migrations = new Map()
			migrationsByChild.set(childPool, migrations)
		}
		migrations.set(requireAddress(log.args, 'vault'), {
			childPool,
			outcomeIndex: requireBigInt(log.args, 'outcomeIndex'),
			migratedRepDeltaAttoRep: requireBigInt(log.args, 'migratedRepDeltaAttoRep'),
			resultingChildMigratedRepTotalAttoRep: requireBigInt(log.args, 'resultingChildMigratedRepTotalAttoRep'),
			resultingParentRepBackingUnits: requireBigInt(log.args, 'resultingParentRepBackingUnits'),
			resultingParentCoverageCommitmentAttoEth: requireBigInt(log.args, 'resultingParentCoverageCommitmentAttoEth'),
			resultingChildRepBackingUnits: requireBigInt(log.args, 'resultingChildRepBackingUnits'),
			resultingChildCoverageCommitmentAttoEth: requireBigInt(log.args, 'resultingChildCoverageCommitmentAttoEth'),
			resultingParentTotalRepBackingUnits: requireBigInt(log.args, 'resultingParentTotalRepBackingUnits'),
			resultingChildTotalRepBackingUnits: requireBigInt(log.args, 'resultingChildTotalRepBackingUnits'),
			resultingParentTotalCoverageCommitmentAttoEth: requireBigInt(log.args, 'resultingParentTotalCoverageCommitmentAttoEth'),
			resultingChildTotalCoverageCommitmentAttoEth: requireBigInt(log.args, 'resultingChildTotalCoverageCommitmentAttoEth'),
			settlementCollateralTransferredAttoEth: requireBigInt(log.args, 'settlementCollateralTransferredAttoEth'),
			cumulativeSettlementCollateralTransferredAttoEth: requireBigInt(log.args, 'cumulativeSettlementCollateralTransferredAttoEth'),
		})
		return
	}
	if (log.eventName === 'ChildPoolLinked') {
		const parentPool = requireAddress(log.args, 'parent')
		let children = state.poolChildren.get(parentPool)
		if (children === undefined) {
			children = new Map()
			state.poolChildren.set(parentPool, children)
		}
		children.set(requireBigInt(log.args, 'outcomeIndex'), requireAddress(log.args, 'child'))
	}
}

export function reduceEscalationEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName === 'TruthAuctionHaircutApplied') {
		const repBefore = requireBigInt(log.args, 'repBefore')
		const repRemaining = requireBigInt(log.args, 'repRemaining')
		if (repBefore <= 0n || repRemaining <= 0n || repRemaining >= repBefore) throw new Error('truth-auction haircut ratio is invalid')
		state.escalationHaircuts.set(log.emitter, { repBefore, repRemaining })
		const totalDisputeStakedRepAttoRep = state.escalationTotalEscrowedRep.get(log.emitter)
		if (totalDisputeStakedRepAttoRep !== undefined) state.escalationTotalEscrowedRep.set(log.emitter, (totalDisputeStakedRepAttoRep * repRemaining) / repBefore)
		const outcomeBalances = state.escalationResolutionBalances.get(log.emitter)
		if (outcomeBalances !== undefined) {
			for (let outcomeIndex = 0; outcomeIndex < 3; outcomeIndex += 1) outcomeBalances[outcomeIndex] = (outcomeBalances[outcomeIndex] * repRemaining) / repBefore
		}
		return
	}
	if (log.eventName === 'GameStarted') {
		state.escalationLifecycles.set(log.emitter, {
			activationTime: requireBigInt(log.args, 'activationTime'),
			startBondAttoRep: requireBigInt(log.args, 'startBondAttoRep'),
			nonDecisionThresholdAttoRep: requireBigInt(log.args, 'nonDecisionThresholdAttoRep'),
			nonDecisionState: 'none',
			forkContinuation: false,
		})
		const emptyNullifierRoot = getEmptyNullifierRoot()
		state.escalationCarryRoots.set(log.emitter, [ZERO_HASH, ZERO_HASH, ZERO_HASH])
		state.escalationCarryPeaks.set(log.emitter, [[], [], []])
		state.escalationCarryLeaves.set(log.emitter, [[], [], []])
		state.escalationNullifierRoots.set(log.emitter, [emptyNullifierRoot, emptyNullifierRoot, emptyNullifierRoot])
		state.escalationLeafCounts.set(log.emitter, [0n, 0n, 0n])
		state.escalationUnresolvedTotals.set(log.emitter, [0n, 0n, 0n])
		state.escalationResolutionBalances.set(log.emitter, [0n, 0n, 0n])
		return
	}
	if (log.eventName === 'GameContinuedFromFork') {
		state.escalationLifecycles.set(log.emitter, {
			startBondAttoRep: requireBigInt(log.args, 'startBondAttoRep'),
			nonDecisionThresholdAttoRep: requireBigInt(log.args, 'nonDecisionThresholdAttoRep'),
			nonDecisionState: 'none',
			elapsedAtFork: requireBigInt(log.args, 'elapsedAtFork'),
			forkContinuation: true,
		})
		return
	}
	if (log.eventName === 'ForkContinuationResumed') {
		const lifecycle = state.escalationLifecycles.get(log.emitter) ?? {}
		lifecycle.resumedAt = requireBigInt(log.args, 'resumedAt')
		state.escalationLifecycles.set(log.emitter, lifecycle)
		return
	}
	if (log.eventName === 'NonDecisionReached') {
		const lifecycle = state.escalationLifecycles.get(log.emitter) ?? {}
		lifecycle.nonDecisionState = 'local'
		lifecycle.nonDecisionTimestamp = requireBigInt(log.args, 'nonDecisionTimestamp')
		state.escalationLifecycles.set(log.emitter, lifecycle)
		return
	}
	if (log.eventName === 'InheritedThresholdTie') {
		const lifecycle = state.escalationLifecycles.get(log.emitter) ?? {}
		const sourceGame = requireAddress(log.args, 'sourceGame')
		if (lifecycle.forkCarrySourceGame === undefined) throw new Error('inherited threshold tie requires a preceding fork carry checkpoint')
		if (lifecycle.forkCarrySourceGame !== sourceGame) throw new Error('inherited threshold tie source game does not match its fork carry checkpoint')
		lifecycle.nonDecisionState = 'inheritedThresholdTie'
		lifecycle.inheritedThresholdTieSourceGame = sourceGame
		state.escalationLifecycles.set(log.emitter, lifecycle)
		return
	}
	if (log.eventName === 'ForkCarryCheckpoint') {
		const snapshotId = requireHex(log.args, 'snapshotId')
		state.escalationSnapshots.set(log.emitter, snapshotId)
		const carryRoots = requireHexTriple(log.args, 'carryRoots')
		const leafCounts = requireBigIntTriple(log.args, 'leafCounts')
		state.escalationCarryRoots.set(log.emitter, carryRoots)
		state.escalationNullifierRoots.set(log.emitter, requireHexTriple(log.args, 'nullifierRoots'))
		state.escalationLeafCounts.set(log.emitter, leafCounts)
		state.escalationUnresolvedTotals.set(log.emitter, requireBigIntTriple(log.args, 'unresolvedTotalsAttoRep'))
		state.escalationResolutionBalances.set(log.emitter, requireBigIntTriple(log.args, 'resolutionBalancesAttoRep'))
		const sourceGame = requireAddress(log.args, 'sourceGame')
		let snapshot = state.escalationCarrySnapshots.get(snapshotId)
		if (snapshot === undefined) {
			const sourceCarryRoots = state.escalationCarryRoots.get(sourceGame)
			const sourceCarryPeaks = state.escalationCarryPeaks.get(sourceGame)
			const sourceCarryLeaves = state.escalationCarryLeaves.get(sourceGame)
			const sourceLeafCounts = state.escalationLeafCounts.get(sourceGame)
			if (sourceCarryRoots === undefined || sourceCarryPeaks === undefined || sourceCarryLeaves === undefined || sourceLeafCounts === undefined) {
				throw new Error('fork carry checkpoint references unknown source carry state')
			}
			snapshot = {
				sourceGame,
				carryRoots: cloneHexTriple(sourceCarryRoots),
				carryPeaks: cloneHexPeaksTriple(sourceCarryPeaks),
				carryLeaves: cloneHexPeaksTriple(sourceCarryLeaves),
				leafCounts: cloneBigIntTriple(sourceLeafCounts),
			}
		}
		if (snapshot.sourceGame !== sourceGame) throw new Error('fork carry checkpoint source game does not match its fork snapshot')
		for (let outcomeIndex = 0; outcomeIndex < 3; outcomeIndex += 1) {
			const sourceOutcomePeaks = snapshot.carryPeaks[outcomeIndex]
			const sourceLeafCount = snapshot.leafCounts[outcomeIndex]
			const checkpointLeafCount = leafCounts[outcomeIndex]
			const checkpointRoot = carryRoots[outcomeIndex]
			if (sourceOutcomePeaks === undefined || sourceLeafCount === undefined || checkpointLeafCount === undefined || checkpointRoot === undefined) {
				throw new Error('fork carry checkpoint outcome is incomplete')
			}
			if (sourceLeafCount !== checkpointLeafCount || snapshot.carryRoots[outcomeIndex] !== checkpointRoot || bagCarryPeaks(sourceOutcomePeaks, sourceLeafCount) !== checkpointRoot) {
				throw new Error('fork carry checkpoint does not match its replayed fork snapshot')
			}
		}
		state.escalationCarryPeaks.set(log.emitter, cloneHexPeaksTriple(snapshot.carryPeaks))
		state.escalationCarryLeaves.set(log.emitter, cloneHexPeaksTriple(snapshot.carryLeaves))
		const lifecycle = state.escalationLifecycles.get(log.emitter) ?? {}
		lifecycle.forkCarrySourceGame = sourceGame
		state.escalationLifecycles.set(log.emitter, lifecycle)
		return
	}
	if (log.eventName === 'LocalDepositAppended') {
		const outcome = requireBigInt(log.args, 'outcome')
		if (outcome < 0n || outcome > 2n) throw new Error('local deposit outcome is out of range')
		const deposit: DisputeStakedRepDepositReplay = {
			nodeId: requireBigInt(log.args, 'nodeId'),
			depositor: requireAddress(log.args, 'depositor'),
			outcome,
			repAmountAttoRep: requireBigInt(log.args, 'repAmountAttoRep'),
			parentDepositIndex: requireBigInt(log.args, 'parentDepositIndex'),
			cumulativeRepAmountAttoRep: requireBigInt(log.args, 'cumulativeRepAmountAttoRep'),
			carryLeafIndex: state.escalationLeafCounts.get(log.emitter)?.[Number(outcome)] ?? 0n,
			consumed: false,
		}
		getOrCreateNestedMap(state.escalationDeposits, log.emitter).set(`${outcome.toString()}:${deposit.parentDepositIndex.toString()}`, deposit)
		const unresolvedByVault = getOrCreateNestedMap(state.escalationLocalUnresolvedByVault, log.emitter)
		const vaultTotals = unresolvedByVault.get(deposit.depositor) ?? [0n, 0n, 0n]
		const outcomeIndex = Number(outcome)
		vaultTotals[outcomeIndex] += deposit.repAmountAttoRep
		unresolvedByVault.set(deposit.depositor, vaultTotals)
		const unresolvedTotals = state.escalationUnresolvedTotals.get(log.emitter) ?? [0n, 0n, 0n]
		unresolvedTotals[outcomeIndex] += deposit.repAmountAttoRep
		state.escalationUnresolvedTotals.set(log.emitter, unresolvedTotals)
		const resolutionBalancesAttoRep = state.escalationResolutionBalances.get(log.emitter) ?? [0n, 0n, 0n]
		resolutionBalancesAttoRep[outcomeIndex] = deposit.cumulativeRepAmountAttoRep
		state.escalationResolutionBalances.set(log.emitter, resolutionBalancesAttoRep)
		appendCarryLeaf(state, log.emitter, deposit)
		const bundles = getOrCreateNestedMap(state.escalationClaimBundles, log.emitter)
		let bundle = bundles.get(deposit.depositor)
		if (bundle === undefined) {
			bundle = {
				claimRepUnits: 0n,
				depositor: deposit.depositor,
			}
			bundles.set(deposit.depositor, bundle)
		}
		const haircut = state.escalationHaircuts.get(log.emitter)
		if (haircut === undefined) bundle.claimRepUnits += deposit.repAmountAttoRep
		else {
			const numerator = deposit.repAmountAttoRep * haircut.repBefore
			bundle.claimRepUnits += (numerator + haircut.repRemaining - 1n) / haircut.repRemaining
		}
		return
	}
	if (log.eventName === 'DepositOnOutcome') {
		const depositor = requireAddress(log.args, 'depositor')
		getOrCreateNestedMap(state.escalationVaultEscrowedRep, log.emitter).set(depositor, requireBigInt(log.args, 'resultingVaultDisputeStakedRepAttoRep'))
		state.escalationTotalEscrowedRep.set(log.emitter, requireBigInt(log.args, 'resultingTotalDisputeStakedRepAttoRep'))
		return
	}
	if (log.eventName === 'CarryDepositConsumed') {
		const outcome = requireBigInt(log.args, 'outcome')
		if (outcome < 0n || outcome > 2n) throw new Error('carry consumption outcome is out of range')
		const index = Number(outcome)
		const totals = state.escalationUnresolvedTotals.get(log.emitter) ?? [0n, 0n, 0n]
		totals[index] = requireBigInt(log.args, 'resultingUnresolvedTotalAttoRep')
		state.escalationUnresolvedTotals.set(log.emitter, totals)
		const nullifierRoots = state.escalationNullifierRoots.get(log.emitter)
		if (nullifierRoots !== undefined) {
			nullifierRoots[index] = requireHex(log.args, 'resultingNullifierRoot')
		}
		const resultingCarryRoot = requireHex(log.args, 'resultingCarryRoot')
		const parentDepositIndex = requireBigInt(log.args, 'parentDepositIndex')
		const sourceNodeId = requireBigInt(log.args, 'sourceNodeId')
		const reason = requireBigInt(log.args, 'reason')
		const depositor = requireAddress(log.args, 'depositor')
		const repAmountAttoRep = requireBigInt(log.args, 'repAmountAttoRep')
		const consumption: EscalationConsumptionReplay = {
			parentDepositIndex,
			sourceNodeId,
			depositor,
			outcome,
			repAmountAttoRep,
			reason,
			resultingUnresolvedTotalAttoRep: totals[index],
			resultingNullifierRoot: requireHex(log.args, 'resultingNullifierRoot'),
			resultingCarryRoot,
		}
		getOrCreateNestedMap(state.escalationConsumptions, log.emitter).set(`${parentDepositIndex.toString()}:${sourceNodeId.toString()}`, consumption)
		const deposit = state.escalationDeposits.get(log.emitter)?.get(`${outcome.toString()}:${parentDepositIndex.toString()}`)
		if (deposit !== undefined && !deposit.consumed) {
			deposit.consumed = true
			deposit.consumptionReason = reason
			const unresolvedByVault = state.escalationLocalUnresolvedByVault.get(log.emitter)
			const vaultTotals = unresolvedByVault?.get(depositor)
			if (vaultTotals !== undefined) {
				if (vaultTotals[index] < repAmountAttoRep) throw new Error('vault unresolved REP cannot become negative')
				vaultTotals[index] -= repAmountAttoRep
			}
			const leaves = state.escalationCarryLeaves.get(log.emitter)?.[index]
			if (leaves !== undefined) {
				const carryLeafIndex = Number(deposit.carryLeafIndex)
				if (!Number.isSafeInteger(carryLeafIndex) || carryLeafIndex < 0 || carryLeafIndex >= leaves.length) throw new Error('local carry leaf index is out of range')
				leaves[carryLeafIndex] = ZERO_HASH
				const peaksByOutcome = state.escalationCarryPeaks.get(log.emitter)
				if (peaksByOutcome === undefined) throw new Error('local carry peaks are missing')
				peaksByOutcome[index] = rebuildCarryPeaks(leaves)
			}
		}
		const carryRoots = state.escalationCarryRoots.get(log.emitter)
		if (carryRoots !== undefined) carryRoots[index] = resultingCarryRoot
		const replayedPeaks = state.escalationCarryPeaks.get(log.emitter)?.[index]
		const replayedLeafCount = state.escalationLeafCounts.get(log.emitter)?.[index]
		if (replayedPeaks !== undefined && replayedLeafCount !== undefined && bagCarryPeaks(replayedPeaks, replayedLeafCount) !== resultingCarryRoot) {
			throw new Error('carry consumption root does not match replayed leaves')
		}
		return
	}
	if (log.eventName === 'ClaimDeposit') {
		const outcome = requireBigInt(log.args, 'outcome')
		const parentDepositIndex = requireBigInt(log.args, 'parentDepositIndex')
		getOrCreateNestedMap(state.escalationClaims, log.emitter).set(`${outcome.toString()}:${parentDepositIndex.toString()}`, {
			depositor: requireAddress(log.args, 'depositor'),
			outcome,
			parentDepositIndex,
			originalDepositAmountAttoRep: requireBigInt(log.args, 'originalDepositAmountAttoRep'),
			amountToWithdrawAttoRep: requireBigInt(log.args, 'amountToWithdrawAttoRep'),
			burnAmountAttoRep: requireBigInt(log.args, 'burnAmountAttoRep'),
			transferredRep: requireBoolean(log.args, 'transferredRep'),
		})
		return
	}
	if (log.eventName === 'VaultEscrowUpdated') {
		getOrCreateNestedMap(state.escalationVaultEscrowedRep, log.emitter).set(requireAddress(log.args, 'vault'), requireBigInt(log.args, 'disputeStakedRepByVaultAttoRep'))
		state.escalationTotalEscrowedRep.set(log.emitter, requireBigInt(log.args, 'totalDisputeStakedRepAttoRep'))
		return
	}
	if (log.eventName === 'VaultUnresolvedTotalsExported') {
		const vault = requireAddress(log.args, 'vault')
		const principalByOutcomeAttoRep = requireBigIntTriple(log.args, 'principalByOutcomeAttoRep')
		getOrCreateNestedMap(state.escalationVaultExports, log.emitter).set(vault, {
			repReceiver: requireAddress(log.args, 'repReceiver'),
			principalByOutcomeAttoRep,
			principalToTransferAttoRep: requireBigInt(log.args, 'principalToTransferAttoRep'),
			transferredRep: requireBoolean(log.args, 'transferredRep'),
		})
		getOrCreateNestedMap(state.escalationLocalUnresolvedByVault, log.emitter).set(vault, [0n, 0n, 0n])
		return
	}
	if (log.eventName === 'ForkedEscrowRecorded') {
		const depositor = requireAddress(log.args, 'depositor')
		const outcome = requireBigInt(log.args, 'outcome')
		getOrCreateNestedMap(state.escalationForkedEscrow, log.emitter).set(`${depositor}:${outcome.toString()}`, {
			sourcePrincipalAttoRep: requireBigInt(log.args, 'sourcePrincipalTotalAttoRep'),
			sourcePrincipalClaimedAttoRep: 0n,
			childRepAttoRep: requireBigInt(log.args, 'childRepTotalAttoRep'),
			childRepClaimedAttoRep: 0n,
		})
		getOrCreateNestedMap(state.escalationVaultEscrowedRep, log.emitter).set(depositor, requireBigInt(log.args, 'disputeStakedRepByVaultAttoRep'))
		state.escalationTotalEscrowedRep.set(log.emitter, requireBigInt(log.args, 'totalDisputeStakedRepAttoRep'))
		const resolutionBalancesAttoRep = state.escalationResolutionBalances.get(log.emitter) ?? [0n, 0n, 0n]
		resolutionBalancesAttoRep[Number(outcome)] = requireBigInt(log.args, 'outcomeBalanceAttoRep')
		state.escalationResolutionBalances.set(log.emitter, resolutionBalancesAttoRep)
		return
	}
	if (log.eventName === 'ForkedEscrowClaimed') {
		const depositor = requireAddress(log.args, 'depositor')
		const outcome = requireBigInt(log.args, 'outcome')
		const escrow = state.escalationForkedEscrow.get(log.emitter)?.get(`${depositor}:${outcome.toString()}`)
		if (escrow === undefined) throw new Error('forked escrow claim references unknown escrow')
		escrow.sourcePrincipalClaimedAttoRep = requireBigInt(log.args, 'sourcePrincipalClaimedAttoRep')
		escrow.childRepClaimedAttoRep = requireBigInt(log.args, 'childRepClaimedAttoRep')
		return
	}
	if (log.eventName === 'ForkedEscrowExported') {
		const vault = requireAddress(log.args, 'vault')
		const sourcePrincipalByOutcomeAttoRep = requireBigIntTriple(log.args, 'sourcePrincipalByOutcomeAttoRep')
		const childRepByOutcomeAttoRep = requireBigIntTriple(log.args, 'childRepByOutcomeAttoRep')
		getOrCreateNestedMap(state.escalationForkedExports, log.emitter).set(vault, {
			repReceiver: requireAddress(log.args, 'repReceiver'),
			sourcePrincipalByOutcomeAttoRep,
			childRepByOutcomeAttoRep,
			totalChildRepToTransferAttoRep: requireBigInt(log.args, 'totalChildRepToTransferAttoRep'),
			transferredRep: requireBoolean(log.args, 'transferredRep'),
		})
		for (let outcomeIndex = 0; outcomeIndex < 3; outcomeIndex += 1) {
			if (sourcePrincipalByOutcomeAttoRep[outcomeIndex] === 0n && childRepByOutcomeAttoRep[outcomeIndex] === 0n) continue
			const escrow = state.escalationForkedEscrow.get(log.emitter)?.get(`${vault}:${outcomeIndex.toString()}`)
			if (escrow === undefined) throw new Error('forked escrow export references unknown escrow')
			escrow.sourcePrincipalClaimedAttoRep = escrow.sourcePrincipalAttoRep
			escrow.childRepClaimedAttoRep = escrow.childRepAttoRep
		}
		return
	}
	if (log.eventName === 'ResidualRepSweptToSecurityPool') {
		state.escalationResidualRepSwept.set(log.emitter, (state.escalationResidualRepSwept.get(log.emitter) ?? 0n) + requireBigInt(log.args, 'amountAttoRep'))
	}
}

export function reduceAuctionEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName === 'AuctionStarted') {
		state.auctions.set(log.emitter, {
			startTimestamp: requireBigInt(log.args, 'startTimestamp'),
			endTimestamp: requireBigInt(log.args, 'endTimestamp'),
		})
		return
	}
	if (log.eventName === 'AuctionFinalized') {
		const auction = state.auctions.get(log.emitter) ?? {}
		auction.clearingTick = requireBigInt(log.args, 'clearingTick')
		auction.grossAcceptedAttoEth = requireBigInt(log.args, 'grossAcceptedAttoEth')
		auction.repSoldAttoRep = requireBigInt(log.args, 'repSoldAttoRep')
		auction.funded = requireBoolean(log.args, 'funded')
		state.auctions.set(log.emitter, auction)
		return
	}
	if (log.eventName !== 'BidSubmitted' && log.eventName !== 'BidSettled') return
	const tick = requireBigInt(log.args, 'tick')
	const bidIndex = requireBigInt(log.args, 'bidIndex')
	const key = `${tick.toString()}:${bidIndex.toString()}`
	let bids = state.auctionBids.get(log.emitter)
	if (bids === undefined) {
		bids = new Map()
		state.auctionBids.set(log.emitter, bids)
	}
	if (log.eventName === 'BidSubmitted') {
		bids.set(key, {
			bidder: requireAddress(log.args, 'bidder'),
			tick,
			bidIndex,
			bidAmountAttoEth: requireBigInt(log.args, 'bidAmountAttoEth'),
			cumulativeBidAtTickAttoEth: requireBigInt(log.args, 'cumulativeBidAtTickAttoEth'),
		})
		return
	}
	const bid = bids.get(key)
	if (bid === undefined) throw new Error(`BidSettled references unknown bid ${key}`)
	bid.bidUsedAttoEth = requireBigInt(log.args, 'bidUsedAttoEth')
	bid.repFilledAttoRep = requireBigInt(log.args, 'repFilledAttoRep')
	bid.refundAttoEth = requireBigInt(log.args, 'refundAttoEth')
	bid.status = requireBigInt(log.args, 'status')
}

export function reduceCoordinatorEvent(state: ReplayState, log: ReplayLog) {
	const coordinatorEventNames = new Set([
		'SecurityPoolSet',
		'RepEthPriceSet',
		'PriceRequested',
		'PriceReported',
		'PriceReportRejected',
		'PendingReportRecovered',
		'PendingOperationRecoveryConsumed',
		'StagedOperationQueued',
		'StagedOperationDisputeStakedRepSnapshotted',
		'ExecutedStagedOperation',
		'CoordinatorStateCheckpoint',
	])
	if (!coordinatorEventNames.has(log.eventName)) return
	let coordinator = state.coordinators.get(log.emitter)
	if (coordinator === undefined) {
		coordinator = {
			lastPrice: 0n,
			lastSettlementTimestamp: 0n,
			pendingReportId: 0n,
			pendingReportSponsor: ZERO_ADDRESS,
			pendingOperationSlotId: 0n,
			pendingReportMaxSettlementBaseFee: 0n,
			stagedOperationCounter: 0n,
			activeStagedOperationCount: 0n,
			pendingSettlementOperationCount: 0n,
			reports: new Map(),
		}
		state.coordinators.set(log.emitter, coordinator)
	}
	if (log.eventName === 'CoordinatorStateCheckpoint') {
		coordinator.checkpointReason = requireBigInt(log.args, 'reason')
		coordinator.checkpointReportId = requireBigInt(log.args, 'reportId')
		coordinator.checkpointOperationId = requireBigInt(log.args, 'operationId')
		coordinator.pendingReportId = requireBigInt(log.args, 'pendingReportId')
		coordinator.pendingReportSponsor = requireAddress(log.args, 'pendingReportSponsor')
		coordinator.pendingOperationSlotId = requireBigInt(log.args, 'pendingOperationSlotId')
		coordinator.pendingReportMaxSettlementBaseFee = requireBigInt(log.args, 'pendingReportMaxSettlementBaseFee')
		coordinator.lastPrice = requireBigInt(log.args, 'lastPrice')
		coordinator.lastSettlementTimestamp = requireBigInt(log.args, 'lastSettlementTimestamp')
		coordinator.stagedOperationCounter = requireBigInt(log.args, 'stagedOperationCounter')
		coordinator.activeStagedOperationCount = requireBigInt(log.args, 'activeStagedOperationCount')
		coordinator.pendingSettlementOperationCount = requireBigInt(log.args, 'pendingSettlementOperationCount')
		return
	}
	if (log.eventName === 'SecurityPoolSet') {
		coordinator.securityPool = requireAddress(log.args, 'securityPool')
		return
	}
	if (log.eventName === 'RepEthPriceSet') {
		coordinator.lastPrice = requireBigInt(log.args, 'price')
		return
	}
	if (log.eventName === 'PriceRequested') {
		const reportId = requireBigInt(log.args, 'reportId')
		coordinator.pendingReportId = reportId
		coordinator.pendingReportMaxSettlementBaseFee = requireBigInt(log.args, 'pendingReportMaxSettlementBaseFee')
		coordinator.reports.set(reportId, { status: 'Requested' })
		return
	}
	if (log.eventName === 'PriceReported') {
		const reportId = requireBigInt(log.args, 'reportId')
		const price = requireBigInt(log.args, 'price')
		const settlementTimestamp = requireBigInt(log.args, 'lastSettlementTimestamp')
		coordinator.pendingReportId = 0n
		coordinator.pendingReportMaxSettlementBaseFee = 0n
		coordinator.lastPrice = price
		coordinator.lastSettlementTimestamp = settlementTimestamp
		coordinator.reports.set(reportId, { status: 'Reported', price, settlementTimestamp })
		return
	}
	if (log.eventName === 'PriceReportRejected') {
		const reportId = requireBigInt(log.args, 'reportId')
		coordinator.pendingReportId = requireBigInt(log.args, 'pendingReportId')
		coordinator.pendingReportMaxSettlementBaseFee = requireBigInt(log.args, 'pendingReportMaxSettlementBaseFee')
		coordinator.lastPrice = requireBigInt(log.args, 'lastPrice')
		coordinator.lastSettlementTimestamp = requireBigInt(log.args, 'lastSettlementTimestamp')
		coordinator.reports.set(reportId, { status: 'Rejected', reason: requireString(log.args, 'reason') })
		return
	}
	if (log.eventName === 'PendingReportRecovered') {
		const reportId = requireBigInt(log.args, 'reportId')
		const settlementTimestamp = requireBigInt(log.args, 'settlementTimestamp')
		coordinator.pendingReportId = requireBigInt(log.args, 'pendingReportId')
		coordinator.pendingReportMaxSettlementBaseFee = requireBigInt(log.args, 'pendingReportMaxSettlementBaseFee')
		coordinator.lastPrice = requireBigInt(log.args, 'lastPrice')
		coordinator.lastSettlementTimestamp = requireBigInt(log.args, 'lastSettlementTimestamp')
		coordinator.reports.set(reportId, { status: 'Recovered', settlementTimestamp })
		return
	}
	let operations = state.coordinatorOperations.get(log.emitter)
	if (operations === undefined) {
		operations = new Map()
		state.coordinatorOperations.set(log.emitter, operations)
	}
	const operationId = requireBigInt(log.args, 'operationId')
	if (log.eventName === 'PendingOperationRecoveryConsumed') {
		const queued = operations.get(operationId)
		if (queued === undefined) throw new Error('recovered coordinator operation was not queued')
		operations.set(operationId, {
			...queued,
			operation: requireBigInt(log.args, 'operation'),
			isPendingSlot: false,
			status: 'Recovered',
		})
		return
	}
	if (log.eventName === 'StagedOperationQueued') {
		operations.set(operationId, {
			operation: requireBigInt(log.args, 'operation'),
			initiatorVault: requireAddress(log.args, 'initiatorVault'),
			targetVault: requireAddress(log.args, 'targetVault'),
			amount: requireBigInt(log.args, 'amount'),
			queuedAt: requireBigInt(log.args, 'queuedAt'),
			validForSeconds: requireBigInt(log.args, 'validForSeconds'),
			snapshotTargetBackingUnits: requireBigInt(log.args, 'snapshotTargetBackingUnits'),
			snapshotTargetCoverageCommitmentAttoEth: requireBigInt(log.args, 'snapshotTargetCoverageCommitmentAttoEth'),
			snapshotTargetDisputeStakedRepAttoRep: 0n,
			snapshotTotalPoolHeldRepAttoRep: requireBigInt(log.args, 'snapshotTotalPoolHeldRepAttoRep'),
			snapshotDenominator: requireBigInt(log.args, 'snapshotDenominator'),
			isPendingSlot: requireBoolean(log.args, 'isPendingSlot'),
			status: 'Queued',
		})
		return
	}
	if (log.eventName === 'StagedOperationDisputeStakedRepSnapshotted') {
		const queued = operations.get(operationId)
		if (queued === undefined) throw new Error('coordinator dispute-staked REP snapshot was not queued')
		operations.set(operationId, {
			...queued,
			snapshotTargetDisputeStakedRepAttoRep: requireBigInt(log.args, 'snapshotTargetDisputeStakedRepAttoRep'),
		})
		return
	}
	if (log.eventName !== 'ExecutedStagedOperation') return
	const success = requireBoolean(log.args, 'success')
	const queued = operations.get(operationId)
	if (queued === undefined) throw new Error('executed coordinator operation was not queued')
	operations.set(operationId, {
		...queued,
		operation: requireBigInt(log.args, 'operation'),
		isPendingSlot: false,
		status: success ? 'Succeeded' : 'Failed',
		errorMessage: requireString(log.args, 'errorMessage'),
	})
}

type PoolRelationshipDiscovery = {
	factories: ReadonlySet<Address>
	pools: ReadonlySet<Address>
	shareTokens: ReadonlySet<Address>
	auctions: ReadonlySet<Address>
	coordinators: ReadonlySet<Address>
	escalationGames: ReadonlySet<Address>
}

export function reduceZoltarLog(state: ReplayState, log: ReplayLog, recognizedRepTokens: ReadonlySet<Address>, poolRelationships?: PoolRelationshipDiscovery) {
	const emitter = getAddress(log.emitter)
	reduceZoltarEvent(state, log)
	reduceReputationTokenEvent(state, log, recognizedRepTokens)
	if (poolRelationships === undefined || poolRelationships.factories.has(emitter)) reducePoolFactoryEvent(state, log)
	if (poolRelationships === undefined || poolRelationships.shareTokens.has(emitter)) reduceShareTokenEvent(state, log)
	if (poolRelationships === undefined || poolRelationships.pools.has(emitter)) reduceSecurityPoolEvent(state, log)
	reduceForkerEvent(state, log)
	if (poolRelationships === undefined || poolRelationships.escalationGames.has(emitter)) reduceEscalationEvent(state, log)
	if (poolRelationships === undefined || poolRelationships.auctions.has(emitter)) reduceAuctionEvent(state, log)
	if (poolRelationships === undefined || poolRelationships.coordinators.has(emitter)) reduceCoordinatorEvent(state, log)
}

export function replayZoltarEvents(logs: readonly ReplayLog[], orphanedBlockHashes: ReadonlySet<Hex> = new Set(), knownPoolFactories?: ReadonlySet<Address>) {
	const state = createReplayState()
	const orderedLogs = logs
		.filter(log => !orphanedBlockHashes.has(log.blockHash))
		.toSorted((left, right) => {
			if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1
			if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex
			return left.logIndex - right.logIndex
		})
	const recognizedRepTokens = new Set<Address>()
	for (const log of orderedLogs) {
		if (log.eventName === 'UniverseInitialized') recognizedRepTokens.add(requireAddress(log.args, 'reputationToken'))
		if (log.eventName === 'DeployChild') recognizedRepTokens.add(requireAddress(log.args, 'childReputationToken'))
	}
	let poolRelationships: PoolRelationshipDiscovery | undefined
	if (knownPoolFactories !== undefined) {
		const factories = new Set([...knownPoolFactories].map(factory => getAddress(factory)))
		const pools = new Set<Address>()
		const shareTokens = new Set<Address>()
		const auctions = new Set<Address>()
		const coordinators = new Set<Address>()
		const escalationGames = new Set<Address>()
		for (const log of orderedLogs) {
			if (log.eventName !== 'DeploySecurityPool' || !factories.has(getAddress(log.emitter))) continue
			reducePoolFactoryEvent(state, log)
			pools.add(requireAddress(log.args, 'securityPool'))
			shareTokens.add(requireAddress(log.args, 'shareToken'))
			const truthAuction = requireAddress(log.args, 'truthAuction')
			if (truthAuction !== ZERO_ADDRESS) auctions.add(truthAuction)
			coordinators.add(requireAddress(log.args, 'priceOracleManagerAndOperatorQueuer'))
		}
		for (const log of orderedLogs) {
			if (log.eventName !== 'EscalationGameSet' || !pools.has(getAddress(log.emitter))) continue
			escalationGames.add(requireAddress(log.args, 'escalationGame'))
		}
		poolRelationships = { factories, pools, shareTokens, auctions, coordinators, escalationGames }
	}
	for (const log of orderedLogs) {
		const identity = getCanonicalEventIdentity(log)
		if (state.identities.has(identity)) continue
		state.identities.add(identity)
		reduceZoltarLog(state, log, recognizedRepTokens, poolRelationships)
	}
	return state
}
