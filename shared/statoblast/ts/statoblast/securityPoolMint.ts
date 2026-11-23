import { encodeFunctionData, parseAbi, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolReadClient } from './securityPoolRead.js'
import { decodeAddress, decodeUint } from './securityPoolDecoding.js'

const abi = parseAbi([
	'function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee)',
	'function createCompleteSetWithRecoveryRep(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee,uint256 maximumRecoveryAttoRep)',
	'function quoteMintRecoveryRep(uint248 universeId,uint256 questionId,uint256 cash) view returns(uint256)',
	'function addQuestion(uint256 questionId) returns (address)',
	'function questionOriginIds(uint256 questionId) view returns (bytes32)',
	'function originUniverseId() view returns (uint248)',
	'function getPool(uint256 questionId,uint248 universeId) view returns (address)',
	'function quoteQuestionMint(address pool,uint256 cash) view returns (uint256)',
	'function purchaseQuote(uint248 universeId,uint256 questionId,uint256 mintAttoEth) view returns (uint256 fee,uint256 premium)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function isPriceValid() view returns (bool)',
	'function availableMintCapacity(uint248 universeId) view returns (uint256)',
])

/** Finite approval and transaction headroom for fee accrual between review and inclusion. */
export function securityPoolRecoveryMintBudget(required: bigint) {
	decodeUint(required, 'Recovery REP contribution')
	return required === 0n ? 0n : decodeUint((required * 10_100n + 9_999n) / 10_000n + 1n, 'Maximum recovery REP')
}

/** Complete sets remain question-specific; recovery-bearing claims require an explicitly bounded proportional REP contribution. */
export function buildSecurityPoolMintRequest(parameters: { trader: Address; securityPool: Address; universeId: bigint; questionId: bigint; recipient: Address; minimumShares: bigint; mintAttoEth: bigint; maximumPurchaseFeeAttoEth: bigint; maximumRecoveryAttoRep?: bigint }) {
	const universeId = decodeUint(parameters.universeId, 'Universe id', 248)
	const questionId = decodeUint(parameters.questionId, 'Question id')
	const cash = decodeUint(parameters.mintAttoEth, 'Mint collateral')
	if (cash === 0n) throw new Error('Enter a positive collateral amount.')
	const fee = decodeUint(parameters.maximumPurchaseFeeAttoEth, 'Maximum purchase fee')
	const maximumRecoveryAttoRep = decodeUint(parameters.maximumRecoveryAttoRep ?? 0n, 'Maximum recovery REP')
	const args = [universeId, questionId, cash, decodeAddress(parameters.recipient, 'Recipient'), decodeUint(parameters.minimumShares, 'Minimum shares'), fee] as const
	decodeUint(cash + fee, 'Total collateral')
	return {
		account: decodeAddress(parameters.trader, 'Trader'),
		to: decodeAddress(parameters.securityPool, 'SecurityPool'),
		value: 0n,
		data: maximumRecoveryAttoRep === 0n ? encodeFunctionData({ abi, functionName: 'createCompleteSet', args }) : encodeFunctionData({ abi, functionName: 'createCompleteSetWithRecoveryRep', args: [...args, maximumRecoveryAttoRep] }),
	}
}

/** @public Register a question without purchasing shares; the pool's admission policy still decides eligibility. */
export function buildSecurityPoolAddQuestionRequest(parameters: { caller: Address; securityPool: Address; questionId: bigint }) {
	return { account: decodeAddress(parameters.caller, 'Caller'), to: decodeAddress(parameters.securityPool, 'SecurityPool'), value: 0n, data: encodeFunctionData({ abi, functionName: 'addQuestion', args: [decodeUint(parameters.questionId, 'Question id')] }) }
}

export type SecurityPoolMintQuote = {
	/** Zero until an origin-universe first purchase registers the question. */
	pool: Address
	capitalLedger: Address
	shares: bigint
	purchaseFeeAttoEth: bigint
	maximumPurchaseFeeAttoEth: bigint
	recoveryAttoRep: bigint
	maximumRecoveryAttoRep: bigint
	resolutionPremiumAttoEth: bigint
	availableCommitmentAttoEth: bigint
	priceValid: boolean
	blockNumber: bigint
}

/** Quotes units and fees at one block. The atomic purchase still checks available mint capacity, excluding queued retirement reductions. */
export async function loadSecurityPoolMintQuote(parameters: { client: SecurityPoolReadClient; securityPool: Address; universeId: bigint; questionId: bigint; mintAttoEth: bigint; blockNumber?: bigint }): Promise<SecurityPoolMintQuote> {
	const securityPool = decodeAddress(parameters.securityPool, 'SecurityPool')
	const universeId = decodeUint(parameters.universeId, 'Universe id', 248)
	const questionId = decodeUint(parameters.questionId, 'Question id')
	const cash = decodeUint(parameters.mintAttoEth, 'Mint collateral')
	if (cash === 0n) throw new Error('Enter a positive collateral amount.')
	const blockNumber = parameters.blockNumber ?? (await parameters.client.getBlock()).number
	if (blockNumber === undefined) throw new Error('A confirmed block is required for a purchase quote.')
	const read = (target: Address, functionName: string, args: readonly (Address | bigint)[] = []) => parameters.client.readContract({ address: target, abi, functionName, args, blockNumber })
	const questionOrigin = await read(securityPool, 'questionOriginIds', [questionId])
	if (typeof questionOrigin !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(questionOrigin)) throw new Error('Invalid question registration response.')
	const registered = questionOrigin !== zeroHash
	if (!registered && decodeUint(await read(securityPool, 'originUniverseId'), 'Origin universe', 248) !== universeId) throw new Error('New questions can only be purchased in the origin universe.')
	const [poolValue, capitalValue, feeQuote, recoveryQuote] = await Promise.all([
		registered ? read(securityPool, 'getPool', [questionId, universeId]) : zeroAddress,
		read(securityPool, 'capitalLedger', [universeId]),
		read(securityPool, 'purchaseQuote', [universeId, questionId, cash]),
		read(securityPool, 'quoteMintRecoveryRep', [universeId, questionId, cash]),
	])
	if (!Array.isArray(feeQuote) || feeQuote.length !== 2) throw new Error('Invalid funded purchase fee quote.')
	const fee = decodeUint(feeQuote[0], 'Purchase fee')
	const pool = decodeAddress(poolValue, 'Question pool', !registered)
	const capitalLedger = decodeAddress(capitalValue, 'Capital ledger')
	const [shares, valid, capacity] = await Promise.all([registered ? read(securityPool, 'quoteQuestionMint', [pool, cash]) : cash, read(capitalLedger, 'isPriceValid'), read(securityPool, 'availableMintCapacity', [universeId])])
	if (typeof valid !== 'boolean') throw new Error('Invalid capital price validity.')
	const available = decodeUint(capacity, 'Available commitment')
	return {
		pool,
		capitalLedger,
		shares: decodeUint(shares, 'Quoted shares'),
		purchaseFeeAttoEth: fee,
		maximumPurchaseFeeAttoEth: decodeUint((fee * 10_100n + 9_999n) / 10_000n, 'Maximum purchase fee'),
		recoveryAttoRep: decodeUint(recoveryQuote, 'Recovery REP contribution'),
		maximumRecoveryAttoRep: securityPoolRecoveryMintBudget(decodeUint(recoveryQuote, 'Recovery REP contribution')),
		resolutionPremiumAttoEth: decodeUint(feeQuote[1], 'Resolution premium'),
		availableCommitmentAttoEth: available,
		priceValid: valid,
		blockNumber,
	}
}
