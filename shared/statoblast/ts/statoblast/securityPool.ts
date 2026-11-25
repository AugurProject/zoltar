import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '../initialReport/oracleInitialReport.js'
export { securityPoolTakeoverSource, securityPoolTakeoverFill, securityPoolTakeoverTransfer } from './securityPoolTakeover.js'
import { type Address, type Hex, encodeAbiParameters, encodeFunctionData, isAddress, isHex, getAddress, parseAbi, parseAbiItem, parseAbiParameters, toEventSelector, zeroAddress } from '@zoltar/core-shared/evm/ethereum'

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
	if (value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
}
function address(value: Address, label: string) {
	if (!isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error(`${label} must be a nonzero address.`)
}

export function validateSecurityPoolEconomics(config: SecurityPoolEconomicsConfig) {
	for (const [name, value] of Object.entries(config)) uint(value, name === 'rewardVestingSeconds' ? 48 : 256, name)
	if (config.purchaseFeeBps > 10_000n) throw new Error('Purchase fee cannot exceed 100%.')
	if (config.annualFeeBps > 10_000n) throw new Error('Annual fee cannot exceed 100%.')
	if (config.minimumCommitmentAttoEth === 0n || config.rewardVestingSeconds === 0n) throw new Error('Minimum commitment and fee vesting duration must be positive.')
	if (config.rewardVestingSeconds > 3650n * 86_400n) throw new Error('Fee vesting duration cannot exceed 3650 days.')
	if (config.rewardVestingSeconds < 86_400n) throw new Error('Fee vesting duration must be at least 24 hours.')
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
	if (parameters.origin.minimumReportCollateral === 0n) throw new Error('Report collateral floor must be positive.')
	address(parameters.owner, 'Owner')
	address(parameters.factory, 'Factory')
	uint(parameters.origin.universeId, 248, 'Origin universe')
	uint(parameters.origin.securityMultiplierBps, 256, 'Security multiplier')
	uint(parameters.origin.reportPriorityFeeAttoEthPerGas, 256, 'Report priority fee')
	if (parameters.origin.securityMultiplierBps < 10_500n) throw new Error('Security multiplier must be at least 10500 BPS.')
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

/** The security pool a factory deployment transaction created, read from that factory's own event. */
export function securityPoolAddressFromDeploymentLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], factory: Address): Address {
	for (const log of logs) {
		const securityPoolTopic = log.topics[1]
		if (log.address.toLowerCase() !== factory.toLowerCase() || log.topics[0] !== securityPoolDeployedTopic || securityPoolTopic === undefined) continue
		return getAddress(`0x${securityPoolTopic.slice(26)}`)
	}
	throw new Error('Security pool deployment event is missing.')
}

/** Each call completes one immutable setup stage; anyone can resume an interrupted setup until the origin universe forks. */
export function buildSecurityPoolPrepareNextRequest(parameters: { caller: Address; securityPool: Address }) {
	address(parameters.caller, 'Caller')
	address(parameters.securityPool, 'Security pool')
	return { account: parameters.caller, to: parameters.securityPool, data: encodeFunctionData({ abi: parseAbi(['function prepareNext()']), functionName: 'prepareNext' }), value: 0n }
}

/** @public Unsigned transaction export for external smart-account execution flows. */
export function exportSecurityPoolTransaction(parameters: { chainId: number; request: { account: Address; to: Address; data: Hex; value: bigint } }) {
	if (!Number.isSafeInteger(parameters.chainId) || parameters.chainId <= 0) throw new Error('Choose a valid chain id.')
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
	minimumSecurityPoolAuctionRepPerLot,
	quoteSecurityPoolAuctionBid,
	buildSecurityPoolAuctionOpenRequest,
	buildSecurityPoolAuctionBidRequest,
	buildSecurityPoolAuctionMaterializeRequest,
	buildSecurityPoolAuctionRefundCreditRequest,
	buildSecurityPoolAuctionRefundWithdrawRequest,
	quoteSecurityPoolAuctionRefundClaim,
	buildSecurityPoolAuctionRefundClaimRequest,
	buildSecurityPoolAuctionVaultExecuteRequest,
	buildSecurityPoolAuctionVaultDepositRequest,
	type SecurityPoolAuctionBid,
} from './securityPoolRepairAuction.js'
/** @public Vault clone code and address derivation for external verifiers, fixtures and smart-account tooling. */
export { auctionVaultCreationCode, auctionVaultRuntimeCode } from './securityPoolRepairAuctionVaultClones.js'
export { decodeAuctionVaultBindings, predictAuctionVaultAddress, verifyAuctionVaultCode } from './securityPoolRepairAuctionVaultClones.js'
export { boundCloneImplementation, boundCloneRuntimeCode, verifyBoundCloneCode, universeCloneBindings } from './securityPoolBoundClone.js'
