import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, ORACLE_ESCALATION_HALT_MULTIPLIER_BPS } from '../initialReport/oracleInitialReport.js'
export { securityPoolTakeoverSource, securityPoolTakeoverFill, securityPoolTakeoverTransfer } from './securityPoolTakeover.js'
import { type Address, type Hex, encodeAbiParameters, encodeFunctionData, formatUnits, isAddress, isHex, getAddress, parseAbi, parseAbiItem, parseAbiParameters, toEventSelector, zeroAddress } from '@zoltar/core-shared/evm/ethereum'

export type SecurityPoolOriginConfig = {
	collateralToken: Address
	minimumReportCollateral: bigint
	universeId: bigint
	securityMultiplierBps: bigint
	reportPriorityFeeAttoEthPerGas: bigint
}
export type SecurityPoolEconomicsConfig = {
	purchaseFeeBps: bigint
	annualFeeBps: bigint
	minimumPurchaseFeeAttoEth: bigint
	minimumCommitmentAttoEth: bigint
	minimumOutcomeRate: bigint
	rewardVestingSeconds: bigint
}

function uint(value: bigint, bits: number, label: string) {
	if (value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} is out of range.`)
}
function address(value: Address, label: string) {
	if (!isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error(`${label} must be a nonzero address.`)
}

export const minimumSecurityMultiplierBps = 10_500n
const maximumFeeBps = 10_000n
const secondsPerDay = 86_400n
const maximumVestingDays = 3650n

export function validateSecurityPoolEconomics(config: SecurityPoolEconomicsConfig) {
	uint(config.purchaseFeeBps, 256, 'Purchase fee')
	uint(config.annualFeeBps, 256, 'Annual fee')
	uint(config.minimumPurchaseFeeAttoEth, 256, 'Minimum purchase fee')
	uint(config.minimumCommitmentAttoEth, 256, 'Minimum commitment')
	uint(config.minimumOutcomeRate, 256, 'Minimum outcome exchange rate')
	uint(config.rewardVestingSeconds, 48, 'Fee vesting duration')
	if (config.minimumPurchaseFeeAttoEth >= 1n << 128n) throw new Error('Minimum purchase fee exceeds fee stream capacity.')
	if (config.purchaseFeeBps > maximumFeeBps) throw new Error(`Purchase fee cannot exceed ${formatUnits(maximumFeeBps, 2)}%.`)
	if (config.annualFeeBps > maximumFeeBps) throw new Error(`Annual fee cannot exceed ${formatUnits(maximumFeeBps, 2)}%.`)
	if (config.minimumCommitmentAttoEth === 0n || config.rewardVestingSeconds === 0n) throw new Error('Minimum commitment and fee vesting duration must be positive.')
	if (config.rewardVestingSeconds > maximumVestingDays * secondsPerDay) throw new Error(`Fee vesting duration cannot exceed ${maximumVestingDays} days.`)
	if (config.rewardVestingSeconds < secondsPerDay) throw new Error(`Fee vesting duration must be at least ${secondsPerDay / 3_600n} hours.`)
	if (config.minimumOutcomeRate === 0n || config.minimumOutcomeRate > 10n ** 18n) throw new Error('Minimum outcome exchange rate must be positive and at most one.')
}

const securityPoolFactoryAbi = parseAbi(['function deploySecurityPool(bytes creationCode, bytes configuration) returns (address securityPool)'])
// Every member is a static word, so the constructor's two structs encode exactly as this flat list.
const securityPoolConfigurationParameters = parseAbiParameters('address, uint256, uint248, uint256, uint256, uint256, address, uint256, uint256, uint256, uint256, uint256, uint48')

/**
 * The canonical factory deploys every security pool from its pinned creation code and module deployers, so the creator
 * supplies only the configuration. `creationCode` is the linked security pool creation code; it is injected so this SDK
 * does not depend on generated contracts, and the factory rejects any other code.
 */
export function buildSecurityPoolDeploymentRequest(parameters: { owner: Address; factory: Address; origin: SecurityPoolOriginConfig; maximumQuestionHorizonSeconds: bigint; questionAdmissionPolicy: Address; economics: SecurityPoolEconomicsConfig; creationCode: Hex }) {
	address(parameters.origin.collateralToken, 'Collateral token')
	uint(parameters.origin.minimumReportCollateral, 128, 'Report collateral floor')
	if ((parameters.origin.minimumReportCollateral * ORACLE_ESCALATION_HALT_MULTIPLIER_BPS) / 10_000n >= 1n << 128n) throw new Error('Report collateral floor exceeds oracle halt limit.')
	if (parameters.economics.minimumCommitmentAttoEth > 100n * ((1n << 128n) - 1n - parameters.origin.minimumReportCollateral)) throw new Error('Minimum commitment exceeds report exposure capacity.')
	let divisor = parameters.origin.securityMultiplierBps
	let remainder = 10_000n
	while (remainder !== 0n) [divisor, remainder] = [remainder, divisor % remainder]
	const maximumRep = 11_000_000n * 10n ** 18n
	if (parameters.origin.securityMultiplierBps > maximumRep * 10_000n || parameters.origin.securityMultiplierBps / divisor > maximumRep) throw new Error('Security multiplier exceeds the supported REP supply limits.')
	if (parameters.origin.minimumReportCollateral === 0n) throw new Error('Report collateral floor must be positive.')
	address(parameters.owner, 'Owner')
	address(parameters.factory, 'Security pool deployment contract')
	uint(parameters.origin.universeId, 248, 'Origin universe')
	uint(parameters.origin.securityMultiplierBps, 256, 'Security multiplier')
	uint(parameters.origin.reportPriorityFeeAttoEthPerGas, 256, 'Report priority fee')
	if (parameters.origin.securityMultiplierBps < minimumSecurityMultiplierBps) throw new Error(`Security multiplier must be at least ${formatUnits(minimumSecurityMultiplierBps, 2)}%.`)
	if (parameters.origin.reportPriorityFeeAttoEthPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) throw new Error('Initial report priority fee exceeds OpenOracle limits.')
	if (parameters.origin.reportPriorityFeeAttoEthPerGas === 0n) throw new Error('Report priority fee must be positive.')
	address(parameters.questionAdmissionPolicy, 'Question rules')
	uint(parameters.maximumQuestionHorizonSeconds, 48, 'Question horizon')
	if (parameters.maximumQuestionHorizonSeconds === 0n) throw new Error('Question horizon must be positive.')
	validateSecurityPoolEconomics(parameters.economics)
	if (!isHex(parameters.creationCode, { strict: true }) || parameters.creationCode.length <= 2 || parameters.creationCode.length % 2 !== 0) throw new Error('Security pool creation code must contain whole hexadecimal bytes.')
	const { origin, economics } = parameters
	const configuration = encodeAbiParameters(securityPoolConfigurationParameters, [
		origin.collateralToken,
		origin.minimumReportCollateral,
		origin.universeId,
		origin.securityMultiplierBps,
		origin.reportPriorityFeeAttoEthPerGas,
		parameters.maximumQuestionHorizonSeconds,
		parameters.questionAdmissionPolicy,
		economics.purchaseFeeBps,
		economics.annualFeeBps,
		economics.minimumPurchaseFeeAttoEth,
		economics.minimumCommitmentAttoEth,
		economics.minimumOutcomeRate,
		economics.rewardVestingSeconds,
	])
	return { account: parameters.owner, to: parameters.factory, value: 0n, data: encodeFunctionData({ abi: securityPoolFactoryAbi, functionName: 'deploySecurityPool', args: [parameters.creationCode, configuration] }) }
}

const securityPoolDeployedTopic = toEventSelector(parseAbiItem('event SecurityPoolDeployed(address indexed securityPool, address indexed creator)'))

export class MissingSecurityPoolDeploymentEventError extends Error {
	constructor() {
		super('Security pool deployment event is missing.')
	}
}

/** The security pool a factory deployment transaction created, read from that factory's own event. */
export function securityPoolAddressFromDeploymentLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], factory: Address): Address {
	for (const log of logs) {
		const securityPoolTopic = log.topics[1]
		if (log.address.toLowerCase() !== factory.toLowerCase() || log.topics[0] !== securityPoolDeployedTopic || securityPoolTopic === undefined) continue
		return getAddress(`0x${securityPoolTopic.slice(26)}`)
	}
	throw new MissingSecurityPoolDeploymentEventError()
}

/** Each call completes one immutable setup stage; anyone can resume an interrupted setup until the origin universe forks. */
export function buildSecurityPoolPrepareNextRequest(parameters: { caller: Address; securityPool: Address }) {
	address(parameters.caller, 'Caller')
	address(parameters.securityPool, 'Security pool')
	return { account: parameters.caller, to: parameters.securityPool, data: encodeFunctionData({ abi: parseAbi(['function prepareNext()']), functionName: 'prepareNext' }), value: 0n }
}

/** @public Unsigned transaction export for external smart-account execution flows. */
export function exportSecurityPoolTransaction(parameters: { chainId: number; request: { account: Address; to: Address; data: Hex; value: bigint } }) {
	if (!Number.isSafeInteger(parameters.chainId) || parameters.chainId <= 0) throw new Error('Choose a valid chain ID.')
	address(parameters.request.account, 'Owner')
	address(parameters.request.to, 'Transaction target')
	uint(parameters.request.value, 256, 'Transaction value')
	if (!isHex(parameters.request.data, { strict: true }) || parameters.request.data.length % 2 !== 0) throw new Error('Call data must contain whole hexadecimal bytes.')
	return { chainId: parameters.chainId, from: parameters.request.account, to: parameters.request.to, data: parameters.request.data, value: parameters.request.value.toString() }
}

export type { SecurityPoolReadClient } from './securityPoolRead.js'
export {
	buildSecurityPoolCapitalDepositRequest,
	buildSecurityPoolCapitalWithdrawPrincipalRequest,
	buildSecurityPoolCapitalSetHealthRequest,
	buildSecurityPoolCapitalDepositAndSetHealthRequest,
	buildSecurityPoolCapitalSetCommitmentRequest,
	buildSecurityPoolCapitalServeRetirementRequest,
	buildSecurityPoolCapitalClaimEarningsRequest,
	loadSecurityPoolCapitalSnapshot,
	loadSecurityPoolUnclaimedRepairAuctionBids,
	minimumSecurityPoolHealthFactorBps,
	loadSecurityPoolClaimableEarnings,
	type SecurityPoolCapitalSnapshot,
} from './securityPoolCapital.js'
/** @public Explicitly bounded commitment takeovers for external keeper implementations. */
export { buildSecurityPoolCapitalTakeOverRequest } from './securityPoolCapital.js'
export { buildSecurityPoolCapitalTakeOverWithBoundsRequest } from './securityPoolCapital.js'
export { buildSecurityPoolCapitalCureRequest } from './securityPoolCapital.js'
export { buildSecurityPoolMintRequest, loadSecurityPoolMintQuote, securityPoolRecoveryMintBudget } from './securityPoolMint.js'
/** @public External clients can register an admitted question independently of purchasing shares. */
export { buildSecurityPoolAddQuestionRequest } from './securityPoolMint.js'
export {
	buildSecurityPoolForkChoiceRequest,
	buildSecurityPoolForkPreparationRequest,
	buildSecurityPoolForkStartRequest,
	buildSecurityPoolForkFinalizeRequest,
	buildSecurityPoolForkRecoveryRequest,
	buildSecurityPoolRecoveryRightsTransferRequest,
	loadSecurityPoolForkSnapshot,
	type SecurityPoolForkSnapshot,
} from './securityPoolFork.js'
/** @public Schemas for external clients that attach owner operations to price reports. */
export type { SecurityPoolReportOperation, SecurityPoolReportOperations } from './securityPoolPrice.js'
export {
	/** @public Price-report sponsorship with attached owner operations, for external clients. */
	buildSecurityPoolPriceOperationsRequest,
	loadSecurityPoolPriceSnapshot,
	quoteSecurityPoolPriceFunding,
	buildSecurityPoolPricePreparationRequest,
	buildSecurityPoolPriceRequest,
	buildSecurityPoolPriceApprovalRequest,
	buildSecurityPoolPriceWrapRequest,
	type SecurityPoolPriceSnapshot,
} from './securityPoolPrice.js'
export {
	loadSecurityPoolAuctionSnapshot,
	securityPoolAuctionOpeningReason,
	quoteSecurityPoolAuctionBid,
	buildSecurityPoolAuctionOpenRequest,
	buildSecurityPoolAuctionBidRequest,
	buildSecurityPoolAuctionMaterializeRequest,
	buildSecurityPoolAuctionClaimAllRequest,
	MAX_REPAIR_AUCTION_CLAIM_BATCH,
	securityPoolAuctionClaimBatch,
	securityPoolAuctionClaimReason,
	loadSecurityPoolAuctionClaimableBidIds,
	buildSecurityPoolAuctionRefundCreditRequest,
	buildSecurityPoolAuctionRefundWithdrawRequest,
	quoteSecurityPoolAuctionRefundClaim,
	buildSecurityPoolAuctionRefundClaimRequest,
	type SecurityPoolAuctionBid,
} from './securityPoolRepairAuction.js'
export { boundCloneImplementation, boundCloneRuntimeCode, verifyBoundCloneCode, universeCloneBindings } from './securityPoolBoundClone.js'
