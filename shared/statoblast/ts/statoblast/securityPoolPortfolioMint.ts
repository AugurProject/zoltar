import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares) payable',
	'function addQuestion(uint256 questionId) returns (address)',
	'function getPool(uint256 questionId,uint248 universeId) view returns (address)',
	'function quoteQuestionMint(address pool,uint256 cash) view returns (uint256)',
	'function purchaseFee(uint256 mintAttoEth) view returns (uint256)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function isPriceValid() view returns (bool)',
	'function availableMintCapacity(uint248 universeId) view returns (uint256)',
])
function uint(value: unknown, label: string, bits = 256): bigint {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
	return value
}
function address(value: unknown, label: string): Address {
	if (typeof value !== 'string' || !isAddress(value) || getAddress(value) === zeroAddress) throw new Error(`${label} must be a nonzero address.`)
	return getAddress(value)
}

/** Complete sets remain question-specific; REP ownership and per-question deposits are not purchase inputs. */
export function buildPortfolioMintRequest(parameters: { trader: Address; portfolio: Address; universeId: bigint; questionId: bigint; recipient: Address; minimumShares: bigint; mintAttoEth: bigint; maximumPurchaseFeeAttoEth: bigint }) {
	const universeId = uint(parameters.universeId, 'Universe id', 248)
	const questionId = uint(parameters.questionId, 'Question id')
	const cash = uint(parameters.mintAttoEth, 'Mint collateral')
	if (cash === 0n) throw new Error('Enter a positive ETH mint amount.')
	const fee = uint(parameters.maximumPurchaseFeeAttoEth, 'Maximum purchase fee')
	const value = uint(cash + fee, 'Transaction value')
	return { account: address(parameters.trader, 'Trader'), to: address(parameters.portfolio, 'Portfolio'), value, data: encodeFunctionData({ abi, functionName: 'createCompleteSet', args: [universeId, questionId, cash, address(parameters.recipient, 'Recipient'), uint(parameters.minimumShares, 'Minimum shares')] }) }
}

export function buildPortfolioAddQuestionRequest(parameters: { caller: Address; portfolio: Address; questionId: bigint }) {
	return { account: address(parameters.caller, 'Caller'), to: address(parameters.portfolio, 'Portfolio'), value: 0n, data: encodeFunctionData({ abi, functionName: 'addQuestion', args: [uint(parameters.questionId, 'Question id')] }) }
}

export type PortfolioMintQuote = { pool: Address; capitalLedger: Address; shares: bigint; purchaseFeeAttoEth: bigint; availableCommitmentAttoEth: bigint; priceValid: boolean; blockNumber: bigint }

/** Quotes units and fees at one block. The atomic purchase still checks available healthy capacity after retirement. */
export async function loadPortfolioMintQuote(parameters: { client: PortfolioReadClient; portfolio: Address; universeId: bigint; questionId: bigint; mintAttoEth: bigint; blockNumber?: bigint }): Promise<PortfolioMintQuote> {
	const portfolio = address(parameters.portfolio, 'Portfolio')
	const universeId = uint(parameters.universeId, 'Universe id', 248)
	const questionId = uint(parameters.questionId, 'Question id')
	const cash = uint(parameters.mintAttoEth, 'Mint collateral')
	if (cash === 0n) throw new Error('Enter a positive ETH mint amount.')
	const blockNumber = parameters.blockNumber ?? (await parameters.client.getBlock()).number
	if (blockNumber === undefined) throw new Error('A confirmed block is required for a purchase quote.')
	const read = (target: Address, functionName: string, args: readonly (Address | bigint)[] = []) => parameters.client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [poolValue, capitalValue, fee] = await Promise.all([read(portfolio, 'getPool', [questionId, universeId]), read(portfolio, 'capitalLedger', [universeId]), read(portfolio, 'purchaseFee', [cash])])
	const pool = address(poolValue, 'Question pool')
	const capitalLedger = address(capitalValue, 'Capital ledger')
	const [shares, valid, capacity] = await Promise.all([read(portfolio, 'quoteQuestionMint', [pool, cash]), read(capitalLedger, 'isPriceValid'), read(portfolio, 'availableMintCapacity', [universeId])])
	if (typeof valid !== 'boolean') throw new Error('Invalid capital price validity.')
	return { pool, capitalLedger, shares: uint(shares, 'Quoted shares'), purchaseFeeAttoEth: uint(fee, 'Purchase fee'), availableCommitmentAttoEth: uint(capacity, 'Available commitment'), priceValid: valid, blockNumber }
}
