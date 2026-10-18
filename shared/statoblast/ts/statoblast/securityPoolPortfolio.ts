import { type Abi, type Address, type Hex, encodeDeployData, encodeFunctionData, isAddress, isHex, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { type VaultOperationsInput, validateVaultOperations } from './vaultOperations.js'

const MAX_PORTFOLIO_CALLS = 16
const portfolioForkAbi = parseAbi(['function claimPositionAndMigrate(uint256 positionId,uint256 intervalId,uint256 outcomeIndex)'])

/** Extracts one snapshot-owned allocation and assigns its native rights to the owner's chosen fork branch atomically. */
export function buildPortfolioPositionForkClaimRequest(parameters: { owner: Address; portfolio: Address; positionId: bigint; intervalId: bigint; outcomeIndex: bigint }) {
	validateAddress(parameters.owner, 'Owner')
	validateAddress(parameters.portfolio, 'Portfolio')
	validateUint(parameters.positionId, 256, 'Position id')
	validateUint(parameters.intervalId, 256, 'Owner interval id')
	validateUint(parameters.outcomeIndex, 256, 'Fork outcome index')
	if (parameters.positionId === 0n) throw new Error('Choose an allocation position.')
	return { account: parameters.owner, to: parameters.portfolio, value: 0n, data: encodeFunctionData({ abi: portfolioForkAbi, functionName: 'claimPositionAndMigrate', args: [parameters.positionId, parameters.intervalId, parameters.outcomeIndex] }) }
}

export type PortfolioVaultRequestParameters = {
	/** Transaction signer and immutable owner of the portfolio vault. */
	owner: Address
	/** Contract account that owns the native SecurityPool vaults. */
	vault: Address
	vaultAbi: Abi
	/** ETH attached by the owner; calls may also spend ETH already held by the vault. */
	value?: bigint
}

export type PortfolioCall = {
	target: Address
	value: bigint
	data: Hex
}

function validateUint(value: bigint, bits: number, label: string) {
	if (value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
}

function validateAddress(value: Address, label: string) {
	if (!isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error(`${label} must be a nonzero address.`)
}

function validateCall(call: PortfolioCall) {
	validateAddress(call.target, 'Call target')
	validateUint(call.value, 256, 'Call value')
	if (!isHex(call.data, { strict: true }) || call.data.length % 2 !== 0) throw new Error('Call data must contain whole hexadecimal bytes.')
}

function vaultRequest(parameters: PortfolioVaultRequestParameters, data: Hex) {
	validateAddress(parameters.owner, 'Owner')
	validateAddress(parameters.vault, 'Portfolio vault')
	const value = parameters.value ?? 0n
	validateUint(value, 256, 'Transaction value')
	return { account: parameters.owner, to: parameters.vault, data, value }
}

/**
 * Build an owner-signed transaction without changing the identity of the native pool vault.
 * @public Transaction-builder API exported by the securityPoolPortfolio package subpath.
 */
export function buildPortfolioExecuteRequest(parameters: PortfolioVaultRequestParameters & { call: PortfolioCall }) {
	validateCall(parameters.call)
	const { target, value, data } = parameters.call
	return vaultRequest(parameters, encodeFunctionData({ abi: parameters.vaultAbi, functionName: 'execute', args: [target, value, data] }))
}

/**
 * Preserve call order and atomicity. Staged withdrawals supply no spendable REP until native execution.
 * @public Transaction-builder API exported by the securityPoolPortfolio package subpath.
 */
export function buildPortfolioBatchRequest(parameters: PortfolioVaultRequestParameters & { calls: readonly PortfolioCall[] }) {
	if (parameters.calls.length === 0 || parameters.calls.length > MAX_PORTFOLIO_CALLS) throw new Error(`Choose one to ${MAX_PORTFOLIO_CALLS} portfolio calls.`)
	for (const call of parameters.calls) validateCall(call)
	return vaultRequest(parameters, encodeFunctionData({ abi: parameters.vaultAbi, functionName: 'executeBatch', args: [parameters.calls] }))
}

/**
 * REP deposits use the portfolio vault's idle balance, with an exact pool approval made by the contract.
 * Native coordinator permissions and oracle funding must already be in place for staged price actions.
 * This encodes a request; it neither quotes available backing nor treats pending withdrawals as funds.
 * @public Transaction-builder API exported by the securityPoolPortfolio package subpath.
 */
export function buildPortfolioVaultOperationsRequest(
	parameters: PortfolioVaultRequestParameters & {
		questionId: bigint
		universeId: bigint
		input: VaultOperationsInput
		proposedRepPerEthPrice: bigint
		requestedInitialAttoWeth: bigint
		bountyAttoEth: bigint
	},
) {
	const { questionId, universeId, input, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth } = parameters
	validateUint(questionId, 256, 'Question id')
	validateUint(universeId, 248, 'Universe id')
	validateUint(proposedRepPerEthPrice, 256, 'Proposed REP per ETH price')
	validateUint(requestedInitialAttoWeth, 256, 'Initial WETH amount')
	validateUint(bountyAttoEth, 256, 'Bounty')
	validateInput(input, parameters.vault)
	return vaultRequest(parameters, encodeFunctionData({ abi: parameters.vaultAbi, functionName: 'submitVaultOperations', args: [questionId, universeId, input, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth] }))
}

function validateInput(input: VaultOperationsInput, vault: Address) {
	validateUint(input.depositAttoRep, 256, 'REP deposit')
	validateUint(input.commitmentAttoEth, 256, 'ETH commitment')
	validateUint(input.withdrawAttoRep, 256, 'REP withdrawal')
	validateUint(input.minimumReceiverHealthFactorBps, 256, 'Receiver health factor')
	validateUint(input.validForSeconds, 256, 'Execution window')
	for (const liquidation of input.liquidations) {
		validateAddress(liquidation.targetVault, 'Liquidation target')
		validateUint(liquidation.requestedDebtAttoEth, 256, 'Liquidation debt')
	}
	validateVaultOperations(input, vault)
}

/**
 * Inject the compiled artifact so the shared SDK does not depend on contract generation.
 * @public Deployment API exported by the securityPoolPortfolio package subpath.
 */
export function buildPortfolioDeploymentRequest(parameters: { owner: Address; factory: Address; initialOriginPool: Address; maximumQuestionHorizonSeconds: bigint; vaultDeployer: Address; artifact: { abi: Abi; bytecode: Hex } }) {
	validateAddress(parameters.owner, 'Owner')
	validateAddress(parameters.factory, 'Factory')
	validateAddress(parameters.initialOriginPool, 'Initial origin pool')
	validateAddress(parameters.vaultDeployer, 'Vault deployer')
	validateUint(parameters.maximumQuestionHorizonSeconds, 48, 'Question horizon')
	if (parameters.maximumQuestionHorizonSeconds === 0n) throw new Error('Question horizon must be positive.')
	return { account: parameters.owner, data: encodeDeployData({ abi: parameters.artifact.abi, bytecode: parameters.artifact.bytecode, args: [parameters.factory, parameters.initialOriginPool, parameters.maximumQuestionHorizonSeconds, parameters.vaultDeployer] }) }
}

export type PortfolioQuestionOperations = {
	minimumIdleAttoRep: bigint
	questionId: bigint
	universeId: bigint
	input: VaultOperationsInput
	proposedRepPerEthPrice: bigint
	requestedInitialAttoWeth: bigint
	bountyAttoEth: bigint
	value: bigint
}
export type PortfolioAllocationPolicyConfig = {
	universeId: bigint
	executor: Address
	expiresAt: bigint
	depositBudgetAttoRep: bigint
	commitmentIncreaseBudgetAttoEth: bigint
	minimumIdleAttoRep: bigint
	minimumHealthFactorBps: bigint
}
export type PortfolioAllocationRule = { questionId: bigint; depositBudgetAttoRep: bigint; maximumCommitmentAttoEth: bigint }

/**
 * Immediate mode requires synchronous native execution. Otherwise successful submission may still
 * leave queued operations, whose later execution is independent for each question.
 * @public Transaction-builder API exported by the securityPoolPortfolio package subpath.
 */
export function buildPortfolioQuestionBatchRequest(parameters: Omit<PortfolioVaultRequestParameters, 'value'> & { operations: readonly PortfolioQuestionOperations[]; requireImmediate: boolean }) {
	if (parameters.operations.length === 0 || parameters.operations.length > MAX_PORTFOLIO_CALLS) throw new Error('Choose one to 16 question operations.')
	let value = 0n
	for (const operation of parameters.operations) {
		validateUint(operation.questionId, 256, 'Question id')
		validateUint(operation.universeId, 248, 'Universe id')
		validateInput(operation.input, parameters.vault)
		validateUint(operation.proposedRepPerEthPrice, 256, 'Proposed REP per ETH price')
		validateUint(operation.requestedInitialAttoWeth, 256, 'Initial WETH amount')
		validateUint(operation.bountyAttoEth, 256, 'Bounty')
		validateUint(operation.value, 256, 'Operation value')
		validateUint(operation.minimumIdleAttoRep, 256, 'Idle REP reserve')
		value += operation.value
	}
	return vaultRequest({ ...parameters, value }, encodeFunctionData({ abi: parameters.vaultAbi, functionName: 'submitQuestionOperationsBatch', args: [parameters.operations, parameters.requireImmediate] }))
}

/**
 * Budgets authorize cumulative automated spending; they are not total account exposure limits.
 * Bind replacement to the authority the owner reviewed. Intervening delegated spending or
 * owner execution invalidates the request instead of silently renewing changed authority.
 * The owner must separately account for existing positions and pending manual operations.
 * @public Policy-builder API exported by the securityPoolPortfolio package subpath.
 */
export function buildPortfolioAllocationPolicyRequest(parameters: Omit<PortfolioVaultRequestParameters, 'value'> & { expectedVersion: bigint; expectedNonce: bigint; config: PortfolioAllocationPolicyConfig; rules: readonly PortfolioAllocationRule[] }) {
	const { config, rules } = parameters
	validateUint(parameters.expectedVersion, 256, 'Expected policy version')
	validateUint(parameters.expectedNonce, 256, 'Expected allocation nonce')
	validateUint(config.universeId, 248, 'Universe id')
	validateAddress(config.executor, 'Policy executor')
	for (const [label, value] of Object.entries(config)) if (typeof value === 'bigint') validateUint(value, 256, label)
	if (config.minimumHealthFactorBps < 10_000n) throw new Error('Health buffer must be at least 10000 basis points.')
	if (rules.length === 0 || rules.length > 16) throw new Error('Choose one to 16 policy questions.')
	const seen = new Set<bigint>()
	for (const rule of rules) {
		validateUint(rule.questionId, 256, 'Question id')
		validateUint(rule.depositBudgetAttoRep, 256, 'Question deposit budget')
		validateUint(rule.maximumCommitmentAttoEth, 256, 'Question commitment cap')
		if (seen.has(rule.questionId)) throw new Error('Policy questions must be unique.')
		seen.add(rule.questionId)
	}
	return vaultRequest(parameters, encodeFunctionData({ abi: parameters.vaultAbi, functionName: 'setAllocationPolicy', args: [parameters.expectedVersion, parameters.expectedNonce, config, rules] }))
}

/** @public Policy-builder API exported by the securityPoolPortfolio package subpath. */
export function buildPortfolioRevokePolicyRequest(parameters: Omit<PortfolioVaultRequestParameters, 'value'>) {
	return vaultRequest(parameters, encodeFunctionData({ abi: parameters.vaultAbi, functionName: 'revokeAllocationPolicy' }))
}

/** @public Executor-builder API exported by the securityPoolPortfolio package subpath. */
export function buildPortfolioAllocationRequest(parameters: Omit<PortfolioVaultRequestParameters, 'value' | 'owner'> & { executor: Address; expectedVersion: bigint; expectedNonce: bigint; questionId: bigint; depositAttoRep: bigint; commitmentAttoEth: bigint }) {
	const args = [parameters.expectedVersion, parameters.expectedNonce, parameters.questionId, parameters.depositAttoRep, parameters.commitmentAttoEth]
	for (const value of args) validateUint(value, 256, 'Allocation argument')
	return vaultRequest({ ...parameters, owner: parameters.executor }, encodeFunctionData({ abi: parameters.vaultAbi, functionName: 'executeAllocation', args }))
}

/**
 * Export an unsigned call for the immutable owner's smart-account execution flow. This is not an
 * EOA-signed transaction and contains no gas/nonce assumptions about the smart-account adapter.
 * @public Smart-account export API exported by the securityPoolPortfolio package subpath.
 */
export function exportPortfolioTransaction(parameters: { chainId: number; request: { account: Address; to: Address; data: Hex; value: bigint } }) {
	if (!Number.isSafeInteger(parameters.chainId) || parameters.chainId <= 0) throw new Error('Choose a valid chain id.')
	validateAddress(parameters.request.account, 'Owner')
	validateCall({ target: parameters.request.to, data: parameters.request.data, value: parameters.request.value })
	return { chainId: parameters.chainId, from: parameters.request.account, to: parameters.request.to, data: parameters.request.data, value: parameters.request.value.toString() }
}

export { loadPortfolioSnapshot, type PortfolioReadClient, type PortfolioSnapshot, type PortfolioPosition } from './securityPoolPortfolioRead.js'
export { planPortfolioAllocations } from './securityPoolPortfolioPlanning.js'
export {
	buildPortfolioSharedForkChoiceRequest,
	buildPortfolioSharedForkRevokeRequest,
	buildPortfolioSharedForkProcessRequest,
	buildPortfolioSharedForkRecoveryRequest,
	buildPortfolioContextPositionClaimRequest,
	loadPortfolioSharedForkSnapshot,
	loadPortfolioSharedForkPosition,
	type PortfolioSharedForkSnapshot,
} from './securityPoolPortfolioFork.js'
export { resolvePortfolioOperationStatus, type PortfolioOperationStatus } from './securityPoolPortfolioStatus.js'
export {
	buildPortfolioDepositRequest,
	buildPortfolioFundWithdrawalRequest,
	buildPortfolioClaimRecoveredRequest,
	buildPortfolioPositionClaimRequest,
	buildPortfolioPositionRebalanceRequest,
	loadPortfolioAggregateSnapshot,
	loadPortfolioMintQuote,
	type PortfolioAggregateSnapshot,
} from './securityPoolPortfolioAggregate.js'
export {
	buildPortfolioMintRequest,
	buildPortfolioWithdrawalRequest,
	buildPortfolioWithdrawEthRequest,
	buildPortfolioCancelWithdrawalRequest,
	buildPortfolioWithdrawalResidualForfeitureRequest,
	buildPortfolioProcessWithdrawalRequest,
	loadPortfolioRecoveryState,
	loadPortfolioWithdrawalRequests,
	type PortfolioRecoveryState,
} from './securityPoolPortfolioAutomatic.js'
