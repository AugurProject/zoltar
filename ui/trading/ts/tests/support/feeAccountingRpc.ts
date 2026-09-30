import { encodeAbiParameters, keccak256, stringToHex, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { LiveMarket } from '../../protocol/liveMarket.js'

/** Contract-shaped checkpoint responses; advancing-chain tests can replace the market between quote and submit. */
export function feeAccountingRpcResult(data: Hex, market: LiveMarket, timestamp: bigint) {
	const uint256 = { type: 'uint256' } as const
	const selector = (signature: string) => keccak256(stringToHex(signature)).slice(0, 10)
	if (data === selector('shareTokenSupplyAttoShares()')) return encodeAbiParameters([uint256], [market.shareTokenSupplyAttoShares])
	if (data === selector('getFeeEpochEndTime()')) return encodeAbiParameters([uint256], [market.valuation?.feeEndTime ?? market.endTime])
	if (data !== selector('getPoolAccountingSnapshot()')) return undefined
	const accounting = market.valuation?.feeAccounting
	return encodeAbiParameters(
		Array.from({ length: 12 }, () => uint256),
		[
			accounting?.settlementCollateralAttoEth ?? market.settlementCollateralAttoEth,
			accounting?.totalUnderwritingLimitAttoEth ?? market.totalUnderwritingLimitAttoEth,
			accounting?.feeEligibleUnderwritingLimitAttoEth ?? market.feeEligibleUnderwritingLimitAttoEth,
			0n,
			0n,
			0n,
			accounting?.feeIndexRemainder ?? 0n,
			accounting?.totalFeesOwedRemainder ?? 0n,
			0n,
			accounting?.lastUpdatedFeeAccumulator ?? timestamp,
			accounting?.currentRetentionRate ?? market.currentRetentionRate,
			0n,
		],
	)
}
