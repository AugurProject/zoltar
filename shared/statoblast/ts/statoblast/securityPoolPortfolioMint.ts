import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee)',
	'function addQuestion(uint256 questionId) returns (address)',
	'function getPool(uint256 questionId,uint248 universeId) view returns (address)',
	'function quoteQuestionMint(address pool,uint256 cash) view returns (uint256)',
	'function purchaseQuote(uint248 universeId,uint256 questionId,uint256 mintAttoEth) view returns (uint256 fee,uint256 premium)',
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
	if (cash === 0n) throw new Error('Enter a positive collateral amount.')
	const fee = uint(parameters.maximumPurchaseFeeAttoEth, 'Maximum purchase fee')
	uint(cash + fee, 'Total collateral')
	return {
		account: address(parameters.trader, 'Trader'),
		to: address(parameters.portfolio, 'Portfolio'),
		value: 0n,
		data: encodeFunctionData({ abi, functionName: 'createCompleteSet', args: [universeId, questionId, cash, address(parameters.recipient, 'Recipient'), uint(parameters.minimumShares, 'Minimum shares'), fee] }),
	}
}

/** @public Register a question without purchasing shares; the pool's admission policy still decides eligibility. */
export function buildPortfolioAddQuestionRequest(parameters: { caller: Address; portfolio: Address; questionId: bigint }) {
	return { account: address(parameters.caller, 'Caller'), to: address(parameters.portfolio, 'Portfolio'), value: 0n, data: encodeFunctionData({ abi, functionName: 'addQuestion', args: [uint(parameters.questionId, 'Question id')] }) }
}

export type PortfolioMintQuote = {
	pool: Address
	capitalLedger: Address
	shares: bigint
	purchaseFeeAttoEth: bigint
	maximumPurchaseFeeAttoEth: bigint
	resolutionPremiumAttoEth: bigint
	availableCommitmentAttoEth: bigint
	priceValid: boolean
	blockNumber: bigint
}

/** Quotes units and fees at one block. The atomic purchase still checks available healthy capacity after retirement. */
export async function loadPortfolioMintQuote(parameters: { client: PortfolioReadClient; portfolio: Address; universeId: bigint; questionId: bigint; mintAttoEth: bigint; blockNumber?: bigint }): Promise<PortfolioMintQuote> {
	const portfolio = address(parameters.portfolio, 'Portfolio')
	const universeId = uint(parameters.universeId, 'Universe id', 248)
	const questionId = uint(parameters.questionId, 'Question id')
	const cash = uint(parameters.mintAttoEth, 'Mint collateral')
	if (cash === 0n) throw new Error('Enter a positive collateral amount.')
	const blockNumber = parameters.blockNumber ?? (await parameters.client.getBlock()).number
	if (blockNumber === undefined) throw new Error('A confirmed block is required for a purchase quote.')
	const read = (target: Address, functionName: string, args: readonly (Address | bigint)[] = []) => parameters.client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [poolValue, capitalValue, feeQuote] = await Promise.all([read(portfolio, 'getPool', [questionId, universeId]), read(portfolio, 'capitalLedger', [universeId]), read(portfolio, 'purchaseQuote', [universeId, questionId, cash])])
	if (!Array.isArray(feeQuote) || feeQuote.length !== 2) throw new Error('Invalid funded purchase fee quote.')
	const fee = uint(feeQuote[0], 'Purchase fee')
	const pool = address(poolValue, 'Question pool')
	const capitalLedger = address(capitalValue, 'Capital ledger')
	const [shares, valid, capacity] = await Promise.all([read(portfolio, 'quoteQuestionMint', [pool, cash]), read(capitalLedger, 'isPriceValid'), read(portfolio, 'availableMintCapacity', [universeId])])
	if (typeof valid !== 'boolean') throw new Error('Invalid capital price validity.')
	const available = uint(capacity, 'Available commitment')
	return {
		pool,
		capitalLedger,
		shares: uint(shares, 'Quoted shares'),
		purchaseFeeAttoEth: fee,
		maximumPurchaseFeeAttoEth: uint((fee * 10_100n + 9_999n) / 10_000n, 'Maximum purchase fee'),
		resolutionPremiumAttoEth: uint(feeQuote[1], 'Resolution premium'),
		availableCommitmentAttoEth: available,
		priceValid: valid,
		blockNumber,
	}
}
