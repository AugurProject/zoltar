import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type AbiValue } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function createCompleteSet(uint256 questionId,address recipient,uint256 minimumShares,uint256 mintAttoEth) payable',
	'function requestWithdrawal()',
	'function withdrawEth()',
	'function getEthBalance() view returns (uint256)',
	'function cancelWithdrawal()',
	'function setWithdrawalResidualForfeiture(bool allowed)',
	'function processWithdrawal(uint256 questionId,uint248 universeId)',
	'function allocationPolicyVersion() view returns (uint256)',
	'function allocationPolicyNonce() view returns (uint256)',
	'function withdrawalRequested() view returns (bool)',
	'function withdrawalResidualForfeitureAllowed() view returns (bool)',
	'function withdrawalRequestId() view returns (uint256)',
	'function allocatedQuestionCount() view returns (uint256)',
	'function getAllocatedQuestions(uint256 start,uint256 count) view returns (uint256[])',
	'function withdrawalRequestCount() view returns (uint256)',
	'function getWithdrawalRequests(uint256 start,uint256 count) view returns ((address vault,uint256 requestId)[])',
])

export type PortfolioRecoveryState = {
	ethBalanceAttoEth: bigint
	version: bigint
	nonce: bigint
	withdrawalRequested: boolean
	withdrawalResidualForfeitureAllowed: boolean
	withdrawalRequestId: bigint
	allocatedQuestions: bigint[]
	allocatedQuestionsComplete: boolean
}

function uint(value: unknown, label: string, bits = 256): bigint {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
	return value
}

function address(value: unknown): Address {
	if (typeof value !== 'string' || !isAddress(value) || getAddress(value) === zeroAddress) throw new Error('Choose a nonzero address.')
	return getAddress(value)
}

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Invalid recovery state.')
	return value
}

function tuple(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Invalid portfolio response.')
	return value
}

function request(account: Address, to: Address, functionName: string, args: readonly AbiValue[] = [], value = 0n) {
	return { account: address(account), to: address(to), value: uint(value, 'ETH value'), data: encodeFunctionData({ abi, functionName, args }) }
}

/** Buy question-specific complete sets from the portfolio's common underwriting capacity. */
export function buildPortfolioMintRequest(parameters: { trader: Address; portfolio: Address; questionId: bigint; recipient: Address; minimumShares: bigint; mintAttoEth: bigint; maximumPurchaseFeeAttoEth: bigint }) {
	uint(parameters.questionId, 'Question id')
	uint(parameters.minimumShares, 'Minimum shares')
	uint(parameters.mintAttoEth, 'Mint collateral')
	uint(parameters.maximumPurchaseFeeAttoEth, 'Maximum purchase fee')
	if (parameters.mintAttoEth <= 0n) throw new Error('Enter a positive ETH mint amount.')
	return request(parameters.trader, parameters.portfolio, 'createCompleteSet', [parameters.questionId, address(parameters.recipient), parameters.minimumShares, parameters.mintAttoEth], parameters.mintAttoEth + parameters.maximumPurchaseFeeAttoEth)
}

/** Withdraw all vault ETH to its immutable owner without changing REP allocation authority. */
export function buildPortfolioWithdrawEthRequest(parameters: { owner: Address; vault: Address }) {
	return request(parameters.owner, parameters.vault, 'withdrawEth')
}

/** Stops allocation and returns idle origin REP; unsettled positions remain subject to native locks. */
export function buildPortfolioWithdrawalRequest(parameters: { owner: Address; vault: Address }) {
	return request(parameters.owner, parameters.vault, 'requestWithdrawal')
}

/** Cancelling stops native runoff; delegated executor authority stays revoked. */
export function buildPortfolioCancelWithdrawalRequest(parameters: { owner: Address; vault: Address }) {
	return request(parameters.owner, parameters.vault, 'cancelWithdrawal')
}

/** Explicit consent applies only to pending ordinary residuals; native escrow remains locked. */
export function buildPortfolioWithdrawalResidualForfeitureRequest(parameters: { owner: Address; vault: Address; allowed: boolean }) {
	return request(parameters.owner, parameters.vault, 'setWithdrawalResidualForfeiture', [boolean(parameters.allowed)])
}

/** Anyone may process a requested position. The contract pays recovered REP to its immutable owner. */
export function buildPortfolioProcessWithdrawalRequest(parameters: { processor: Address; vault: Address; questionId: bigint; universeId: bigint }) {
	return request(parameters.processor, parameters.vault, 'processWithdrawal', [uint(parameters.questionId, 'Question id'), uint(parameters.universeId, 'Universe id', 248)])
}

export async function loadPortfolioRecoveryState(parameters: { client: PortfolioReadClient; vault: Address; blockNumber: bigint; maximumQuestions?: number }): Promise<PortfolioRecoveryState> {
	const { client, vault, blockNumber } = parameters
	const maximum = parameters.maximumQuestions ?? 256
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4096) throw new Error('Question scan limit must be between 1 and 4096.')
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [ethBalanceAttoEth, version, nonce, withdrawing, forfeitureAllowed, requestId, countValue] = await Promise.all([
		read(vault, 'getEthBalance'),
		read(vault, 'allocationPolicyVersion'),
		read(vault, 'allocationPolicyNonce'),
		read(vault, 'withdrawalRequested'),
		read(vault, 'withdrawalResidualForfeitureAllowed'),
		read(vault, 'withdrawalRequestId'),
		read(vault, 'allocatedQuestionCount'),
	])
	const count = uint(countValue, 'Allocated question count')
	const limit = count > BigInt(maximum) ? BigInt(maximum) : count
	const allocatedQuestions: bigint[] = []
	for (let start = 0n; start < limit; start += 64n) {
		const size = limit - start < 64n ? limit - start : 64n
		const page = tuple(await read(vault, 'getAllocatedQuestions', [start, size])).map(value => uint(value, 'Question id'))
		if (page.length !== Number(size)) throw new Error('Incomplete allocated question page.')
		allocatedQuestions.push(...page)
	}
	return {
		ethBalanceAttoEth: uint(ethBalanceAttoEth, 'Vault ETH balance'),
		version: uint(version, 'Policy version'),
		nonce: uint(nonce, 'Policy nonce'),
		withdrawalRequested: boolean(withdrawing),
		withdrawalResidualForfeitureAllowed: boolean(forfeitureAllowed),
		withdrawalRequestId: uint(requestId, 'Withdrawal request id'),
		allocatedQuestions,
		allocatedQuestionsComplete: count <= BigInt(maximum),
	}
}

/** Request history is independent per owner; entries do not imply FIFO priority or a guaranteed payout. */
export async function loadPortfolioWithdrawalRequests(parameters: { client: PortfolioReadClient; portfolio: Address; blockNumber: bigint; start: bigint; count: bigint }) {
	uint(parameters.start, 'Request offset')
	if (parameters.count < 1n || parameters.count > 64n) throw new Error('Request page must contain one to 64 entries.')
	const read = (functionName: string, args: readonly AbiValue[] = []) => parameters.client.readContract({ address: parameters.portfolio, abi, functionName, args, blockNumber: parameters.blockNumber })
	const [count, values] = await Promise.all([read('withdrawalRequestCount'), read('getWithdrawalRequests', [parameters.start, parameters.count])])
	const requests = tuple(values).map(value => {
		if (value === null || typeof value !== 'object' || !('vault' in value && 'requestId' in value)) throw new Error('Invalid withdrawal request entry.')
		return { vault: address(value.vault), requestId: uint(value.requestId, 'Withdrawal request id') }
	})
	return { total: uint(count, 'Withdrawal request count'), requests }
}
