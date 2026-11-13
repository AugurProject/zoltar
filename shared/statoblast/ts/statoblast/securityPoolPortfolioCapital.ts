import { encodeFunctionData, parseAbi, zeroAddress, type AbiValue, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioEconomicsConfig } from './securityPoolPortfolio.js'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'
import { decodeAddress, decodeBool, decodeFields, decodeUint } from './securityPoolPortfolioDecoding.js'

const abi = parseAbi([
	'function originUniverseId() view returns (uint248)',
	'function capitalLedger(uint248 universeId) view returns (address)',
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
	'function depositFor(address owner,uint256 amount)',
	'function depositAndSetHealthTarget(uint256 amount,uint256 targetHealthFactorBps)',
	'function withdrawPrincipal(uint256 amount,address recipient)',
	'function setHealthTarget(uint256 targetHealthFactorBps)',
	'function setCommitment(uint256 commitment) returns (uint96)',
	'function setCommitmentWithReport(uint256 reportId,uint256 commitment) returns (uint96)',
	'function serveRetirement(uint96 id)',
	'function claimEarnings()',
	'function takeOver(uint96 id,uint256 commitment,uint256 minimumAward,uint256 maximumOwnRep) returns (uint96)',
	'function takeOverWithBounds(uint96 id,uint256 commitment,uint256 minimumAward,uint256 maximumOwnRep,(uint256 maximumOwnerPrincipal,uint256 maximumOwnerCommitment,uint256 expectedTargetHealthFactorBps,uint256 expectedAcceptedPriceEpoch,uint96 expectedSourceBatch) bounds) returns (uint96)',
])

type PortfolioCapitalOwner = {
	freeAttoRep: bigint
	feesAttoEth: bigint
	feesAttoRep: bigint
	targetHealthFactorBps: bigint
	positionId: bigint
}
type PortfolioRetirementPreview = {
	status: 'not-retiring' | 'imports-open' | 'demand-exceeds-healthy' | 'earlier-requests' | 'insufficient-spare' | 'ready'
	effectiveCurrentBatch: bigint
	healthyCommitment: bigint
	spareCommitment: bigint
	queuedAheadCommitment: bigint
	commitmentReduction: bigint
	releasedRep: bigint
}
type PortfolioTakeoverBounds = {
	maximumOwnerPrincipal: bigint
	maximumOwnerCommitment: bigint
	expectedTargetHealthFactorBps: bigint
	expectedAcceptedPriceEpoch: bigint
	expectedSourceBatch: bigint
}
type PortfolioCapitalPosition = {
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
	remainingCommitment: bigint
	/** Advisory at this snapshot block, before the next ledger checkpoint. */
	retirementPreview: PortfolioRetirementPreview | undefined
}
export type PortfolioCapitalSnapshot = {
	chainId: number
	blockNumber: bigint
	blockHash: Hex
	timestamp: bigint
	portfolio: Address
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
	totalFreeAttoRep: bigint
	currentBatch: bigint
	nextBatch: bigint
	forkTime: bigint
	forkChoiceDeadline: bigint
	frozen: boolean
	importing: boolean
	exported: boolean
	ownerAccount: PortfolioCapitalOwner
	positions: PortfolioCapitalPosition[]
	/** All deposited principal, including lazily released retirement principal. */
	ownerPrincipalAttoRep: bigint
	ownerCommitmentAttoEth: bigint
	/** Canonical safe withdrawal allowance at the snapshot block. */
	withdrawableAttoRep: bigint
	/** Fees already credited by the index; the next checkpoint may add earnings. */
	accruedFeesAttoEth: bigint
	accruedFeesAttoRep: bigint
	economics: PortfolioEconomicsConfig
}

function positive(value: bigint, label: string, bits = 256) {
	if (decodeUint(value, label, bits) === 0n) throw new Error(`${label} must be positive.`)
	return value
}
function retirementStatus(value: unknown): PortfolioRetirementPreview['status'] {
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
			throw new Error('Invalid retirement preview status.')
	}
}
function retirementPreview(value: unknown): PortfolioRetirementPreview {
	const [status, batch, healthy, spare, ahead, reduction, rep] = decodeFields(value, ['status', 'effectiveCurrentBatch', 'healthyCommitment', 'spareCommitment', 'queuedAheadCommitment', 'commitmentReduction', 'releasedRep'], 'Invalid capital accounting response.')
	return {
		status: retirementStatus(status),
		effectiveCurrentBatch: decodeUint(batch, 'Effective current cohort', 96),
		healthyCommitment: decodeUint(healthy, 'Preview healthy commitment'),
		spareCommitment: decodeUint(spare, 'Preview spare commitment'),
		queuedAheadCommitment: decodeUint(ahead, 'Earlier reserved reductions'),
		commitmentReduction: decodeUint(reduction, 'Requested commitment reduction'),
		releasedRep: decodeUint(rep, 'Requested REP release'),
	}
}
function ownerAccount(value: unknown): PortfolioCapitalOwner {
	const [free, eth, rep, health, id] = decodeFields(value, ['freeAttoRep', 'feesAttoEth', 'feesAttoRep', 'targetHealthFactorBps', 'positionId'], 'Invalid capital accounting response.')
	return {
		freeAttoRep: decodeUint(free, 'Free REP'),
		feesAttoEth: decodeUint(eth, 'ETH earnings'),
		feesAttoRep: decodeUint(rep, 'REP earnings'),
		targetHealthFactorBps: decodeUint(health, 'Health target'),
		positionId: decodeUint(id, 'Position id', 96),
	}
}

type CapitalRequest = { owner: Address; capitalLedger: Address }
function request(parameters: CapitalRequest, functionName: string, args: readonly AbiValue[] = [], value = 0n) {
	return { account: decodeAddress(parameters.owner, 'Owner'), to: decodeAddress(parameters.capitalLedger, 'Capital ledger'), value: decodeUint(value, 'Transaction value'), data: encodeFunctionData({ abi, functionName, args }) }
}

export function buildPortfolioCapitalDepositRequest(parameters: CapitalRequest & { amountAttoRep: bigint }) {
	return request(parameters, 'depositFor', [decodeAddress(parameters.owner, 'Owner'), positive(parameters.amountAttoRep, 'REP deposit')])
}
export function buildPortfolioCapitalWithdrawPrincipalRequest(parameters: CapitalRequest & { amountAttoRep: bigint; recipient?: Address }) {
	return request(parameters, 'withdrawPrincipal', [positive(parameters.amountAttoRep, 'REP withdrawal'), decodeAddress(parameters.recipient ?? parameters.owner, 'Recipient')])
}
export function buildPortfolioCapitalSetHealthRequest(parameters: CapitalRequest & { targetHealthFactorBps: bigint }) {
	if (decodeUint(parameters.targetHealthFactorBps, 'Health target') < 10_000n) throw new Error('Health target must be at least 100%.')
	return request(parameters, 'setHealthTarget', [parameters.targetHealthFactorBps])
}
export function buildPortfolioCapitalDepositAndSetHealthRequest(parameters: CapitalRequest & { amountAttoRep: bigint; targetHealthFactorBps: bigint }) {
	if (decodeUint(parameters.targetHealthFactorBps, 'Health target') < 10_000n) throw new Error('Health target must be at least 100%.')
	return request(parameters, 'depositAndSetHealthTarget', [positive(parameters.amountAttoRep, 'REP deposit'), parameters.targetHealthFactorBps])
}
/**
 * Sets the owner's whole commitment. Raising or keeping it applies at once; lowering it cures any unbacked part at once and
 * queues the rest for retirement. A report id prices growth only.
 */
export function buildPortfolioCapitalSetCommitmentRequest(parameters: CapitalRequest & { commitment: bigint; reportId?: bigint }) {
	const commitment = decodeUint(parameters.commitment, 'Commitment')
	return parameters.reportId === undefined ? request(parameters, 'setCommitment', [commitment]) : request(parameters, 'setCommitmentWithReport', [decodeUint(parameters.reportId, 'Report id'), positive(commitment, 'Commitment')])
}
export function buildPortfolioCapitalServeRetirementRequest(parameters: CapitalRequest & { positionId?: bigint }) {
	return request(parameters, 'serveRetirement', [decodeUint(parameters.positionId ?? 0n, 'Position id', 96)])
}
export function buildPortfolioCapitalClaimEarningsRequest(parameters: CapitalRequest) {
	return request(parameters, 'claimEarnings')
}
/** @public Keeper takeover: a new receiver commits all idle principal within maximumOwnRep; an existing receiver must share the target cohort. */
export function buildPortfolioCapitalTakeOverRequest(parameters: CapitalRequest & { positionId: bigint; commitment: bigint; minimumAward: bigint; maximumOwnRep: bigint }) {
	return request(parameters, 'takeOver', [positive(parameters.positionId, 'Position id', 96), positive(parameters.commitment, 'Takeover commitment'), decodeUint(parameters.minimumAward, 'Minimum REP award'), decodeUint(parameters.maximumOwnRep, 'Maximum own REP')])
}

/** Bind an automated acquisition to its quoted price epoch, owner policy and final exposure. */
export function buildPortfolioCapitalTakeOverWithBoundsRequest(parameters: CapitalRequest & { positionId: bigint; commitment: bigint; minimumAward: bigint; maximumOwnRep: bigint; bounds: PortfolioTakeoverBounds }) {
	const bounds = parameters.bounds
	if (decodeUint(bounds.expectedTargetHealthFactorBps, 'Expected health target') < 10_000n) throw new Error('Health target must be at least 100%.')
	return request(parameters, 'takeOverWithBounds', [
		positive(parameters.positionId, 'Position id', 96),
		positive(parameters.commitment, 'Takeover commitment'),
		decodeUint(parameters.minimumAward, 'Minimum REP award'),
		decodeUint(parameters.maximumOwnRep, 'Maximum own REP'),
		[
			decodeUint(bounds.maximumOwnerPrincipal, 'Maximum owner principal'),
			decodeUint(bounds.maximumOwnerCommitment, 'Maximum owner commitment'),
			bounds.expectedTargetHealthFactorBps,
			decodeUint(bounds.expectedAcceptedPriceEpoch, 'Expected price epoch'),
			decodeUint(bounds.expectedSourceBatch, 'Expected source cohort', 96),
		],
	])
}

/**
 * What `claimEarnings` pays at the snapshot block. It checkpoints first, so a passive owner's earnings stay uncredited
 * until then. One `eth_call` runs that checkpoint and the reads that depend on it without keeping any state change.
 */
export async function loadPortfolioClaimableEarnings(
	snapshot: Pick<PortfolioCapitalSnapshot, 'blockNumber' | 'capitalLedger' | 'commitmentIndex' | 'owner' | 'ownerAccount'>,
	multicall: (contracts: readonly { address: Address; abi: typeof abi; functionName: string; args: readonly AbiValue[] }[], blockNumber: bigint) => Promise<readonly unknown[]>,
) {
	const positionId = snapshot.ownerAccount.positionId
	const [, ownerValue, positionValue] = await multicall(
		[{ address: snapshot.capitalLedger, abi, functionName: 'checkpoint', args: [] }, { address: snapshot.capitalLedger, abi, functionName: 'ownerAccount', args: [snapshot.owner] }, ...(positionId === 0n ? [] : [{ address: snapshot.commitmentIndex, abi, functionName: 'accountOf', args: [positionId] }])],
		snapshot.blockNumber,
	)
	const account = ownerAccount(ownerValue)
	if (positionValue === undefined) return { attoEth: account.feesAttoEth, attoRep: account.feesAttoRep }
	const [eth, rep] = decodeFields(positionValue, ['ethFees', 'repFees'], 'Invalid capital accounting response.')
	return { attoEth: account.feesAttoEth + decodeUint(eth, 'ETH earnings'), attoRep: account.feesAttoRep + decodeUint(rep, 'REP earnings') }
}

/** All reads share one block and inspect only the owner's single position. */
export async function loadPortfolioCapitalSnapshot(parameters: { client: PortfolioReadClient; portfolio: Address; owner: Address; universeId?: bigint; blockNumber?: bigint }): Promise<PortfolioCapitalSnapshot> {
	const { client } = parameters
	const portfolio = decodeAddress(parameters.portfolio, 'Portfolio')
	const owner = decodeAddress(parameters.owner, 'Owner')
	const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock(parameters.blockNumber === undefined ? undefined : { blockNumber: parameters.blockNumber })])
	if (!Number.isSafeInteger(chainId) || chainId <= 0 || block.number === undefined || block.hash === undefined) throw new Error('A confirmed block is required for capital accounting.')
	const blockNumber = block.number
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const universeId = decodeUint(parameters.universeId ?? (await read(portfolio, 'originUniverseId')), 'Universe id', 248)
	const [ledgerValue, zoltarValue, settlementValue, feeBps, annualFeeBps, minimumFee, minimumCommitment, duration, feedValue] = await Promise.all([
		read(portfolio, 'capitalLedger', [universeId]),
		read(portfolio, 'zoltar'),
		read(portfolio, 'settlement'),
		read(portfolio, 'purchaseFeeBps'),
		read(portfolio, 'annualFeeBps'),
		read(portfolio, 'minimumPurchaseFeeAttoEth'),
		read(portfolio, 'minimumCommitmentAttoEth'),
		read(portfolio, 'rewardVestingSeconds'),
		read(portfolio, 'priceFeed', [universeId]),
	])
	const capitalLedger = decodeAddress(ledgerValue, 'Capital ledger')
	const zoltar = decodeAddress(zoltarValue, 'Zoltar')
	const [indexValue, tokenValue, bookValue, price, multiplier, validUntil, valid, demand, free, frozen, importing, exported, ownerValue, collateralValue, totalsValue, forkTimeValue, choiceDeadlineValue, conservative, liquidation, exposureLimit, ownerPrice] = await Promise.all([
		read(capitalLedger, 'commitmentIndex'),
		read(capitalLedger, 'repToken'),
		read(decodeAddress(settlementValue, 'Settlement engine'), 'ledger'),
		read(capitalLedger, 'acceptedPrice'),
		read(capitalLedger, 'securityMultiplierBps'),
		read(capitalLedger, 'priceValidUntil'),
		read(capitalLedger, 'isPriceValid'),
		read(capitalLedger, 'demandAttoEth'),
		read(capitalLedger, 'totalFreeAttoRep'),
		read(capitalLedger, 'frozen'),
		read(capitalLedger, 'importing'),
		read(capitalLedger, 'exported', [owner]),
		read(capitalLedger, 'ownerAccount', [owner]),
		read(capitalLedger, 'ownerCollateral', [owner]),
		read(capitalLedger, 'totals'),
		read(zoltar, 'getForkTime', [universeId]),
		read(zoltar, 'getForkChoiceDeadline', [universeId]),
		read(capitalLedger, 'conservativePrice'),
		read(capitalLedger, 'liquidationPrice'),
		feedValue === zeroAddress ? 0n : read(decodeAddress(feedValue, 'Shared price feed'), 'acceptedExposureLimitAttoEth'),
		read(capitalLedger, 'ownerConservativePrice', [owner]),
	])
	const commitmentIndex = decodeAddress(indexValue, 'Commitment index')
	const account = ownerAccount(ownerValue)
	const [principal, commitment, withdrawable] = decodeFields(collateralValue, ['principal', 'commitment', 'withdrawable'], 'Invalid capital accounting response.')
	const ownerPrincipalAttoRep = decodeUint(principal, 'Owner principal')
	const withdrawableAttoRep = decodeUint(withdrawable, 'Withdrawable REP')
	if (withdrawableAttoRep > ownerPrincipalAttoRep) throw new Error('Withdrawal allowance exceeds owner principal.')
	const [totalRep, totalK, healthyK] = decodeFields(totalsValue, ['rep', 'commitment', 'healthy'], 'Invalid capital accounting response.')
	const [current, next, minimumOutcomeRate] = await Promise.all([read(commitmentIndex, 'currentBatch'), read(commitmentIndex, 'nextBatch'), read(decodeAddress(bookValue, 'Settlement book'), 'minimumOutcomeExchangeRate')])
	const positions = await Promise.all(
		(account.positionId === 0n ? [] : [account.positionId]).map(async id => {
			const [value, liquidation] = await Promise.all([read(commitmentIndex, 'accountOf', [id]), read(capitalLedger, 'liquidationStarted', [id])])
			const [holder, batch, rep, commitment, maximum, released, eth, repFees, remaining] = decodeFields(value, ['owner', 'batch', 'rep', 'commitment', 'maxHealthyPrice', 'releasedRep', 'ethFees', 'repFees', 'remainingCommitment'], 'Invalid capital accounting response.')
			if (decodeAddress(holder, 'Position owner').toLowerCase() !== owner.toLowerCase()) throw new Error('Capital position belongs to another owner.')
			const cohort = decodeUint(batch, 'Cohort id', 96)
			const liveCommitment = decodeUint(commitment, 'Commitment')
			const preview = cohort !== 0n && liveCommitment !== 0n ? retirementPreview(await read(commitmentIndex, 'previewRetirement', [id, decodeUint(conservative, 'Conservative price'), decodeUint(demand, 'Demand')])) : undefined
			return {
				id,
				owner,
				batch: cohort,
				rep: decodeUint(rep, 'Pledged REP'),
				commitment: liveCommitment,
				maxHealthyPrice: decodeUint(maximum, 'Maximum healthy price'),
				releasedRep: decodeUint(released, 'Retired REP'),
				feesAttoEth: decodeUint(eth, 'ETH earnings'),
				feesAttoRep: decodeUint(repFees, 'REP earnings'),
				liquidationStarted: decodeUint(liquidation, 'Liquidation start', 48),
				remainingCommitment: decodeUint(remaining, 'Remaining commitment'),
				retirementPreview: preview,
			}
		}),
	)
	const forkTime = decodeUint(forkTimeValue, 'Fork time')
	const forkChoiceDeadline = decodeUint(choiceDeadlineValue, 'Fork choice deadline')
	const isExported = decodeBool(exported, 'Exported owner must be a boolean.')
	const isImporting = decodeBool(importing, 'Import phase must be a boolean.')
	const [finalChain, finalBlock] = await Promise.all([client.getChainId(), client.getBlock({ blockNumber })])
	if (finalChain !== chainId || finalBlock.hash !== block.hash) throw new Error('Chain changed while reading capital. Refresh and try again.')
	return {
		chainId,
		blockNumber,
		blockHash: block.hash,
		timestamp: block.timestamp,
		portfolio,
		owner,
		universeId,
		capitalLedger,
		priceFeed: feedValue === zeroAddress ? zeroAddress : decodeAddress(feedValue, 'Shared price feed'),
		commitmentIndex,
		repToken: decodeAddress(tokenValue, 'REP token'),
		acceptedPrice: decodeUint(price, 'Accepted price'),
		conservativePrice: decodeUint(conservative, 'Conservative price'),
		liquidationPrice: decodeUint(liquidation, 'Liquidation price'),
		ownerConservativePrice: decodeUint(ownerPrice, 'Owner collateral price'),
		oracleExposureLimitAttoEth: decodeUint(exposureLimit, 'Oracle exposure limit'),
		securityMultiplierBps: decodeUint(multiplier, 'Security multiplier'),
		priceValidUntil: decodeUint(validUntil, 'Price expiry', 48),
		priceValid: decodeBool(valid, 'Price validity must be a boolean.'),
		demandAttoEth: decodeUint(demand, 'Demand'),
		totalPledgedAttoRep: decodeUint(totalRep, 'Total pledged REP'),
		totalCommitmentAttoEth: decodeUint(totalK, 'Total commitment'),
		healthyCommitmentAttoEth: decodeUint(healthyK, 'Healthy commitment'),
		totalFreeAttoRep: decodeUint(free, 'Total free REP'),
		currentBatch: decodeUint(current, 'Current cohort', 96),
		nextBatch: decodeUint(next, 'Next cohort', 96),
		forkTime,
		forkChoiceDeadline,
		frozen: decodeBool(frozen, 'Frozen capital must be a boolean.'),
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
