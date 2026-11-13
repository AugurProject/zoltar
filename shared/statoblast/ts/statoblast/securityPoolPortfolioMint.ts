import { encodeFunctionData, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'
import { decodeAddress, decodeUint } from './securityPoolPortfolioDecoding.js'

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

/** Complete sets remain question-specific; REP ownership and per-question deposits are not purchase inputs. */
export function buildPortfolioMintRequest(parameters: { trader: Address; portfolio: Address; universeId: bigint; questionId: bigint; recipient: Address; minimumShares: bigint; mintAttoEth: bigint; maximumPurchaseFeeAttoEth: bigint }) {
	const universeId = decodeUint(parameters.universeId, 'Universe id', 248)
	const questionId = decodeUint(parameters.questionId, 'Question id')
	const cash = decodeUint(parameters.mintAttoEth, 'Mint collateral')
	if (cash === 0n) throw new Error('Enter a positive collateral amount.')
	const fee = decodeUint(parameters.maximumPurchaseFeeAttoEth, 'Maximum purchase fee')
	decodeUint(cash + fee, 'Total collateral')
	return {
		account: decodeAddress(parameters.trader, 'Trader'),
		to: decodeAddress(parameters.portfolio, 'Portfolio'),
		value: 0n,
		data: encodeFunctionData({ abi, functionName: 'createCompleteSet', args: [universeId, questionId, cash, decodeAddress(parameters.recipient, 'Recipient'), decodeUint(parameters.minimumShares, 'Minimum shares'), fee] }),
	}
}

/** @public Register a question without purchasing shares; the pool's admission policy still decides eligibility. */
export function buildPortfolioAddQuestionRequest(parameters: { caller: Address; portfolio: Address; questionId: bigint }) {
	return { account: decodeAddress(parameters.caller, 'Caller'), to: decodeAddress(parameters.portfolio, 'Portfolio'), value: 0n, data: encodeFunctionData({ abi, functionName: 'addQuestion', args: [decodeUint(parameters.questionId, 'Question id')] }) }
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
	const portfolio = decodeAddress(parameters.portfolio, 'Portfolio')
	const universeId = decodeUint(parameters.universeId, 'Universe id', 248)
	const questionId = decodeUint(parameters.questionId, 'Question id')
	const cash = decodeUint(parameters.mintAttoEth, 'Mint collateral')
	if (cash === 0n) throw new Error('Enter a positive collateral amount.')
	const blockNumber = parameters.blockNumber ?? (await parameters.client.getBlock()).number
	if (blockNumber === undefined) throw new Error('A confirmed block is required for a purchase quote.')
	const read = (target: Address, functionName: string, args: readonly (Address | bigint)[] = []) => parameters.client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [poolValue, capitalValue, feeQuote] = await Promise.all([read(portfolio, 'getPool', [questionId, universeId]), read(portfolio, 'capitalLedger', [universeId]), read(portfolio, 'purchaseQuote', [universeId, questionId, cash])])
	if (!Array.isArray(feeQuote) || feeQuote.length !== 2) throw new Error('Invalid funded purchase fee quote.')
	const fee = decodeUint(feeQuote[0], 'Purchase fee')
	const pool = decodeAddress(poolValue, 'Question pool')
	const capitalLedger = decodeAddress(capitalValue, 'Capital ledger')
	const [shares, valid, capacity] = await Promise.all([read(portfolio, 'quoteQuestionMint', [pool, cash]), read(capitalLedger, 'isPriceValid'), read(portfolio, 'availableMintCapacity', [universeId])])
	if (typeof valid !== 'boolean') throw new Error('Invalid capital price validity.')
	const available = decodeUint(capacity, 'Available commitment')
	return {
		pool,
		capitalLedger,
		shares: decodeUint(shares, 'Quoted shares'),
		purchaseFeeAttoEth: fee,
		maximumPurchaseFeeAttoEth: decodeUint((fee * 10_100n + 9_999n) / 10_000n, 'Maximum purchase fee'),
		resolutionPremiumAttoEth: decodeUint(feeQuote[1], 'Resolution premium'),
		availableCommitmentAttoEth: available,
		priceValid: valid,
		blockNumber,
	}
}
