import { type Abi, type Address, type Hex, encodeDeployData, encodeFunctionData, isAddress, isHex, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'

export type PortfolioEconomicsConfig = {
	purchaseFeeBps: bigint
	annualFeeBps: bigint
	minimumPurchaseFeeAttoEth: bigint
	minimumCommitmentAttoEth: bigint
	minimumExecutionReserveAttoEth: bigint
	minimumOutcomeRate: bigint
	rewardVestingSeconds: bigint
	reportingFeeAttoEth: bigint
	serviceFeeBps: bigint
	maximumOracleRewardAttoEth: bigint
}
export type PortfolioDeployers = {
	capital: Address
	commitments: Address
	fees: Address
	books: Address
	settlement: Address
	reporters: Address
	forks: Address
	services: Address
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
	if (config.serviceFeeBps > 10_000n) throw new Error('Maintenance fee share cannot exceed 100%.')
	if (config.minimumCommitmentAttoEth === 0n || config.minimumExecutionReserveAttoEth === 0n || config.rewardVestingSeconds === 0n) throw new Error('Minimum commitment, execution reserve and fee vesting duration must be positive.')
	if (config.minimumOutcomeRate === 0n || config.minimumOutcomeRate > 10n ** 18n) throw new Error('Minimum outcome exchange rate must be positive and at most one.')
}

/** Compiled artifacts are injected so this SDK does not depend on generated contracts. */
export function buildPortfolioDeploymentRequest(parameters: { owner: Address; factory: Address; initialOriginPool: Address; maximumQuestionHorizonSeconds: bigint; deployers: PortfolioDeployers; questionAdmissionPolicy: Address; economics: PortfolioEconomicsConfig; artifact: { abi: Abi; bytecode: Hex } }) {
	address(parameters.owner, 'Owner')
	address(parameters.factory, 'Factory')
	address(parameters.initialOriginPool, 'Initial origin pool')
	address(parameters.questionAdmissionPolicy, 'Question admission policy')
	for (const [name, value] of Object.entries(parameters.deployers)) address(value, `${name} deployer`)
	uint(parameters.maximumQuestionHorizonSeconds, 48, 'Question horizon')
	if (parameters.maximumQuestionHorizonSeconds === 0n) throw new Error('Question horizon must be positive.')
	validatePortfolioEconomics(parameters.economics)
	return { account: parameters.owner, data: encodeDeployData({ abi: parameters.artifact.abi, bytecode: parameters.artifact.bytecode, args: [parameters.factory, parameters.initialOriginPool, parameters.maximumQuestionHorizonSeconds, parameters.deployers, parameters.questionAdmissionPolicy, parameters.economics] }) }
}

/** Each call completes one immutable setup stage; anyone can resume an interrupted setup. */
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
	buildPortfolioCapitalAuthorizeRequest,
	buildPortfolioCapitalFundExecutionReserveRequest,
	buildPortfolioCapitalWithdrawExecutionReserveRequest,
	buildPortfolioCapitalRequestRetirementRequest,
	buildPortfolioCapitalCancelRetirementRequest,
	buildPortfolioCapitalServeRetirementRequest,
	buildPortfolioCapitalClaimEarningsRequest,
	loadPortfolioCapitalSnapshot,
	type PortfolioCapitalSnapshot,
} from './securityPoolPortfolioCapital.js'
/** @public Permissionless capital repair for external keeper implementations. */
export { buildPortfolioCapitalCureRequest } from './securityPoolPortfolioCapital.js'
/** @public Explicitly bounded commitment takeovers for external keeper implementations. */
export { buildPortfolioCapitalTakeOverRequest } from './securityPoolPortfolioCapital.js'
export { buildPortfolioCapitalTakeOverWithBoundsRequest } from './securityPoolPortfolioCapital.js'
/** @public Quote the execution reserve needed before an external client authorizes commitments. */
export { requiredPortfolioExecutionReserve } from './securityPoolPortfolioCapital.js'
export { buildPortfolioMintRequest, loadPortfolioMintQuote, type PortfolioMintQuote } from './securityPoolPortfolioMint.js'
/** @public External clients can register an admitted question independently of purchasing shares. */
export { buildPortfolioAddQuestionRequest } from './securityPoolPortfolioMint.js'
/** @public A permissionless call pays a question's authenticated final reporting beneficiary. */
export { buildPortfolioReportingRewardRequest, buildPortfolioServiceCreditRequest } from './securityPoolPortfolioMint.js'
export {
	buildPortfolioForkChoiceRequest,
	buildPortfolioForkStartRequest,
	buildPortfolioForkFinalizeRequest,
	buildPortfolioForkRecoveryRequest,
	buildPortfolioRecoveryRightsTransferRequest,
	loadPortfolioForkSnapshot,
	type PortfolioForkSnapshot,
} from './securityPoolPortfolioFork.js'
