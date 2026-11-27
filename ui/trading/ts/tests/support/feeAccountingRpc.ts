import { securityPoolMintFee } from '@zoltar/trading-shared/trading/securityPoolMint'
import { decodeFunctionData, encodeAbiParameters, keccak256, parseAbi, stringToHex, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { LiveMarket } from '../../protocol/liveMarket.js'

const aggregateAbi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] results)'])
const uint256 = { type: 'uint256' } as const
const boolean = { type: 'bool' } as const
const address = { type: 'address' } as const
const selector = (signature: string) => keccak256(stringToHex(signature)).slice(0, 10)

/** One portfolio's checkpointed state, including Multicall3 reads pinned by transaction tests. */
export function feeAccountingRpcResult(data: Hex, market: LiveMarket, timestamp: bigint, redemptionAttoEth?: bigint, redemptionAttoRep?: bigint, questionCapacityAttoEth?: bigint, mintRecoveryAttoRep = 0n, purchaseFeeAttoEth?: bigint, purchaseError?: string): Hex | undefined {
	const signature = data.slice(0, 10)
	if (signature === selector('refreshSecurityPoolFees()')) return '0x'
	if (signature === selector('redeemShares(uint256)')) return '0x'
	if (signature === selector('aggregate3((address,bool,bytes)[])')) {
		const decoded = decodeFunctionData({ abi: aggregateAbi, data })
		const calls = decoded.args[0]
		if (!Array.isArray(calls)) throw new Error('Missing multicall calls')
		return encodeAbiParameters(
			[{ type: 'tuple[]', components: [boolean, { type: 'bytes' }] }],
			[
				calls.map((call: unknown) => {
					if (typeof call !== 'object' || call === null || !('callData' in call) || typeof call.callData !== 'string' || !/^0x[0-9a-fA-F]*$/.test(call.callData)) throw new Error('Invalid multicall call')
					const result = feeAccountingRpcResult(`0x${call.callData.slice(2)}`, market, timestamp, redemptionAttoEth, redemptionAttoRep, questionCapacityAttoEth, mintRecoveryAttoRep, purchaseFeeAttoEth, purchaseError)
					if (result === undefined) throw new Error(`Unexpected portfolio multicall ${call.callData}`)
					return [true, result]
				}),
			],
		)
	}
	const accounting = market.valuation?.feeAccounting
	const cash = accounting?.settlementCollateralAttoEth ?? market.settlementCollateralAttoEth
	const supply = market.shareTokenSupplyAttoShares
	const rate = ((accounting?.linearFee?.rateAttoEthPerSecond ?? 0n) * 1_000_000_000n) / (accounting?.linearFee?.rateScale ?? 1n)
	const requestedEnd = accounting?.linearFee?.endTime ?? market.endTime
	const end = requestedEnd < 2n ** 48n ? requestedEnd : 2n ** 48n - 1n
	if (['questionData()', 'securityPoolCustody()', 'securityPool()', 'settlement()', 'ledger()'].some(name => signature === selector(name))) return encodeAbiParameters([address], [market.pool])
	const integers: ReadonlyArray<readonly [string, bigint]> = [
		['getCurrentBlockTimestamp()', timestamp],
		['priceValidUntil()', accounting?.priceValidUntil ?? 2n ** 48n - 1n],
		['getQuestionEndDate(uint256)', market.endTime],
		['shareTokenSupplyAttoShares()', supply],
		['universeId()', market.universeId],
		['questionId()', market.questionId],
		['bookIds(uint248)', 1n],
		['feeTimestamp(uint248)', timestamp],
		['additionalMintCapacityAttoEth()', questionCapacityAttoEth ?? market.availableMintingCapacityAttoEth],
		['statoblastSecurityMultiplierBps()', market.statoblastSecurityMultiplierBps],
		['purchaseFeeBps()', market.mintFees?.purchaseFeeBps ?? 0n],
		['annualFeeBps()', market.mintFees?.annualFeeBps ?? 0n],
		['minimumPurchaseFeeAttoEth()', market.mintFees?.minimumPurchaseFeeAttoEth ?? 0n],
		['quoteMintRecoveryRep(uint248,uint256,uint256)', mintRecoveryAttoRep],
	]
	for (const [name, value] of integers) if (signature === selector(name)) return encodeAbiParameters([uint256], [value])
	if (signature === selector('isCashFunded(uint64)')) return encodeAbiParameters([boolean], [true])
	if (signature === selector('isPriceValid()')) return encodeAbiParameters([boolean], [true])
	if (signature === selector('purchaseQuote(uint248,uint256,uint256)')) {
		if (purchaseError !== undefined) throw new Error(purchaseError)
		const cash = BigInt(`0x${data.slice(-64)}`)
		const fees = market.mintFees
		const fee = purchaseFeeAttoEth ?? (fees === undefined ? 0n : securityPoolMintFee(cash, { ...fees, cashAttoEth: market.settlementCollateralAttoEth, outcomeSupplyAttoShares: supply }))
		return encodeAbiParameters([uint256, uint256], [fee, 0n])
	}
	if (signature === selector('totals()')) return encodeAbiParameters([uint256, uint256, uint256], [100n, market.totalUnderwritingLimitAttoEth, market.feeEligibleUnderwritingLimitAttoEth])
	if (signature === selector('snapshotQuestion(address)')) return encodeAbiParameters([{ type: 'tuple', components: Array.from({ length: 6 }, () => uint256) }], [[supply, cash, market.settlementRecoveryAttoRep ?? 0n, cash, 0n, timestamp]])
	if (signature === selector('question(uint64,uint256)')) return encodeAbiParameters([{ type: 'tuple', components: Array.from({ length: 7 }, () => uint256) }, uint256], [[cash, supply, 0n, rate, timestamp, end, market.mintFees?.feePrincipalAttoEth ?? cash], 0n])
	if (signature === selector('books(uint64)'))
		return encodeAbiParameters([uint256, uint256, uint256, uint256, uint256, uint256, uint256, boolean, uint256, uint256, uint256, boolean, uint256, uint256, uint256, uint256], [cash, cash * 1_000_000_000n, 0n, 0n, 0n, 0n, timestamp, false, 0n, 0n, 0n, true, 0n, 0n, 0n, market.settlementRecoveryAttoRep ?? 0n])
	if (signature === selector('attoSharesToAttoEth(uint256)')) {
		const shares = BigInt(`0x${data.slice(10)}`)
		return encodeAbiParameters([uint256], [redemptionAttoEth ?? (supply === 0n ? shares : (shares * cash) / supply)])
	}
	if (signature === selector('attoSharesToAttoRep(uint256)')) {
		const shares = BigInt(`0x${data.slice(10)}`)
		return encodeAbiParameters([uint256], [redemptionAttoRep ?? (supply === 0n ? 0n : (shares * (market.settlementRecoveryAttoRep ?? 0n)) / supply)])
	}
	return undefined
}
