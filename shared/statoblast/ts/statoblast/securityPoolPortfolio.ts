import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '../initialReport/oracleInitialReport.js'
export { portfolioTakeoverSource, portfolioTakeoverFill, portfolioTakeoverTransfer } from './securityPoolPortfolioTakeover.js'
import { type Address, type Hex, encodeAbiParameters, encodeFunctionData, isAddress, isHex, getAddress, parseAbi, parseAbiItem, parseAbiParameters, toEventSelector, zeroAddress } from '@zoltar/core-shared/evm/ethereum'

export type PortfolioOriginConfig = {
	collateralToken: Address
	minimumReportCollateral: bigint
	universeId: bigint
	securityMultiplierBps: bigint
	reportPriorityFeeAttoEthPerGas: bigint
}
export type PortfolioEconomicsConfig = {
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

export function validatePortfolioEconomics(config: PortfolioEconomicsConfig) {
	for (const [name, value] of Object.entries(config)) uint(value, name === 'rewardVestingSeconds' ? 48 : 256, name)
	if (config.purchaseFeeBps > 10_000n) throw new Error('Purchase fee cannot exceed 100%.')
	if (config.annualFeeBps > 10_000n) throw new Error('Annual fee cannot exceed 100%.')
	if (config.minimumCommitmentAttoEth === 0n || config.rewardVestingSeconds === 0n) throw new Error('Minimum commitment and fee vesting duration must be positive.')
	if (config.rewardVestingSeconds > 3650n * 86_400n) throw new Error('Fee vesting duration cannot exceed 3650 days.')
	if (config.rewardVestingSeconds < 86_400n) throw new Error('Fee vesting duration must be at least 24 hours.')
	if (config.minimumOutcomeRate === 0n || config.minimumOutcomeRate > 10n ** 18n) throw new Error('Minimum outcome exchange rate must be positive and at most one.')
}

const portfolioFactoryAbi = parseAbi(['function deployPortfolio(bytes creationCode, bytes configuration) returns (address portfolio)'])
// Every member is a static word, so the constructor's two structs encode exactly as this flat list.
const portfolioConfigurationParameters = parseAbiParameters('address, uint256, uint248, uint256, uint256, uint256, address, uint256, uint256, uint256, uint256, uint256, uint48')

/**
 * The canonical factory deploys every portfolio from its pinned creation code and module deployers, so the creator
 * supplies only the configuration. `creationCode` is the linked portfolio creation code; it is injected so this SDK
 * does not depend on generated contracts, and the factory rejects any other code.
 */
export function buildPortfolioDeploymentRequest(parameters: { owner: Address; factory: Address; origin: PortfolioOriginConfig; maximumQuestionHorizonSeconds: bigint; questionAdmissionPolicy: Address; economics: PortfolioEconomicsConfig; creationCode: Hex }) {
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
	address(parameters.questionAdmissionPolicy, 'Question admission policy')
	uint(parameters.maximumQuestionHorizonSeconds, 48, 'Question horizon')
	if (parameters.maximumQuestionHorizonSeconds === 0n) throw new Error('Question horizon must be positive.')
	validatePortfolioEconomics(parameters.economics)
	if (!isHex(parameters.creationCode, { strict: true }) || parameters.creationCode.length <= 2 || parameters.creationCode.length % 2 !== 0) throw new Error('Portfolio creation code must contain whole hexadecimal bytes.')
	const { origin, economics } = parameters
	const configuration = encodeAbiParameters(portfolioConfigurationParameters, [
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
	return { account: parameters.owner, to: parameters.factory, value: 0n, data: encodeFunctionData({ abi: portfolioFactoryAbi, functionName: 'deployPortfolio', args: [parameters.creationCode, configuration] }) }
}

const portfolioDeployedTopic = toEventSelector(parseAbiItem('event PortfolioDeployed(address indexed portfolio, address indexed creator)'))

/** The portfolio a factory deployment transaction created, read from that factory's own event. */
export function portfolioAddressFromDeploymentLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], factory: Address): Address {
	for (const log of logs) {
		const portfolioTopic = log.topics[1]
		if (log.address.toLowerCase() !== factory.toLowerCase() || log.topics[0] !== portfolioDeployedTopic || portfolioTopic === undefined) continue
		return getAddress(`0x${portfolioTopic.slice(26)}`)
	}
	throw new Error('Portfolio deployment event is missing.')
}

/** Each call completes one immutable setup stage; anyone can resume an interrupted setup until the origin universe forks. */
export function buildPortfolioPrepareNextRequest(parameters: { caller: Address; portfolio: Address }) {
	address(parameters.caller, 'Caller')
	address(parameters.portfolio, 'Portfolio')
	return { account: parameters.caller, to: parameters.portfolio, data: encodeFunctionData({ abi: parseAbi(['function prepareNext()']), functionName: 'prepareNext' }), value: 0n }
}

/** @public Unsigned transaction export for external smart-account execution flows. */
export function exportPortfolioTransaction(parameters: { chainId: number; request: { account: Address; to: Address; data: Hex; value: bigint } }) {
	if (!Number.isSafeInteger(parameters.chainId) || parameters.chainId <= 0) throw new Error('Choose a valid chain id.')
	address(parameters.request.account, 'Owner')
	address(parameters.request.to, 'Transaction target')
	uint(parameters.request.value, 256, 'Transaction value')
	if (!isHex(parameters.request.data, { strict: true }) || parameters.request.data.length % 2 !== 0) throw new Error('Call data must contain whole hexadecimal bytes.')
	return { chainId: parameters.chainId, from: parameters.request.account, to: parameters.request.to, data: parameters.request.data, value: parameters.request.value.toString() }
}

export type { PortfolioReadClient } from './securityPoolPortfolioRead.js'
export {
	buildPortfolioCapitalDepositRequest,
	buildPortfolioCapitalWithdrawPrincipalRequest,
	buildPortfolioCapitalSetHealthRequest,
	buildPortfolioCapitalDepositAndSetHealthRequest,
	buildPortfolioCapitalSetCommitmentRequest,
	buildPortfolioCapitalServeRetirementRequest,
	buildPortfolioCapitalClaimEarningsRequest,
	loadPortfolioCapitalSnapshot,
	loadPortfolioClaimableEarnings,
	type PortfolioCapitalSnapshot,
} from './securityPoolPortfolioCapital.js'
/** @public Explicitly bounded commitment takeovers for external keeper implementations. */
export { buildPortfolioCapitalTakeOverRequest } from './securityPoolPortfolioCapital.js'
export { buildPortfolioCapitalTakeOverWithBoundsRequest } from './securityPoolPortfolioCapital.js'
export { buildPortfolioCapitalCureRequest } from './securityPoolPortfolioCapital.js'
export { buildPortfolioMintRequest, loadPortfolioMintQuote, portfolioRecoveryMintBudget, type PortfolioMintQuote } from './securityPoolPortfolioMint.js'
/** @public External clients can register an admitted question independently of purchasing shares. */
export { buildPortfolioAddQuestionRequest } from './securityPoolPortfolioMint.js'
export {
	buildPortfolioForkChoiceRequest,
	buildPortfolioForkPreparationRequest,
	buildPortfolioForkStartRequest,
	buildPortfolioForkFinalizeRequest,
	buildPortfolioForkRecoveryRequest,
	buildPortfolioRecoveryRightsTransferRequest,
	loadPortfolioForkSnapshot,
	type PortfolioForkSnapshot,
} from './securityPoolPortfolioFork.js'
/** @public Schemas for external clients that attach owner operations to price reports. */
export type { PortfolioReportOperation, PortfolioReportOperations } from './securityPoolPortfolioPrice.js'
export {
	/** @public Price-report sponsorship with attached owner operations, for external clients. */
	buildPortfolioPriceOperationsRequest,
	loadPortfolioPriceSnapshot,
	quotePortfolioPriceFunding,
	buildPortfolioPricePreparationRequest,
	buildPortfolioPriceRequest,
	buildPortfolioPriceApprovalRequest,
	buildPortfolioPriceWrapRequest,
	type PortfolioPriceSnapshot,
} from './securityPoolPortfolioPrice.js'
export {
	loadPortfolioAuctionSnapshot,
	portfolioAuctionOpeningReason,
	quotePortfolioAuctionBid,
	buildPortfolioAuctionOpenRequest,
	buildPortfolioAuctionBidRequest,
	buildPortfolioAuctionMaterializeRequest,
	buildPortfolioAuctionRefundCreditRequest,
	buildPortfolioAuctionRefundWithdrawRequest,
	quotePortfolioAuctionRefundClaim,
	buildPortfolioAuctionRefundClaimRequest,
	buildPortfolioAuctionVaultExecuteRequest,
	buildPortfolioAuctionVaultDepositRequest,
	type PortfolioAuctionBid,
} from './securityPoolPortfolioAuction.js'
/** @public Vault clone code and address derivation for external verifiers, fixtures and smart-account tooling. */
export { auctionVaultCreationCode, auctionVaultRuntimeCode } from './securityPoolAuctionVaultClones.js'
export { decodeAuctionVaultBindings, predictAuctionVaultAddress, verifyAuctionVaultCode } from './securityPoolAuctionVaultClones.js'
export { boundCloneImplementation, boundCloneRuntimeCode, verifyBoundCloneCode, universeCloneBindings } from './securityPoolBoundClone.js'
