import { decodeFunctionData, encodeAbiParameters, keccak256, parseAbi, stringToHex, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { LiveMarket } from '../../protocol/liveMarket.js'

const aggregateAbi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] results)'])
const uint256 = { type: 'uint256' } as const
const boolean = { type: 'bool' } as const
const address = { type: 'address' } as const
const selector = (signature: string) => keccak256(stringToHex(signature)).slice(0, 10)

/** One portfolio's checkpointed state, including Multicall3 reads pinned by transaction tests. */
export function feeAccountingRpcResult(data: Hex, market: LiveMarket, timestamp: bigint): Hex | undefined {
	const signature = data.slice(0, 10)
	if (signature === selector('refreshPortfolioFees()')) return '0x'
	if (signature === selector('redeemShares()')) return '0x'
	if (signature === selector('aggregate3((address,bool,bytes)[])')) {
		const decoded = decodeFunctionData({ abi: aggregateAbi, data })
		return encodeAbiParameters(
			[{ type: 'tuple[]', components: [boolean, { type: 'bytes' }] }],
			[
				decoded.args[0].map(call => {
					const result = feeAccountingRpcResult(call.callData, market, timestamp)
					if (result === undefined) throw new Error(`Unexpected portfolio multicall ${call.callData}`)
					return [true, result]
				}),
			],
		)
	}
	const accounting = market.valuation?.feeAccounting
	const cash = accounting?.settlementCollateralAttoEth ?? market.settlementCollateralAttoEth
	const supply = market.shareTokenSupplyAttoShares
	const rate = accounting?.linearFee?.rateAttoEthPerSecond ?? 0n
	const requestedEnd = accounting?.linearFee?.endTime ?? market.endTime
	const end = requestedEnd < 2n ** 48n ? requestedEnd : 2n ** 48n - 1n
	if (['questionData()', 'portfolioCustody()', 'portfolio()', 'settlement()', 'ledger()'].some(name => signature === selector(name))) return encodeAbiParameters([address], [market.pool])
	const integers: ReadonlyArray<readonly [string, bigint]> = [
		['getCurrentBlockTimestamp()', timestamp],
		['getQuestionEndDate(uint256)', market.endTime],
		['shareTokenSupplyAttoShares()', supply],
		['getFeeEpochEndTime()', end],
		['universeId()', market.universeId],
		['questionId()', market.questionId],
		['bookIds(uint248)', 1n],
		['feeTimestamp(uint248)', timestamp],
		['availableMintCapacity(uint248)', market.availableMintingCapacityAttoEth],
		['statoblastSecurityMultiplierBps()', market.statoblastSecurityMultiplierBps],
		['purchaseFeeBps()', market.mintFees?.purchaseFeeBps ?? 0n],
		['annualFeeBps()', market.mintFees?.annualFeeBps ?? 0n],
		['minimumPurchaseFeeAttoEth()', market.mintFees?.minimumPurchaseFeeAttoEth ?? 0n],
	]
	for (const [name, value] of integers) if (signature === selector(name)) return encodeAbiParameters([uint256], [value])
	if (signature === selector('isPriceValid()')) return encodeAbiParameters([boolean], [true])
	if (signature === selector('totals()')) return encodeAbiParameters([uint256, uint256, uint256], [100n, market.totalUnderwritingLimitAttoEth, market.feeEligibleUnderwritingLimitAttoEth])
	if (signature === selector('snapshotQuestion(address)')) return encodeAbiParameters([{ type: 'tuple', components: Array.from({ length: 6 }, () => uint256) }], [[supply, cash, market.settlementRecoveryAttoRep ?? 0n, cash, 0n, timestamp]])
	if (signature === selector('question(uint64,uint256)')) return encodeAbiParameters([{ type: 'tuple', components: Array.from({ length: 7 }, () => uint256) }, uint256], [[cash, supply, 0n, rate, timestamp, end, market.mintFees?.feePrincipalAttoEth ?? cash], 0n])
	if (signature === selector('books(uint64)')) return encodeAbiParameters([uint256, uint256, uint256, uint256, uint256, uint256, uint256, boolean, uint256, uint256, uint256, boolean, uint256, uint256, uint256, uint256], [cash, cash, 0n, 0n, 0n, 0n, timestamp, false, 0n, 0n, 0n, true, 0n, 0n, 0n, 0n])
	if (signature === selector('attoSharesToAttoRep(uint256)')) {
		const shares = BigInt(`0x${data.slice(10)}`)
		return encodeAbiParameters([uint256], [supply === 0n ? 0n : (shares * (market.settlementRecoveryAttoRep ?? 0n)) / supply])
	}
	return undefined
}
