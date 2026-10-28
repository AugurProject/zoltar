import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type AbiValue, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioEconomicsConfig } from './securityPoolPortfolio.js'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

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
	'function minimumExecutionReserveAttoEth() view returns (uint256)',
	'function rewardVestingSeconds() view returns (uint48)',
	'function reportingFeeAttoEth() view returns (uint256)',
	'function serviceFeeBps() view returns (uint256)',
	'function maximumOracleRewardAttoEth() view returns (uint256)',
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
	'function ownerAccount(address owner) view returns ((uint256 freeAttoRep,uint256 feesAttoEth,uint256 feesAttoRep,uint256 executionReserveAttoEth,uint256 targetHealthFactorBps,uint96 positionId) account)',
	'function ownerCollateral(address owner) view returns (uint256 principal,uint256 commitment,uint256 withdrawable)',
	'function totals() view returns (uint256 rep,uint256 commitment,uint256 healthy)',
	'function currentBatch() view returns (uint96)',
	'function nextBatch() view returns (uint96)',
	'function accountOf(uint96 id) view returns ((address owner,uint96 batch,uint256 rep,uint256 commitment,uint256 maxHealthyPrice,uint256 releasedRep,uint256 ethFees,uint256 repFees,uint256 remainingCommitment) account)',
	'function positionExecutionReserveAttoEth(uint96 id) view returns (uint256)',
	'function liquidationStarted(uint96 id) view returns (uint48)',
	'function depositFor(address owner,uint256 amount)',
	'function depositAndSetHealthTarget(uint256 amount,uint256 targetHealthFactorBps)',
	'function withdrawPrincipal(uint256 amount,address recipient)',
	'function setHealthTarget(uint256 targetHealthFactorBps)',
	'function authorize(uint256 commitment) returns (uint96)',
	'function authorizeWithReport(uint256 reportId,uint256 commitment) returns (uint96)',
	'function fundExecutionReserve(address owner) payable',
	'function withdrawExecutionReserve(uint256 amount)',
	'function requestRetirement(uint96 id,uint256 remainingCommitment)',
	'function cancelRetirement(uint96 id)',
	'function serveRetirement(uint96 id)',
	'function claimEarnings()',
	'function cure(uint96 id) returns (uint256)',
	'function takeOver(uint96 id,uint256 commitment,uint256 minimumAward,uint256 maximumOwnRep) returns (uint96)',
])

type PortfolioCapitalOwner = {
	freeAttoRep: bigint
	feesAttoEth: bigint
	feesAttoRep: bigint
	executionReserveAttoEth: bigint
	targetHealthFactorBps: bigint
	positionId: bigint
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
	executionReserveAttoEth: bigint
	liquidationStarted: bigint
	remainingCommitment: bigint
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
	/** Available reserve includes assigned ETH released by retirement or a missed fork choice. */
	withdrawableExecutionReserveAttoEth: bigint
	/** Fees already credited by the index; the next checkpoint may add earnings. */
	accruedFeesAttoEth: bigint
	accruedFeesAttoRep: bigint
	economics: PortfolioEconomicsConfig
}

function uint(value: unknown, label: string, bits = 256): bigint {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
	return value
}
function positive(value: bigint, label: string, bits = 256) {
	if (uint(value, label, bits) === 0n) throw new Error(`${label} must be positive.`)
	return value
}
function address(value: unknown, label: string): Address {
	if (typeof value !== 'string' || !isAddress(value) || getAddress(value) === zeroAddress) throw new Error(`${label} must be a nonzero address.`)
	return getAddress(value)
}
function bool(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`)
	return value
}
function fields(value: unknown, names: readonly string[]): unknown[] {
	if (Array.isArray(value) && value.length === names.length) return value
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) return names.map(name => Reflect.get(value, name))
	throw new Error('Invalid capital accounting response.')
}
function ownerAccount(value: unknown): PortfolioCapitalOwner {
	const [free, eth, rep, execution, health, id] = fields(value, ['freeAttoRep', 'feesAttoEth', 'feesAttoRep', 'executionReserveAttoEth', 'targetHealthFactorBps', 'positionId'])
	return {
		freeAttoRep: uint(free, 'Free REP'),
		feesAttoEth: uint(eth, 'ETH earnings'),
		feesAttoRep: uint(rep, 'REP earnings'),
		executionReserveAttoEth: uint(execution, 'Execution reserve'),
		targetHealthFactorBps: uint(health, 'Health target'),
		positionId: uint(id, 'Position id', 96),
	}
}

type CapitalRequest = { owner: Address; capitalLedger: Address }
function request(parameters: CapitalRequest, functionName: string, args: readonly AbiValue[] = [], value = 0n) {
	return { account: address(parameters.owner, 'Owner'), to: address(parameters.capitalLedger, 'Capital ledger'), value: uint(value, 'Transaction value'), data: encodeFunctionData({ abi, functionName, args }) }
}

/** Covers every minimum-sized keeper action without draining the remaining position's budget. */
export function requiredPortfolioExecutionReserve(parameters: { commitment: bigint; minimumCommitmentAttoEth: bigint; minimumExecutionReserveAttoEth: bigint }): bigint {
	const commitment = uint(parameters.commitment, 'Commitment')
	const minimum = positive(parameters.minimumCommitmentAttoEth, 'Minimum commitment')
	const reward = positive(parameters.minimumExecutionReserveAttoEth, 'Minimum execution reserve')
	return uint(((commitment + minimum - 1n) / minimum) * reward, 'Required execution reserve')
}

export function buildPortfolioCapitalDepositRequest(parameters: CapitalRequest & { amountAttoRep: bigint }) {
	return request(parameters, 'depositFor', [address(parameters.owner, 'Owner'), positive(parameters.amountAttoRep, 'REP deposit')])
}
export function buildPortfolioCapitalWithdrawPrincipalRequest(parameters: CapitalRequest & { amountAttoRep: bigint; recipient?: Address }) {
	return request(parameters, 'withdrawPrincipal', [positive(parameters.amountAttoRep, 'REP withdrawal'), address(parameters.recipient ?? parameters.owner, 'Recipient')])
}
export function buildPortfolioCapitalSetHealthRequest(parameters: CapitalRequest & { targetHealthFactorBps: bigint }) {
	if (uint(parameters.targetHealthFactorBps, 'Health target') < 10_000n) throw new Error('Health target must be at least 100%.')
	return request(parameters, 'setHealthTarget', [parameters.targetHealthFactorBps])
}
export function buildPortfolioCapitalDepositAndSetHealthRequest(parameters: CapitalRequest & { amountAttoRep: bigint; targetHealthFactorBps: bigint }) {
	if (uint(parameters.targetHealthFactorBps, 'Health target') < 10_000n) throw new Error('Health target must be at least 100%.')
	return request(parameters, 'depositAndSetHealthTarget', [positive(parameters.amountAttoRep, 'REP deposit'), parameters.targetHealthFactorBps])
}
export function buildPortfolioCapitalAuthorizeRequest(parameters: CapitalRequest & { commitment: bigint; reportId?: bigint }) {
	const commitment = positive(parameters.commitment, 'Commitment')
	return parameters.reportId === undefined ? request(parameters, 'authorize', [commitment]) : request(parameters, 'authorizeWithReport', [uint(parameters.reportId, 'Report id'), commitment])
}
export function buildPortfolioCapitalFundExecutionReserveRequest(parameters: CapitalRequest & { amountAttoEth: bigint }) {
	return request(parameters, 'fundExecutionReserve', [address(parameters.owner, 'Owner')], positive(parameters.amountAttoEth, 'Execution funding'))
}
export function buildPortfolioCapitalWithdrawExecutionReserveRequest(parameters: CapitalRequest & { amountAttoEth: bigint }) {
	return request(parameters, 'withdrawExecutionReserve', [positive(parameters.amountAttoEth, 'Execution withdrawal')])
}
export function buildPortfolioCapitalRequestRetirementRequest(parameters: CapitalRequest & { positionId: bigint; remainingCommitment: bigint }) {
	return request(parameters, 'requestRetirement', [positive(parameters.positionId, 'Position id', 96), uint(parameters.remainingCommitment, 'Remaining commitment')])
}
export function buildPortfolioCapitalCancelRetirementRequest(parameters: CapitalRequest & { positionId: bigint }) {
	return request(parameters, 'cancelRetirement', [positive(parameters.positionId, 'Position id', 96)])
}
export function buildPortfolioCapitalServeRetirementRequest(parameters: CapitalRequest & { positionId?: bigint }) {
	return request(parameters, 'serveRetirement', [uint(parameters.positionId ?? 0n, 'Position id', 96)])
}
export function buildPortfolioCapitalClaimEarningsRequest(parameters: CapitalRequest) {
	return request(parameters, 'claimEarnings')
}
/** @public External keeper transaction: `owner` is the submitting keeper; `positionId` may belong to another owner. */
export function buildPortfolioCapitalCureRequest(parameters: CapitalRequest & { positionId: bigint }) {
	return request(parameters, 'cure', [positive(parameters.positionId, 'Position id', 96)])
}
/** @public Keeper takeover: a new receiver commits all idle principal within maximumOwnRep; an existing receiver must share the target cohort. */
export function buildPortfolioCapitalTakeOverRequest(parameters: CapitalRequest & { positionId: bigint; commitment: bigint; minimumAward: bigint; maximumOwnRep: bigint }) {
	return request(parameters, 'takeOver', [positive(parameters.positionId, 'Position id', 96), positive(parameters.commitment, 'Takeover commitment'), uint(parameters.minimumAward, 'Minimum REP award'), uint(parameters.maximumOwnRep, 'Maximum own REP')])
}

/** All reads share one block and inspect only the owner's single position. */
export async function loadPortfolioCapitalSnapshot(parameters: { client: PortfolioReadClient; portfolio: Address; owner: Address; universeId?: bigint; blockNumber?: bigint }): Promise<PortfolioCapitalSnapshot> {
	const { client } = parameters
	const portfolio = address(parameters.portfolio, 'Portfolio')
	const owner = address(parameters.owner, 'Owner')
	const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock(parameters.blockNumber === undefined ? undefined : { blockNumber: parameters.blockNumber })])
	if (!Number.isSafeInteger(chainId) || chainId <= 0 || block.number === undefined || block.hash === undefined) throw new Error('A confirmed block is required for capital accounting.')
	const blockNumber = block.number
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const universeId = uint(parameters.universeId ?? (await read(portfolio, 'originUniverseId')), 'Universe id', 248)
	const [ledgerValue, zoltarValue, settlementValue, feeBps, annualFeeBps, minimumFee, minimumCommitment, minimumReserve, duration, reportingFee, serviceFee, maximumOracleReward, feedValue] = await Promise.all([
		read(portfolio, 'capitalLedger', [universeId]),
		read(portfolio, 'zoltar'),
		read(portfolio, 'settlement'),
		read(portfolio, 'purchaseFeeBps'),
		read(portfolio, 'annualFeeBps'),
		read(portfolio, 'minimumPurchaseFeeAttoEth'),
		read(portfolio, 'minimumCommitmentAttoEth'),
		read(portfolio, 'minimumExecutionReserveAttoEth'),
		read(portfolio, 'rewardVestingSeconds'),
		read(portfolio, 'reportingFeeAttoEth'),
		read(portfolio, 'serviceFeeBps'),
		read(portfolio, 'maximumOracleRewardAttoEth'),
		read(portfolio, 'priceFeed', [universeId]),
	])
	const capitalLedger = address(ledgerValue, 'Capital ledger')
	const zoltar = address(zoltarValue, 'Zoltar')
	const [indexValue, tokenValue, bookValue, price, multiplier, validUntil, valid, demand, free, frozen, importing, exported, ownerValue, collateralValue, totalsValue, forkTimeValue, choiceDeadlineValue, conservative, liquidation, exposureLimit, ownerPrice] = await Promise.all([
		read(capitalLedger, 'commitmentIndex'),
		read(capitalLedger, 'repToken'),
		read(address(settlementValue, 'Settlement engine'), 'ledger'),
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
		feedValue === zeroAddress ? 0n : read(address(feedValue, 'Shared price feed'), 'acceptedExposureLimitAttoEth'),
		read(capitalLedger, 'ownerConservativePrice', [owner]),
	])
	const commitmentIndex = address(indexValue, 'Commitment index')
	const account = ownerAccount(ownerValue)
	const [principal, commitment, withdrawable] = fields(collateralValue, ['principal', 'commitment', 'withdrawable'])
	const ownerPrincipalAttoRep = uint(principal, 'Owner principal')
	const withdrawableAttoRep = uint(withdrawable, 'Withdrawable REP')
	if (withdrawableAttoRep > ownerPrincipalAttoRep) throw new Error('Withdrawal allowance exceeds owner principal.')
	const [totalRep, totalK, healthyK] = fields(totalsValue, ['rep', 'commitment', 'healthy'])
	const [current, next, minimumOutcomeRate] = await Promise.all([read(commitmentIndex, 'currentBatch'), read(commitmentIndex, 'nextBatch'), read(address(bookValue, 'Settlement book'), 'minimumOutcomeExchangeRate')])
	const positions = await Promise.all(
		(account.positionId === 0n ? [] : [account.positionId]).map(async id => {
			const [value, execution, liquidation] = await Promise.all([read(commitmentIndex, 'accountOf', [id]), read(capitalLedger, 'positionExecutionReserveAttoEth', [id]), read(capitalLedger, 'liquidationStarted', [id])])
			const [holder, batch, rep, commitment, maximum, released, eth, repFees, remaining] = fields(value, ['owner', 'batch', 'rep', 'commitment', 'maxHealthyPrice', 'releasedRep', 'ethFees', 'repFees', 'remainingCommitment'])
			if (address(holder, 'Position owner').toLowerCase() !== owner.toLowerCase()) throw new Error('Capital position belongs to another owner.')
			return {
				id,
				owner,
				batch: uint(batch, 'Cohort id', 96),
				rep: uint(rep, 'Pledged REP'),
				commitment: uint(commitment, 'Commitment'),
				maxHealthyPrice: uint(maximum, 'Maximum healthy price'),
				releasedRep: uint(released, 'Retired REP'),
				feesAttoEth: uint(eth, 'ETH earnings'),
				feesAttoRep: uint(repFees, 'REP earnings'),
				executionReserveAttoEth: uint(execution, 'Position execution reserve'),
				liquidationStarted: uint(liquidation, 'Liquidation start', 48),
				remainingCommitment: uint(remaining, 'Remaining commitment'),
			}
		}),
	)
	const forkTime = uint(forkTimeValue, 'Fork time')
	const forkChoiceDeadline = uint(choiceDeadlineValue, 'Fork choice deadline')
	const isExported = bool(exported, 'Exported owner')
	const isImporting = bool(importing, 'Import phase')
	const missedChoice = forkTime !== 0n && block.timestamp >= forkChoiceDeadline
	const withdrawableExecutionReserveAttoEth = isExported || (isImporting && account.positionId !== 0n) ? 0n : account.executionReserveAttoEth + positions.reduce((sum, position) => sum + (position.commitment === 0n || missedChoice ? position.executionReserveAttoEth : 0n), 0n)
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
		priceFeed: feedValue === zeroAddress ? zeroAddress : address(feedValue, 'Shared price feed'),
		commitmentIndex,
		repToken: address(tokenValue, 'REP token'),
		acceptedPrice: uint(price, 'Accepted price'),
		conservativePrice: uint(conservative, 'Conservative price'),
		liquidationPrice: uint(liquidation, 'Liquidation price'),
		ownerConservativePrice: uint(ownerPrice, 'Owner collateral price'),
		oracleExposureLimitAttoEth: uint(exposureLimit, 'Oracle exposure limit'),
		securityMultiplierBps: uint(multiplier, 'Security multiplier'),
		priceValidUntil: uint(validUntil, 'Price expiry', 48),
		priceValid: bool(valid, 'Price validity'),
		demandAttoEth: uint(demand, 'Demand'),
		totalPledgedAttoRep: uint(totalRep, 'Total pledged REP'),
		totalCommitmentAttoEth: uint(totalK, 'Total commitment'),
		healthyCommitmentAttoEth: uint(healthyK, 'Healthy commitment'),
		totalFreeAttoRep: uint(free, 'Total free REP'),
		currentBatch: uint(current, 'Current cohort', 96),
		nextBatch: uint(next, 'Next cohort', 96),
		forkTime,
		forkChoiceDeadline,
		frozen: bool(frozen, 'Frozen capital'),
		importing: isImporting,
		exported: isExported,
		ownerAccount: account,
		positions,
		ownerPrincipalAttoRep,
		ownerCommitmentAttoEth: uint(commitment, 'Owner commitment'),
		withdrawableAttoRep,
		withdrawableExecutionReserveAttoEth,
		accruedFeesAttoEth: account.feesAttoEth + positions.reduce((sum, position) => sum + position.feesAttoEth, 0n),
		accruedFeesAttoRep: account.feesAttoRep + positions.reduce((sum, position) => sum + position.feesAttoRep, 0n),
		economics: {
			purchaseFeeBps: uint(feeBps, 'Purchase fee'),
			annualFeeBps: uint(annualFeeBps, 'Annual fee'),
			minimumPurchaseFeeAttoEth: uint(minimumFee, 'Minimum purchase fee'),
			minimumCommitmentAttoEth: uint(minimumCommitment, 'Minimum commitment'),
			minimumExecutionReserveAttoEth: uint(minimumReserve, 'Minimum execution reserve'),
			minimumOutcomeRate: uint(minimumOutcomeRate, 'Minimum outcome rate'),
			rewardVestingSeconds: uint(duration, 'Vesting duration', 48),
			reportingFeeAttoEth: uint(reportingFee, 'Reporting fee'),
			serviceFeeBps: uint(serviceFee, 'Service fee'),
			maximumOracleRewardAttoEth: uint(maximumOracleReward, 'Maximum oracle reward'),
		},
	}
}
