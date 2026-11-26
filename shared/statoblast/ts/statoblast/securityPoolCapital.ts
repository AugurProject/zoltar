import { encodeFunctionData, formatUnits, parseAbi, zeroAddress, type AbiValue, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolEconomicsConfig } from './securityPool.js'
import type { SecurityPoolReadClient } from './securityPoolRead.js'
import { decodeAuctionVaultBindings } from './securityPoolRepairAuctionVaultClones.js'
import { decodeAddress, decodeBool, decodeFields, decodeUint } from './securityPoolDecoding.js'

export const minimumSecurityPoolHealthFactorBps = 10_000n

function minimumHealthMessage() {
	return `Health target must be at least ${formatUnits(minimumSecurityPoolHealthFactorBps, 2)}%.`
}

const abi = parseAbi([
	'function repairAuctionPosition(uint256 bidId) view returns ((address vault,uint96 positionId,uint256 principal,uint256 commitment,uint256 targetHealthFactorBps,uint48 liquidationStarted,bool materialized,uint256 earnedAttoEth,uint256 earnedAttoRep) result)',
	'function originUniverseId() view returns (uint248)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function availableMintCapacity(uint248 universeId) view returns (uint256)',
	'function zoltar() view returns (address)',
	'function getForkTime(uint248 universeId) view returns (uint256)',
	'function getForkChoiceDeadline(uint248 universeId) view returns (uint256)',
	'function purchaseFeeBps() view returns (uint256)',
	'function annualFeeBps() view returns (uint256)',
	'function minimumPurchaseFeeAttoEth() view returns (uint256)',
	'function minimumCommitmentAttoEth() view returns (uint256)',
	'function rewardVestingSeconds() view returns (uint48)',
	'function priceFeed(uint248 universeId) view returns (address)',
	'function acceptedExposureLimitAttoEth() view returns (uint256)',
	'function settlement() view returns (address)',
	'function ledger() view returns (address)',
	'function minimumOutcomeExchangeRate() view returns (uint256)',
	'function repToken() view returns (address)',
	'function commitmentIndex() view returns (address)',
	'function acceptedPrice() view returns (uint256)',
	'function conservativePrice() view returns (uint256)',
	'function liquidationPrice() view returns (uint256)',
	'function ownerConservativePrice(address owner) view returns (uint256)',
	'function securityMultiplierBps() view returns (uint256)',
	'function priceValidUntil() view returns (uint48)',
	'function isPriceValid() view returns (bool)',
	'function demandAttoEth() view returns (uint256)',
	'function totalFreeAttoRep() view returns (uint256)',
	'function frozen() view returns (bool)',
	'function importing() view returns (bool)',
	'function exported(address owner) view returns (bool)',
	'function checkpoint()',
	'function ownerAccount(address owner) view returns ((uint256 freeAttoRep,uint256 feesAttoEth,uint256 feesAttoRep,uint256 targetHealthFactorBps,uint96 positionId) account)',
	'function ownerCollateral(address owner) view returns (uint256 principal,uint256 commitment,uint256 withdrawable)',
	'function totals() view returns (uint256 rep,uint256 commitment,uint256 healthy)',
	'function currentBatch() view returns (uint96)',
	'function nextBatch() view returns (uint96)',
	'function accountOf(uint96 id) view returns ((address owner,uint96 batch,uint256 rep,uint256 commitment,uint256 maxHealthyPrice,uint256 releasedRep,uint256 ethFees,uint256 repFees,uint256 remainingCommitment) account)',
	'function previewRetirement(uint96 id,uint256 acceptedPrice,uint256 demand) view returns ((uint8 status,uint96 effectiveCurrentBatch,uint256 healthyCommitment,uint256 spareCommitment,uint256 queuedAheadCommitment,uint256 commitmentReduction,uint256 releasedRep) preview)',
	'function liquidationStarted(uint96 id) view returns (uint48)',
	'function liquidationPenaltyPaid(uint96 id) view returns (uint256)',
	'function liquidationElapsed(uint96 id) view returns (uint256)',
	'function depositFor(address owner,uint256 amount)',
	'function depositAndSetHealthTarget(uint256 amount,uint256 targetHealthFactorBps)',
	'function withdrawPrincipal(uint256 amount,address recipient)',
	'function setHealthTarget(uint256 targetHealthFactorBps)',
	'function setCommitment(uint256 commitment) returns (uint96)',
	'function setCommitmentWithReport(uint256 reportId,uint256 commitment) returns (uint96)',
	'function serveRetirement(uint96 id)',
	'function claimEarnings(address recipient)',
	'function takeOver(uint96 id,uint256 commitment,uint256 minimumTakeoverReward,uint256 maximumOwnRep) returns (uint96)',
	'function takeOverWithBounds(uint96 id,uint256 commitment,uint256 minimumTakeoverReward,uint256 maximumOwnRep,(uint256 maximumOwnerPrincipal,uint256 maximumOwnerCommitment,uint256 expectedTargetHealthFactorBps,uint256 expectedAcceptedPriceEpoch,uint96 expectedSourceBatch) bounds) returns (uint96)',
])

type SecurityPoolCapitalOwner = {
	freeAttoRep: bigint
	feesAttoEth: bigint
	feesAttoRep: bigint
	targetHealthFactorBps: bigint
	positionId: bigint
}
type SecurityPoolRetirementPreview = {
	status: 'not-retiring' | 'imports-open' | 'demand-exceeds-healthy' | 'earlier-requests' | 'insufficient-spare' | 'ready'
	effectiveCurrentBatch: bigint
	healthyCommitment: bigint
	spareCommitment: bigint
	queuedAheadCommitment: bigint
	commitmentReduction: bigint
	releasedRep: bigint
}
type SecurityPoolTakeoverBounds = {
	maximumOwnerPrincipal: bigint
	maximumOwnerCommitment: bigint
	expectedTargetHealthFactorBps: bigint
	expectedAcceptedPriceEpoch: bigint
	expectedSourceBatch: bigint
}
type SecurityPoolCapitalPosition = {
	id: bigint
	owner: Address
	batch: bigint
	rep: bigint
	commitment: bigint
	maxHealthyPrice: bigint
	releasedRep: bigint
	feesAttoEth: bigint
	feesAttoRep: bigint
	liquidationStarted: bigint
	liquidationPenaltyPaid?: bigint
	liquidationElapsed?: bigint
	remainingCommitment: bigint
	/** Advisory at this snapshot block, before the next ledger checkpoint. */
	retirementPreview: SecurityPoolRetirementPreview | undefined
}
export type SecurityPoolCapitalSnapshot = {
	auctionBidId?: bigint | undefined
	chainId: number
	blockNumber: bigint
	blockHash: Hex
	timestamp: bigint
	securityPool: Address
	owner: Address
	universeId: bigint
	capitalLedger: Address
	priceFeed: Address
	commitmentIndex: Address
	repToken: Address
	acceptedPrice: bigint
	conservativePrice: bigint
	liquidationPrice: bigint
	ownerConservativePrice: bigint
	oracleExposureLimitAttoEth: bigint
	securityMultiplierBps: bigint
	priceValidUntil: bigint
	priceValid: boolean
	demandAttoEth: bigint
	totalPledgedAttoRep: bigint
	totalCommitmentAttoEth: bigint
	healthyCommitmentAttoEth: bigint
	/** Purchasable capacity after retirement reservations and cash-backing checks. */
	availableMintCapacityAttoEth: bigint
	totalFreeAttoRep: bigint
	currentBatch: bigint
	nextBatch: bigint
	forkTime: bigint
	forkChoiceDeadline: bigint
	frozen: boolean
	importing: boolean
	exported: boolean
	ownerAccount: SecurityPoolCapitalOwner
	positions: SecurityPoolCapitalPosition[]
	/** All deposited principal, including lazily released retirement principal. */
	ownerPrincipalAttoRep: bigint
	ownerCommitmentAttoEth: bigint
	/** Canonical safe withdrawal allowance at the snapshot block. */
	withdrawableAttoRep: bigint
	/** Fees already credited by the index; the next checkpoint may add earnings. */
	accruedFeesAttoEth: bigint
	accruedFeesAttoRep: bigint
	economics: SecurityPoolEconomicsConfig
}

function positive(value: unknown, label: string, bits = 256) {
	const decoded = decodeUint(value, label, bits)
	if (decoded === 0n) throw new Error(`${label} must be positive.`)
	return decoded
}
function healthTarget(value: unknown) {
	const target = decodeUint(value, 'Health target')
	if (target < minimumSecurityPoolHealthFactorBps) throw new Error(minimumHealthMessage())
	return target
}
function retirementStatus(value: unknown): SecurityPoolRetirementPreview['status'] {
	switch (value) {
		case 0n:
			return 'not-retiring'
		case 1n:
			return 'imports-open'
		case 2n:
			return 'demand-exceeds-healthy'
		case 3n:
			return 'earlier-requests'
		case 4n:
			return 'insufficient-spare'
		case 5n:
			return 'ready'
		default:
			throw new Error('Invalid commitment reduction preview status.')
	}
}
function retirementPreview(value: unknown): SecurityPoolRetirementPreview {
	const [status, batch, healthy, spare, ahead, reduction, rep] = decodeFields(value, ['status', 'effectiveCurrentBatch', 'healthyCommitment', 'spareCommitment', 'queuedAheadCommitment', 'commitmentReduction', 'releasedRep'], 'Invalid capital accounting response.')
	return {
		status: retirementStatus(status),
		effectiveCurrentBatch: decodeUint(batch, 'Current reduction batch ID', 96),
		healthyCommitment: decodeUint(healthy, 'Projected backed commitment'),
		spareCommitment: decodeUint(spare, 'Preview spare commitment'),
		queuedAheadCommitment: decodeUint(ahead, 'Earlier reserved reductions'),
		commitmentReduction: decodeUint(reduction, 'Commitment reduction'),
		releasedRep: decodeUint(rep, 'REP to release'),
	}
}
function ownerAccount(value: unknown): SecurityPoolCapitalOwner {
	const [free, eth, rep, health, id] = decodeFields(value, ['freeAttoRep', 'feesAttoEth', 'feesAttoRep', 'targetHealthFactorBps', 'positionId'], 'Invalid capital accounting response.')
	return {
		freeAttoRep: decodeUint(free, 'Free REP'),
		feesAttoEth: decodeUint(eth, 'ETH earnings'),
		feesAttoRep: decodeUint(rep, 'REP earnings'),
		targetHealthFactorBps: decodeUint(health, 'Health target'),
		positionId: decodeUint(id, 'Position ID', 96),
	}
}

type CapitalRequest = { owner: Address; capitalLedger: Address }
function request(parameters: CapitalRequest, functionName: string, args: readonly AbiValue[] = [], value = 0n) {
	return { account: decodeAddress(parameters.owner, 'Owner'), to: decodeAddress(parameters.capitalLedger, 'Capital contract'), value: decodeUint(value, 'Transaction value'), data: encodeFunctionData({ abi, functionName, args }) }
}

export function buildSecurityPoolCapitalDepositRequest(parameters: CapitalRequest & { amountAttoRep: bigint }) {
	return request(parameters, 'depositFor', [decodeAddress(parameters.owner, 'Owner'), positive(parameters.amountAttoRep, 'REP deposit')])
}
export function buildSecurityPoolCapitalWithdrawPrincipalRequest(parameters: CapitalRequest & { amountAttoRep: bigint; recipient?: Address }) {
	return request(parameters, 'withdrawPrincipal', [positive(parameters.amountAttoRep, 'REP withdrawal'), decodeAddress(parameters.recipient ?? parameters.owner, 'Recipient')])
}
export function buildSecurityPoolCapitalSetHealthRequest(parameters: CapitalRequest & { targetHealthFactorBps: bigint }) {
	return request(parameters, 'setHealthTarget', [healthTarget(parameters.targetHealthFactorBps)])
}
export function buildSecurityPoolCapitalDepositAndSetHealthRequest(parameters: CapitalRequest & { amountAttoRep: bigint; targetHealthFactorBps: bigint }) {
	const amountAttoRep = positive(parameters.amountAttoRep, 'REP deposit')
	return request(parameters, 'depositAndSetHealthTarget', [amountAttoRep, healthTarget(parameters.targetHealthFactorBps)])
}
/**
 * Sets the owner's whole commitment. Raising or keeping it applies at once. Lowering can cure an uncovered deficit
 * at a fresh price when it meets the economic minimum and capacity permits; a smaller deficit queues the whole reduction,
 * for partial and full exits alike. A report id prices growth only.
 */
export function buildSecurityPoolCapitalSetCommitmentRequest(parameters: CapitalRequest & { commitment: bigint; reportId?: bigint }) {
	const commitment = decodeUint(parameters.commitment, 'Commitment')
	return parameters.reportId === undefined ? request(parameters, 'setCommitment', [commitment]) : request(parameters, 'setCommitmentWithReport', [decodeUint(parameters.reportId, 'Report ID'), positive(commitment, 'Commitment')])
}
export function buildSecurityPoolCapitalServeRetirementRequest(parameters: CapitalRequest & { positionId: bigint }) {
	return request(parameters, 'serveRetirement', [positive(decodeUint(parameters.positionId, 'Position ID', 96), 'Position ID')])
}
/** Pays REP and collateral earnings to `recipient`, defaulting to the owner, so a token that refuses the owner cannot strand them. */
export function buildSecurityPoolCapitalClaimEarningsRequest(parameters: CapitalRequest & { recipient?: Address }) {
	return request(parameters, 'claimEarnings', [decodeAddress(parameters.recipient ?? parameters.owner, 'Recipient')])
}
/** @public Keeper takeover: a new receiver commits all idle principal within maximumOwnRep; an existing receiver must be active or share the target cohort. */
export function buildSecurityPoolCapitalTakeOverRequest(parameters: CapitalRequest & { positionId: bigint; commitment: bigint; minimumTakeoverReward: bigint; maximumOwnRep: bigint }) {
	return request(parameters, 'takeOver', [positive(parameters.positionId, 'Position ID', 96), positive(parameters.commitment, 'Takeover commitment'), decodeUint(parameters.minimumTakeoverReward, 'Minimum takeover reward'), decodeUint(parameters.maximumOwnRep, 'Maximum own REP')])
}

/** Bind an automated acquisition to its quoted price epoch, owner policy and final exposure. */
export function buildSecurityPoolCapitalTakeOverWithBoundsRequest(parameters: CapitalRequest & { positionId: bigint; commitment: bigint; minimumTakeoverReward: bigint; maximumOwnRep: bigint; bounds: SecurityPoolTakeoverBounds }) {
	const bounds = parameters.bounds
	const expectedTargetHealthFactorBps = decodeUint(bounds.expectedTargetHealthFactorBps, 'Expected health target')
	if (expectedTargetHealthFactorBps < minimumSecurityPoolHealthFactorBps) throw new Error(minimumHealthMessage())
	return request(parameters, 'takeOverWithBounds', [
		positive(parameters.positionId, 'Position ID', 96),
		positive(parameters.commitment, 'Takeover commitment'),
		decodeUint(parameters.minimumTakeoverReward, 'Minimum takeover reward'),
		decodeUint(parameters.maximumOwnRep, 'Maximum own REP'),
		[
			decodeUint(bounds.maximumOwnerPrincipal, 'Maximum pledged REP'),
			decodeUint(bounds.maximumOwnerCommitment, 'Maximum owner commitment'),
			expectedTargetHealthFactorBps,
			decodeUint(bounds.expectedAcceptedPriceEpoch, 'Expected price update ID'),
			decodeUint(bounds.expectedSourceBatch, 'Expected reduction batch ID', 96),
		],
	])
}

/**
 * Unpaid cure of a position under an adverse observation whose deficit the shared spare absorbs. The ledger applies the
 * cure and pays no takeover reward, so the call asks for none. Zero consent makes it revert instead of acquiring anything
 * if the cure no longer restores the position.
 */
export function buildSecurityPoolCapitalCureRequest(parameters: CapitalRequest & { positionId: bigint; commitment: bigint; expectedAcceptedPriceEpoch: bigint; expectedSourceBatch: bigint }) {
	return buildSecurityPoolCapitalTakeOverWithBoundsRequest({
		...parameters,
		minimumTakeoverReward: 0n,
		maximumOwnRep: 0n,
		bounds: { maximumOwnerPrincipal: 0n, maximumOwnerCommitment: 0n, expectedTargetHealthFactorBps: minimumSecurityPoolHealthFactorBps, expectedAcceptedPriceEpoch: parameters.expectedAcceptedPriceEpoch, expectedSourceBatch: parameters.expectedSourceBatch },
	})
}

/**
 * What `claimEarnings` pays at the snapshot block. It checkpoints first, so a passive owner's earnings stay uncredited
 * until then. One `eth_call` runs that checkpoint and the reads that depend on it without keeping any state change.
 */
export async function loadSecurityPoolClaimableEarnings(
	snapshot: Pick<SecurityPoolCapitalSnapshot, 'blockNumber' | 'capitalLedger' | 'commitmentIndex' | 'owner' | 'ownerAccount' | 'auctionBidId'>,
	multicall: (contracts: readonly { address: Address; abi: typeof abi; functionName: string; args: readonly AbiValue[] }[], blockNumber: bigint) => Promise<readonly unknown[]>,
) {
	const positionId = snapshot.ownerAccount.positionId
	if (positionId === 0n && snapshot.auctionBidId !== undefined) {
		const [, value] = await multicall(
			[
				{ address: snapshot.capitalLedger, abi, functionName: 'checkpoint', args: [] },
				{ address: snapshot.capitalLedger, abi, functionName: 'repairAuctionPosition', args: [snapshot.auctionBidId] },
			],
			snapshot.blockNumber,
		)
		const [vault, , , , , , , eth, rep] = decodeFields(value, ['vault', 'positionId', 'principal', 'commitment', 'targetHealthFactorBps', 'liquidationStarted', 'materialized', 'earnedAttoEth', 'earnedAttoRep'], 'Invalid auction earnings response.')
		if (decodeAddress(vault, 'Auction position address') !== snapshot.owner) throw new Error('Auction earnings owner mismatch.')
		return { attoEth: decodeUint(eth, 'ETH earnings'), attoRep: decodeUint(rep, 'REP earnings') }
	}
	const [, ownerValue, positionValue] = await multicall(
		[{ address: snapshot.capitalLedger, abi, functionName: 'checkpoint', args: [] }, { address: snapshot.capitalLedger, abi, functionName: 'ownerAccount', args: [snapshot.owner] }, ...(positionId === 0n ? [] : [{ address: snapshot.commitmentIndex, abi, functionName: 'accountOf', args: [positionId] }])],
		snapshot.blockNumber,
	)
	const account = ownerAccount(ownerValue)
	if (positionValue === undefined) return { attoEth: account.feesAttoEth, attoRep: account.feesAttoRep }
	const [eth, rep] = decodeFields(positionValue, ['ethFees', 'repFees'], 'Invalid capital accounting response.')
	return { attoEth: account.feesAttoEth + decodeUint(eth, 'ETH earnings'), attoRep: account.feesAttoRep + decodeUint(rep, 'REP earnings') }
}

/** All reads share one block. A position is only read when an owner is supplied. */
export async function loadSecurityPoolCapitalSnapshot(parameters: { client: SecurityPoolReadClient; securityPool: Address; owner?: Address | undefined; universeId?: bigint; blockNumber?: bigint }): Promise<SecurityPoolCapitalSnapshot> {
	const { client } = parameters
	const securityPool = decodeAddress(parameters.securityPool, 'Security pool')
	const owner = parameters.owner === undefined ? undefined : decodeAddress(parameters.owner, 'Owner')
	const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock(parameters.blockNumber === undefined ? undefined : { blockNumber: parameters.blockNumber })])
	if (!Number.isSafeInteger(chainId) || chainId <= 0 || block.number === undefined || block.hash === undefined) throw new Error('A confirmed block is required for capital accounting.')
	const blockNumber = block.number
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const universeId = decodeUint(parameters.universeId ?? (await read(securityPool, 'originUniverseId')), 'Universe ID', 248)
	const [ledgerValue, zoltarValue, settlementValue, feeBps, annualFeeBps, minimumFee, minimumCommitment, duration, feedValue] = await Promise.all([
		read(securityPool, 'capitalLedger', [universeId]),
		read(securityPool, 'zoltar'),
		read(securityPool, 'settlement'),
		read(securityPool, 'purchaseFeeBps'),
		read(securityPool, 'annualFeeBps'),
		read(securityPool, 'minimumPurchaseFeeAttoEth'),
		read(securityPool, 'minimumCommitmentAttoEth'),
		read(securityPool, 'rewardVestingSeconds'),
		read(securityPool, 'priceFeed', [universeId]),
	])
	const capitalLedger = decodeAddress(ledgerValue, 'Capital contract')
	const zoltar = decodeAddress(zoltarValue, 'universe contract for the security pool')
	const [indexValue, tokenValue, bookValue, price, multiplier, validUntil, valid, demand, free, frozen, importing, exported, ownerValue, collateralValue, totalsValue, forkTimeValue, choiceDeadlineValue, conservative, liquidation, exposureLimit, ownerPrice, availableCapacity] = await Promise.all([
		read(capitalLedger, 'commitmentIndex'),
		read(capitalLedger, 'repToken'),
		read(decodeAddress(settlementValue, 'Payout contract'), 'ledger'),
		read(capitalLedger, 'acceptedPrice'),
		read(capitalLedger, 'securityMultiplierBps'),
		read(capitalLedger, 'priceValidUntil'),
		read(capitalLedger, 'isPriceValid'),
		read(capitalLedger, 'demandAttoEth'),
		read(capitalLedger, 'totalFreeAttoRep'),
		read(capitalLedger, 'frozen'),
		read(capitalLedger, 'importing'),
		owner === undefined ? false : read(capitalLedger, 'exported', [owner]),
		owner === undefined ? undefined : read(capitalLedger, 'ownerAccount', [owner]),
		owner === undefined ? [0n, 0n, 0n] : read(capitalLedger, 'ownerCollateral', [owner]),
		read(capitalLedger, 'totals'),
		read(zoltar, 'getForkTime', [universeId]),
		read(zoltar, 'getForkChoiceDeadline', [universeId]),
		read(capitalLedger, 'conservativePrice'),
		read(capitalLedger, 'liquidationPrice'),
		feedValue === zeroAddress ? 0n : read(decodeAddress(feedValue, 'Shared price feed'), 'acceptedExposureLimitAttoEth'),
		owner === undefined ? 0n : read(capitalLedger, 'ownerConservativePrice', [owner]),
		read(securityPool, 'availableMintCapacity', [universeId]),
	])
	const commitmentIndex = decodeAddress(indexValue, 'Pool capacity contract')
	const account = owner === undefined ? { freeAttoRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, targetHealthFactorBps: 0n, positionId: 0n } : ownerAccount(ownerValue)
	const [principal, commitment, withdrawable] = decodeFields(collateralValue, ['principal', 'commitment', 'withdrawable'], 'Invalid capital accounting response.')
	const ownerPrincipalAttoRep = decodeUint(principal, 'Position pledged REP')
	const withdrawableAttoRep = decodeUint(withdrawable, 'Withdrawable REP')
	if (withdrawableAttoRep > ownerPrincipalAttoRep) throw new Error('Withdrawal allowance exceeds pledged REP.')
	const [totalRep, totalK, healthyK] = decodeFields(totalsValue, ['rep', 'commitment', 'healthy'], 'Invalid capital accounting response.')
	const [current, next, minimumOutcomeRate] = await Promise.all([read(commitmentIndex, 'currentBatch'), read(commitmentIndex, 'nextBatch'), read(decodeAddress(bookValue, 'Payout records'), 'minimumOutcomeExchangeRate')])
	const positions = await Promise.all(
		(owner === undefined || account.positionId === 0n ? [] : [{ id: account.positionId, owner }]).map(async ({ id, owner }) => {
			const [value, liquidation, penaltyPaid, elapsed] = await Promise.all([read(commitmentIndex, 'accountOf', [id]), read(capitalLedger, 'liquidationStarted', [id]), read(capitalLedger, 'liquidationPenaltyPaid', [id]), read(capitalLedger, 'liquidationElapsed', [id])])
			const [holder, batch, rep, commitment, maximum, released, eth, repFees, remaining] = decodeFields(value, ['owner', 'batch', 'rep', 'commitment', 'maxHealthyPrice', 'releasedRep', 'ethFees', 'repFees', 'remainingCommitment'], 'Invalid capital accounting response.')
			if (decodeAddress(holder, 'Position owner').toLowerCase() !== owner.toLowerCase()) throw new Error('Capital position belongs to another owner.')
			const cohort = decodeUint(batch, 'Reduction batch ID', 96)
			const liveCommitment = decodeUint(commitment, 'Commitment')
			const preview = cohort !== 0n && liveCommitment !== 0n ? retirementPreview(await read(commitmentIndex, 'previewRetirement', [id, decodeUint(conservative, 'Health price'), decodeUint(demand, 'Demand')])) : undefined
			return {
				id,
				owner,
				batch: cohort,
				rep: decodeUint(rep, 'Pledged REP'),
				commitment: liveCommitment,
				maxHealthyPrice: decodeUint(maximum, 'Maximum healthy price'),
				releasedRep: decodeUint(released, 'Released REP'),
				feesAttoEth: decodeUint(eth, 'ETH earnings'),
				feesAttoRep: decodeUint(repFees, 'REP earnings'),
				liquidationStarted: decodeUint(liquidation, 'Liquidation start', 48),
				liquidationPenaltyPaid: decodeUint(penaltyPaid, 'Liquidation penalty paid'),
				liquidationElapsed: decodeUint(elapsed, 'Liquidation elapsed'),
				remainingCommitment: decodeUint(remaining, 'Remaining commitment'),
				retirementPreview: preview,
			}
		}),
	)
	const bindings = owner === undefined || account.positionId !== 0n || client.getCode === undefined ? undefined : decodeAuctionVaultBindings(await client.getCode({ address: owner, blockNumber }))
	const auctionBidId = bindings?.capital === capitalLedger ? bindings.bidId : undefined
	const forkTime = decodeUint(forkTimeValue, 'Fork time')
	const forkChoiceDeadline = decodeUint(choiceDeadlineValue, 'Fork choice deadline')
	const isExported = decodeBool(exported, 'Invalid position migration status.')
	const isImporting = decodeBool(importing, 'Invalid incoming migration status.')
	const [finalChain, finalBlock] = await Promise.all([client.getChainId(), client.getBlock({ blockNumber })])
	if (finalChain !== chainId || finalBlock.hash !== block.hash) throw new Error('Chain changed while reading capital. Refresh and try again.')
	return {
		auctionBidId,
		chainId,
		blockNumber,
		blockHash: block.hash,
		timestamp: block.timestamp,
		securityPool,
		owner: owner ?? zeroAddress,
		universeId,
		capitalLedger,
		priceFeed: feedValue === zeroAddress ? zeroAddress : decodeAddress(feedValue, 'Shared price feed'),
		commitmentIndex,
		repToken: decodeAddress(tokenValue, 'REP token'),
		acceptedPrice: decodeUint(price, 'Accepted price'),
		conservativePrice: decodeUint(conservative, 'Health price'),
		liquidationPrice: decodeUint(liquidation, 'Liquidation price'),
		ownerConservativePrice: decodeUint(ownerPrice, 'Owner collateral price'),
		oracleExposureLimitAttoEth: decodeUint(exposureLimit, 'Oracle exposure limit'),
		securityMultiplierBps: decodeUint(multiplier, 'Security multiplier'),
		priceValidUntil: decodeUint(validUntil, 'Price expiry', 48),
		priceValid: decodeBool(valid, 'Price validity must be a boolean.'),
		demandAttoEth: decodeUint(demand, 'Demand'),
		totalPledgedAttoRep: decodeUint(totalRep, 'Total pledged REP'),
		totalCommitmentAttoEth: decodeUint(totalK, 'Total commitment'),
		healthyCommitmentAttoEth: decodeUint(healthyK, 'Backed commitment'),
		availableMintCapacityAttoEth: decodeUint(availableCapacity, 'Available mint capacity'),
		totalFreeAttoRep: decodeUint(free, 'Total free REP'),
		currentBatch: decodeUint(current, 'Current reduction batch ID', 96),
		nextBatch: decodeUint(next, 'Next reduction batch ID', 96),
		forkTime,
		forkChoiceDeadline,
		frozen: decodeBool(frozen, 'Invalid capital freeze status.'),
		importing: isImporting,
		exported: isExported,
		ownerAccount: account,
		positions,
		ownerPrincipalAttoRep,
		ownerCommitmentAttoEth: decodeUint(commitment, 'Owner commitment'),
		withdrawableAttoRep,
		accruedFeesAttoEth: account.feesAttoEth + positions.reduce((sum, position) => sum + position.feesAttoEth, 0n),
		accruedFeesAttoRep: account.feesAttoRep + positions.reduce((sum, position) => sum + position.feesAttoRep, 0n),
		economics: {
			purchaseFeeBps: decodeUint(feeBps, 'Purchase fee'),
			annualFeeBps: decodeUint(annualFeeBps, 'Annual fee'),
			minimumPurchaseFeeAttoEth: decodeUint(minimumFee, 'Minimum purchase fee'),
			minimumCommitmentAttoEth: decodeUint(minimumCommitment, 'Minimum commitment'),
			minimumOutcomeRate: decodeUint(minimumOutcomeRate, 'Minimum outcome rate'),
			rewardVestingSeconds: decodeUint(duration, 'Vesting duration', 48),
		},
	}
}
