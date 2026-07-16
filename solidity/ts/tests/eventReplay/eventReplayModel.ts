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
	completeSetCollateralAmount: bigint
	totalSecurityBondAllowance: bigint
	feeEligibleSecurityBondAllowance: bigint
	totalFeesOwedToVaults: bigint
	unallocatedFeeReserve: bigint
	feeIndex: bigint
	feeIndexRemainder: bigint
	totalFeesOwedRemainder: bigint
	uncheckpointedFeeEligibleAllowance: bigint
	lastUpdatedFeeAccumulator: bigint
	currentRetentionRate: bigint
}

export type VaultAccountingReplay = {
	poolOwnershipAmount: bigint
	securityBondAllowance: bigint
	unpaidEthFees: bigint
	feeIndex: bigint
	vaultFeeRemainder: bigint
	resultingPoolOwnershipDenominator: bigint
	resultingFeeEligibleSecurityBondAllowance: bigint
}

export type PoolStateReplay = {
	shareTokenSupply?: bigint
	poolOwnershipDenominator?: bigint
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
	collateralAtFork: bigint
	poolRepAtFork: bigint
	auctionableRepAtFork: bigint
	escalationSourceRepAtFork: bigint
	escalationChildRepAtFork: bigint
	escalationStartBondAtFork: bigint
	escalationNonDecisionThresholdAtFork: bigint
	escalationElapsedAtFork: bigint
	escalationSnapshotId: Hex
}

export type VaultMigrationReplay = {
	childPool: Address
	outcomeIndex: bigint
	migratedRepDelta: bigint
	resultingChildMigratedRepTotal: bigint
	resultingParentPoolOwnershipAmount: bigint
	resultingParentSecurityBondAllowance: bigint
	resultingChildPoolOwnershipAmount: bigint
	resultingChildSecurityBondAllowance: bigint
	resultingParentPoolOwnershipDenominator: bigint
	resultingChildPoolOwnershipDenominator: bigint
	resultingParentTotalSecurityBondAllowance: bigint
	resultingChildTotalSecurityBondAllowance: bigint
	collateralDelta: bigint
	cumulativeCollateralTransferred: bigint
}

export type AuctionBidReplay = {
	bidder: Address
	tick: bigint
	bidIndex: bigint
	ethAmount: bigint
	cumulativeEthAtTick: bigint
	ethUsed?: bigint
	repFilled?: bigint
	ethRefund?: bigint
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
}

export type AuctionLifecycleReplay = {
	startTimestamp?: bigint
	endTimestamp?: bigint
	clearingTick?: bigint
	grossEthAccepted?: bigint
	repSold?: bigint
	funded?: boolean
}

export type CoordinatorOperationReplay = {
	operation: bigint
	initiatorVault?: Address
	targetVault?: Address
	amount?: bigint
	queuedAt?: bigint
	status: 'Queued' | 'Succeeded' | 'Failed' | 'Recovered'
	errorMessage?: string
}

export type EscalationDepositReplay = {
	nodeId: bigint
	depositor: Address
	outcome: bigint
	repAmount: bigint
	parentDepositIndex: bigint
	cumulativeRepAmount: bigint
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
	universeTheoreticalSupply: bigint
}

export type UniverseForkReplay = {
	forker: Address
	questionId: bigint
	forkTime: bigint
	forkThreshold: bigint
	migrationRepBalance: bigint
	universeTheoreticalSupply: bigint
}

export type EscalationLifecycleReplay = {
	activationTime?: bigint
	startBond?: bigint
	nonDecisionThreshold?: bigint
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
	repAmount: bigint
	reason: bigint
	resultingUnresolvedTotal: bigint
	resultingNullifierRoot: Hex
	resultingCarryRoot: Hex
}

export type EscalationClaimReplay = {
	depositor: Address
	outcome: bigint
	parentDepositIndex: bigint
	originalDepositAmount: bigint
	amountToWithdraw: bigint
	burnAmount: bigint
	transferredRep: boolean
}

export type ForkedEscrowReplay = {
	sourcePrincipal: bigint
	sourcePrincipalClaimed: bigint
	childRep: bigint
	childRepClaimed: bigint
}

export type VaultUnresolvedExportReplay = {
	repReceiver: Address
	principalByOutcome: BigIntTriple
	principalToTransfer: bigint
	transferredRep: boolean
}

export type ForkedEscrowExportReplay = {
	repReceiver: Address
	sourcePrincipalByOutcome: BigIntTriple
	childRepByOutcome: BigIntTriple
	totalChildRepToTransfer: bigint
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
	priceRoundMaxNotional: bigint
	priceRoundConsumedNotional: bigint
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

export type ReplayState = {
	identities: Set<string>
	questions: Map<bigint, QuestionReplay>
	universes: Map<string, UniverseReplay>
	universeForks: Map<string, UniverseForkReplay>
	universeChildren: Map<string, Map<bigint, string>>
	universeRepTokens: Map<string, Address>
	universeTheoreticalSupply: Map<string, bigint>
	repBalances: Map<string, Map<Address, bigint>>
	repSupply: Map<string, bigint>
	migrationRepBalances: Map<string, Map<Address, bigint>>
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
	escalationDeposits: Map<Address, Map<string, EscalationDepositReplay>>
	escalationLifecycles: Map<Address, EscalationLifecycleReplay>
	escalationConsumptions: Map<Address, Map<string, EscalationConsumptionReplay>>
	escalationClaims: Map<Address, Map<string, EscalationClaimReplay>>
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
		universeTheoreticalSupply: new Map(),
		repBalances: new Map(),
		repSupply: new Map(),
		migrationRepBalances: new Map(),
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

function hashCarryLeaf(deposit: EscalationDepositReplay) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [deposit.depositor, deposit.outcome, deposit.repAmount, deposit.parentDepositIndex, deposit.cumulativeRepAmount, deposit.nodeId]))
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

function appendCarryLeaf(state: ReplayState, emitter: Address, deposit: EscalationDepositReplay) {
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
		const universeTheoreticalSupply = requireBigInt(log.args, 'universeTheoreticalSupply')
		state.universes.set(universeId, {
			forkTime: requireBigInt(log.args, 'forkTime'),
			forkQuestionId: requireBigInt(log.args, 'forkQuestionId'),
			forkingOutcomeIndex: requireBigInt(log.args, 'forkingOutcomeIndex'),
			reputationToken,
			parentUniverseId: requireBigInt(log.args, 'parentUniverseId').toString(),
			universeTheoreticalSupply,
		})
		state.universeRepTokens.set(universeId, reputationToken)
		state.universeTheoreticalSupply.set(universeId, universeTheoreticalSupply)
		return
	}
	if (log.eventName === 'UniverseForked') {
		const universeId = requireBigInt(log.args, 'universeId').toString()
		const forkTime = requireBigInt(log.args, 'forkTime')
		const questionId = requireBigInt(log.args, 'questionId')
		const universeTheoreticalSupply = requireBigInt(log.args, 'universeTheoreticalSupply')
		const forker = requireAddress(log.args, 'forker')
		const migrationRepBalance = requireBigInt(log.args, 'migrationRepBalance')
		state.universeForks.set(universeId, {
			forker,
			questionId,
			forkTime,
			forkThreshold: requireBigInt(log.args, 'forkThreshold'),
			migrationRepBalance,
			universeTheoreticalSupply,
		})
		const universe = state.universes.get(universeId)
		if (universe !== undefined) {
			universe.forkTime = forkTime
			universe.forkQuestionId = questionId
			universe.universeTheoreticalSupply = universeTheoreticalSupply
		}
		setNestedBalance(state.migrationRepBalances, universeId, forker, migrationRepBalance)
		state.universeTheoreticalSupply.set(universeId, universeTheoreticalSupply)
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
		const childUniverseTheoreticalSupply = requireBigInt(log.args, 'childUniverseTheoreticalSupply')
		const parentUniverse = state.universes.get(parentUniverseId)
		state.universes.set(childUniverseId, {
			forkTime: 0n,
			forkQuestionId: parentUniverse?.forkQuestionId ?? state.universeForks.get(parentUniverseId)?.questionId ?? 0n,
			forkingOutcomeIndex: outcomeIndex,
			reputationToken: childReputationToken,
			parentUniverseId,
			universeTheoreticalSupply: childUniverseTheoreticalSupply,
		})
		state.universeRepTokens.set(childUniverseId, childReputationToken)
		state.universeTheoreticalSupply.set(childUniverseId, childUniverseTheoreticalSupply)
		return
	}
	if (log.eventName === 'MigrationRepAdded') {
		const universeId = requireBigInt(log.args, 'universeId').toString()
		setNestedBalance(state.migrationRepBalances, universeId, requireAddress(log.args, 'migrator'), requireBigInt(log.args, 'migrationRepBalance'))
		const universeTheoreticalSupply = requireBigInt(log.args, 'universeTheoreticalSupply')
		state.universeTheoreticalSupply.set(universeId, universeTheoreticalSupply)
		const universe = state.universes.get(universeId)
		if (universe !== undefined) universe.universeTheoreticalSupply = universeTheoreticalSupply
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
		byChild.set(requireBigInt(log.args, 'childUniverseId').toString(), requireBigInt(log.args, 'childMigrationRepAmount'))
	}
}

export function reduceReputationTokenEvent(state: ReplayState, log: ReplayLog, recognizedRepTokens: ReadonlySet<Address>) {
	if (log.eventName !== 'Transfer') return
	const tokenAddress = getAddress(log.emitter)
	if (!recognizedRepTokens.has(tokenAddress)) return
	const token = tokenAddress.toLowerCase()
	const from = requireAddress(log.args, 'from')
	const to = requireAddress(log.args, 'to')
	const amount = requireBigInt(log.args, 'value')
	const zero = '0x0000000000000000000000000000000000000000'
	if (from !== zero) {
		const currentFromBalance = state.repBalances.get(token)?.get(from) ?? 0n
		setNestedBalance(state.repBalances, token, from, currentFromBalance - amount)
	}
	if (to !== zero) {
		const currentToBalance = state.repBalances.get(token)?.get(to) ?? 0n
		setNestedBalance(state.repBalances, token, to, currentToBalance + amount)
	}
	let supplyDelta = 0n
	if (from === zero) supplyDelta = amount
	if (to === zero) supplyDelta = -amount
	const resultingSupply = (state.repSupply.get(token) ?? 0n) + supplyDelta
	if (resultingSupply < 0n) throw new Error('REP supply cannot become negative')
	state.repSupply.set(token, resultingSupply)
}

export function reducePoolFactoryEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName !== 'DeploySecurityPool') return
	state.poolDeployments.set(requireAddress(log.args, 'securityPool'), {
		factory: log.emitter,
		parent: requireAddress(log.args, 'parent'),
		universeId: requireBigInt(log.args, 'universeId'),
		questionId: requireBigInt(log.args, 'questionId'),
		truthAuction: requireAddress(log.args, 'truthAuction'),
		coordinator: requireAddress(log.args, 'priceOracleManagerAndOperatorQueuer'),
		shareToken: requireAddress(log.args, 'shareToken'),
	})
}

export function reduceShareTokenEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName !== 'AuthorizationUpdated') return
	let authorizations = state.authorizations.get(log.emitter)
	if (authorizations === undefined) {
		authorizations = new Map()
		state.authorizations.set(log.emitter, authorizations)
	}
	authorizations.set(requireAddress(log.args, 'account'), requireBoolean(log.args, 'authorized'))
}

export function reduceSecurityPoolEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName === 'PoolAccountingCheckpoint') {
		state.pools.set(log.emitter, {
			reason: requireBigInt(log.args, 'reason'),
			vault: requireAddress(log.args, 'vault'),
			completeSetCollateralAmount: requireBigInt(log.args, 'completeSetCollateralAmount'),
			totalSecurityBondAllowance: requireBigInt(log.args, 'totalSecurityBondAllowance'),
			feeEligibleSecurityBondAllowance: requireBigInt(log.args, 'feeEligibleSecurityBondAllowance'),
			totalFeesOwedToVaults: requireBigInt(log.args, 'totalFeesOwedToVaults'),
			unallocatedFeeReserve: requireBigInt(log.args, 'unallocatedFeeReserve'),
			feeIndex: requireBigInt(log.args, 'feeIndex'),
			feeIndexRemainder: requireBigInt(log.args, 'feeIndexRemainder'),
			totalFeesOwedRemainder: requireBigInt(log.args, 'totalFeesOwedRemainder'),
			uncheckpointedFeeEligibleAllowance: requireBigInt(log.args, 'uncheckpointedFeeEligibleAllowance'),
			lastUpdatedFeeAccumulator: requireBigInt(log.args, 'lastUpdatedFeeAccumulator'),
			currentRetentionRate: requireBigInt(log.args, 'currentRetentionRate'),
		})
		return
	}
	if (log.eventName === 'CompleteSetCreated' || log.eventName === 'CompleteSetRedeemed' || log.eventName === 'SharesRedeemed') {
		const resultingShareTokenSupply = requireBigInt(log.args, 'resultingShareTokenSupply')
		state.completeSetSupplies.set(log.emitter, resultingShareTokenSupply)
		const poolState = state.poolStates.get(log.emitter) ?? {}
		poolState.shareTokenSupply = resultingShareTokenSupply
		state.poolStates.set(log.emitter, poolState)
		return
	}
	const poolState = state.poolStates.get(log.emitter) ?? {}
	if (log.eventName === 'ShareTokenSupplySet') {
		const shareTokenSupply = requireBigInt(log.args, 'shareTokenSupply')
		poolState.shareTokenSupply = shareTokenSupply
		state.poolStates.set(log.emitter, poolState)
		state.completeSetSupplies.set(log.emitter, shareTokenSupply)
		return
	}
	if (log.eventName === 'OwnershipDenominatorSet') {
		poolState.poolOwnershipDenominator = requireBigInt(log.args, 'poolOwnershipDenominator')
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
		poolState.repTransferredAtFork = requireBigInt(log.args, 'repTransferred')
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
			poolOwnershipAmount: requireBigInt(log.args, 'poolOwnershipAmount'),
			securityBondAllowance: requireBigInt(log.args, 'securityBondAllowance'),
			unpaidEthFees: requireBigInt(log.args, 'unpaidEthFees'),
			feeIndex: requireBigInt(log.args, 'feeIndex'),
			vaultFeeRemainder: requireBigInt(log.args, 'vaultFeeRemainder'),
			resultingPoolOwnershipDenominator: requireBigInt(log.args, 'resultingPoolOwnershipDenominator'),
			resultingFeeEligibleSecurityBondAllowance: requireBigInt(log.args, 'resultingFeeEligibleSecurityBondAllowance'),
		})
		poolState.poolOwnershipDenominator = requireBigInt(log.args, 'resultingPoolOwnershipDenominator')
		state.poolStates.set(log.emitter, poolState)
	}
}

export function reduceForkerEvent(state: ReplayState, log: ReplayLog) {
	if (log.eventName === 'EscalationRepDrainedAtFork') {
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
			collateralAtFork: requireBigInt(log.args, 'collateralAtFork'),
			poolRepAtFork: requireBigInt(log.args, 'poolRepAtFork'),
			auctionableRepAtFork: requireBigInt(log.args, 'auctionableRepAtFork'),
			escalationSourceRepAtFork: requireBigInt(log.args, 'escalationSourceRepAtFork'),
			escalationChildRepAtFork: requireBigInt(log.args, 'escalationChildRepAtFork'),
			escalationStartBondAtFork: requireBigInt(log.args, 'escalationStartBondAtFork'),
			escalationNonDecisionThresholdAtFork: requireBigInt(log.args, 'escalationNonDecisionThresholdAtFork'),
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
			migratedRepDelta: requireBigInt(log.args, 'migratedRepDelta'),
			resultingChildMigratedRepTotal: requireBigInt(log.args, 'resultingChildMigratedRepTotal'),
			resultingParentPoolOwnershipAmount: requireBigInt(log.args, 'resultingParentPoolOwnershipAmount'),
			resultingParentSecurityBondAllowance: requireBigInt(log.args, 'resultingParentSecurityBondAllowance'),
			resultingChildPoolOwnershipAmount: requireBigInt(log.args, 'resultingChildPoolOwnershipAmount'),
			resultingChildSecurityBondAllowance: requireBigInt(log.args, 'resultingChildSecurityBondAllowance'),
			resultingParentPoolOwnershipDenominator: requireBigInt(log.args, 'resultingParentPoolOwnershipDenominator'),
			resultingChildPoolOwnershipDenominator: requireBigInt(log.args, 'resultingChildPoolOwnershipDenominator'),
			resultingParentTotalSecurityBondAllowance: requireBigInt(log.args, 'resultingParentTotalSecurityBondAllowance'),
			resultingChildTotalSecurityBondAllowance: requireBigInt(log.args, 'resultingChildTotalSecurityBondAllowance'),
			collateralDelta: requireBigInt(log.args, 'collateralDelta'),
			cumulativeCollateralTransferred: requireBigInt(log.args, 'cumulativeCollateralTransferred'),
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
	if (log.eventName === 'GameStarted') {
		state.escalationLifecycles.set(log.emitter, {
			activationTime: requireBigInt(log.args, 'activationTime'),
			startBond: requireBigInt(log.args, 'startBond'),
			nonDecisionThreshold: requireBigInt(log.args, 'nonDecisionThreshold'),
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
			startBond: requireBigInt(log.args, 'startBond'),
			nonDecisionThreshold: requireBigInt(log.args, 'nonDecisionThreshold'),
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
		lifecycle.nonDecisionTimestamp = requireBigInt(log.args, 'nonDecisionTimestamp')
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
		state.escalationUnresolvedTotals.set(log.emitter, requireBigIntTriple(log.args, 'unresolvedTotals'))
		state.escalationResolutionBalances.set(log.emitter, requireBigIntTriple(log.args, 'resolutionBalances'))
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
		return
	}
	if (log.eventName === 'LocalDepositAppended') {
		const outcome = requireBigInt(log.args, 'outcome')
		if (outcome < 0n || outcome > 2n) throw new Error('local deposit outcome is out of range')
		const deposit: EscalationDepositReplay = {
			nodeId: requireBigInt(log.args, 'nodeId'),
			depositor: requireAddress(log.args, 'depositor'),
			outcome,
			repAmount: requireBigInt(log.args, 'repAmount'),
			parentDepositIndex: requireBigInt(log.args, 'parentDepositIndex'),
			cumulativeRepAmount: requireBigInt(log.args, 'cumulativeRepAmount'),
			carryLeafIndex: state.escalationLeafCounts.get(log.emitter)?.[Number(outcome)] ?? 0n,
			consumed: false,
		}
		getOrCreateNestedMap(state.escalationDeposits, log.emitter).set(`${outcome.toString()}:${deposit.parentDepositIndex.toString()}`, deposit)
		const unresolvedByVault = getOrCreateNestedMap(state.escalationLocalUnresolvedByVault, log.emitter)
		const vaultTotals = unresolvedByVault.get(deposit.depositor) ?? [0n, 0n, 0n]
		const outcomeIndex = Number(outcome)
		vaultTotals[outcomeIndex] += deposit.repAmount
		unresolvedByVault.set(deposit.depositor, vaultTotals)
		const unresolvedTotals = state.escalationUnresolvedTotals.get(log.emitter) ?? [0n, 0n, 0n]
		unresolvedTotals[outcomeIndex] += deposit.repAmount
		state.escalationUnresolvedTotals.set(log.emitter, unresolvedTotals)
		const resolutionBalances = state.escalationResolutionBalances.get(log.emitter) ?? [0n, 0n, 0n]
		resolutionBalances[outcomeIndex] = deposit.cumulativeRepAmount
		state.escalationResolutionBalances.set(log.emitter, resolutionBalances)
		appendCarryLeaf(state, log.emitter, deposit)
		return
	}
	if (log.eventName === 'DepositOnOutcome') {
		const depositor = requireAddress(log.args, 'depositor')
		getOrCreateNestedMap(state.escalationVaultEscrowedRep, log.emitter).set(depositor, requireBigInt(log.args, 'resultingVaultEscrowedRep'))
		state.escalationTotalEscrowedRep.set(log.emitter, requireBigInt(log.args, 'resultingTotalEscrowedRep'))
		return
	}
	if (log.eventName === 'CarryDepositConsumed') {
		const outcome = requireBigInt(log.args, 'outcome')
		if (outcome < 0n || outcome > 2n) throw new Error('carry consumption outcome is out of range')
		const index = Number(outcome)
		const totals = state.escalationUnresolvedTotals.get(log.emitter) ?? [0n, 0n, 0n]
		totals[index] = requireBigInt(log.args, 'resultingUnresolvedTotal')
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
		const repAmount = requireBigInt(log.args, 'repAmount')
		const consumption: EscalationConsumptionReplay = {
			parentDepositIndex,
			sourceNodeId,
			depositor,
			outcome,
			repAmount,
			reason,
			resultingUnresolvedTotal: totals[index],
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
				if (vaultTotals[index] < repAmount) throw new Error('vault unresolved REP cannot become negative')
				vaultTotals[index] -= repAmount
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
			originalDepositAmount: requireBigInt(log.args, 'originalDepositAmount'),
			amountToWithdraw: requireBigInt(log.args, 'amountToWithdraw'),
			burnAmount: requireBigInt(log.args, 'burnAmount'),
			transferredRep: requireBoolean(log.args, 'transferredRep'),
		})
		return
	}
	if (log.eventName === 'VaultEscrowUpdated') {
		getOrCreateNestedMap(state.escalationVaultEscrowedRep, log.emitter).set(requireAddress(log.args, 'vault'), requireBigInt(log.args, 'escrowedRepByVault'))
		state.escalationTotalEscrowedRep.set(log.emitter, requireBigInt(log.args, 'totalEscrowedRep'))
		return
	}
	if (log.eventName === 'VaultUnresolvedTotalsExported') {
		const vault = requireAddress(log.args, 'vault')
		const principalByOutcome = requireBigIntTriple(log.args, 'principalByOutcome')
		getOrCreateNestedMap(state.escalationVaultExports, log.emitter).set(vault, {
			repReceiver: requireAddress(log.args, 'repReceiver'),
			principalByOutcome,
			principalToTransfer: requireBigInt(log.args, 'principalToTransfer'),
			transferredRep: requireBoolean(log.args, 'transferredRep'),
		})
		getOrCreateNestedMap(state.escalationLocalUnresolvedByVault, log.emitter).set(vault, [0n, 0n, 0n])
		return
	}
	if (log.eventName === 'ForkedEscrowRecorded') {
		const depositor = requireAddress(log.args, 'depositor')
		const outcome = requireBigInt(log.args, 'outcome')
		getOrCreateNestedMap(state.escalationForkedEscrow, log.emitter).set(`${depositor}:${outcome.toString()}`, {
			sourcePrincipal: requireBigInt(log.args, 'sourcePrincipalTotal'),
			sourcePrincipalClaimed: 0n,
			childRep: requireBigInt(log.args, 'childRepTotal'),
			childRepClaimed: 0n,
		})
		getOrCreateNestedMap(state.escalationVaultEscrowedRep, log.emitter).set(depositor, requireBigInt(log.args, 'escrowedRepByVault'))
		state.escalationTotalEscrowedRep.set(log.emitter, requireBigInt(log.args, 'totalEscrowedRep'))
		const resolutionBalances = state.escalationResolutionBalances.get(log.emitter) ?? [0n, 0n, 0n]
		resolutionBalances[Number(outcome)] = requireBigInt(log.args, 'outcomeBalance')
		state.escalationResolutionBalances.set(log.emitter, resolutionBalances)
		return
	}
	if (log.eventName === 'ForkedEscrowClaimed') {
		const depositor = requireAddress(log.args, 'depositor')
		const outcome = requireBigInt(log.args, 'outcome')
		const escrow = state.escalationForkedEscrow.get(log.emitter)?.get(`${depositor}:${outcome.toString()}`)
		if (escrow === undefined) throw new Error('forked escrow claim references unknown escrow')
		escrow.sourcePrincipalClaimed = requireBigInt(log.args, 'sourcePrincipalClaimed')
		escrow.childRepClaimed = requireBigInt(log.args, 'childRepClaimed')
		return
	}
	if (log.eventName === 'ForkedEscrowExported') {
		const vault = requireAddress(log.args, 'vault')
		const sourcePrincipalByOutcome = requireBigIntTriple(log.args, 'sourcePrincipalByOutcome')
		const childRepByOutcome = requireBigIntTriple(log.args, 'childRepByOutcome')
		getOrCreateNestedMap(state.escalationForkedExports, log.emitter).set(vault, {
			repReceiver: requireAddress(log.args, 'repReceiver'),
			sourcePrincipalByOutcome,
			childRepByOutcome,
			totalChildRepToTransfer: requireBigInt(log.args, 'totalChildRepToTransfer'),
			transferredRep: requireBoolean(log.args, 'transferredRep'),
		})
		for (let outcomeIndex = 0; outcomeIndex < 3; outcomeIndex += 1) {
			if (sourcePrincipalByOutcome[outcomeIndex] === 0n && childRepByOutcome[outcomeIndex] === 0n) continue
			const escrow = state.escalationForkedEscrow.get(log.emitter)?.get(`${vault}:${outcomeIndex.toString()}`)
			if (escrow === undefined) throw new Error('forked escrow export references unknown escrow')
			escrow.sourcePrincipalClaimed = escrow.sourcePrincipal
			escrow.childRepClaimed = escrow.childRep
		}
		return
	}
	if (log.eventName === 'ResidualRepSweptToSecurityPool') {
		state.escalationResidualRepSwept.set(log.emitter, (state.escalationResidualRepSwept.get(log.emitter) ?? 0n) + requireBigInt(log.args, 'amount'))
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
		auction.grossEthAccepted = requireBigInt(log.args, 'grossEthAccepted')
		auction.repSold = requireBigInt(log.args, 'repSold')
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
			ethAmount: requireBigInt(log.args, 'ethAmount'),
			cumulativeEthAtTick: requireBigInt(log.args, 'cumulativeEthAtTick'),
		})
		return
	}
	const bid = bids.get(key)
	if (bid === undefined) throw new Error(`BidSettled references unknown bid ${key}`)
	bid.ethUsed = requireBigInt(log.args, 'ethUsed')
	bid.repFilled = requireBigInt(log.args, 'repFilled')
	bid.ethRefund = requireBigInt(log.args, 'ethRefund')
	bid.status = requireBigInt(log.args, 'status')
}

export function reduceCoordinatorEvent(state: ReplayState, log: ReplayLog) {
	const coordinatorEventNames = new Set(['SecurityPoolSet', 'RepEthPriceSet', 'PriceRequested', 'PriceReported', 'PriceReportRejected', 'PendingReportRecovered', 'PendingOperationRecoveryConsumed', 'StagedOperationQueued', 'ExecutedStagedOperation', 'CoordinatorStateCheckpoint'])
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
			priceRoundMaxNotional: 0n,
			priceRoundConsumedNotional: 0n,
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
		coordinator.priceRoundMaxNotional = requireBigInt(log.args, 'priceRoundMaxNotional')
		coordinator.priceRoundConsumedNotional = requireBigInt(log.args, 'priceRoundConsumedNotional')
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
		operations.set(operationId, {
			...queued,
			operation: requireBigInt(log.args, 'operation'),
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
			status: 'Queued',
		})
		return
	}
	if (log.eventName !== 'ExecutedStagedOperation') return
	const success = requireBoolean(log.args, 'success')
	const queued = operations.get(operationId)
	operations.set(operationId, {
		...queued,
		operation: requireBigInt(log.args, 'operation'),
		status: success ? 'Succeeded' : 'Failed',
		errorMessage: requireString(log.args, 'errorMessage'),
	})
}

export function reduceZoltarLog(state: ReplayState, log: ReplayLog, recognizedRepTokens: ReadonlySet<Address>) {
	reduceZoltarEvent(state, log)
	reduceReputationTokenEvent(state, log, recognizedRepTokens)
	reducePoolFactoryEvent(state, log)
	reduceShareTokenEvent(state, log)
	reduceSecurityPoolEvent(state, log)
	reduceForkerEvent(state, log)
	reduceEscalationEvent(state, log)
	reduceAuctionEvent(state, log)
	reduceCoordinatorEvent(state, log)
}

export function replayZoltarEvents(logs: readonly ReplayLog[], orphanedBlockHashes: ReadonlySet<Hex> = new Set()) {
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
	for (const log of orderedLogs) {
		const identity = getCanonicalEventIdentity(log)
		if (state.identities.has(identity)) continue
		state.identities.add(identity)
		reduceZoltarLog(state, log, recognizedRepTokens)
	}
	return state
}
