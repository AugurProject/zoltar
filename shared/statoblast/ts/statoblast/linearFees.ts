/** A dedicated security pool question accrues a funded, constant attoETH-per-second stream. */
export type LinearFeeState = Readonly<{ rateAttoEthPerSecond: bigint; rateScale?: bigint; endTime: bigint }>

/** Mirrors the native checkpoint, including the question/fork cutoff and funded stream end. */
export function previewLinearFeeCheckpoint(parameters: { linearFee: LinearFeeState; currentTimestamp: bigint; feeEndTimestamp: bigint; lastFeeCheckpointNativeTime: bigint; settlementCollateralAttoEth: bigint }) {
	const { linearFee, currentTimestamp, feeEndTimestamp, lastFeeCheckpointNativeTime, settlementCollateralAttoEth } = parameters
	if (linearFee.rateAttoEthPerSecond < 0n || linearFee.endTime < 0n || settlementCollateralAttoEth < 0n) return undefined
	const cutoff = currentTimestamp < feeEndTimestamp ? currentTimestamp : feeEndTimestamp
	const end = cutoff < linearFee.endTime ? cutoff : linearFee.endTime
	const elapsed = end > lastFeeCheckpointNativeTime ? end - lastFeeCheckpointNativeTime : 0n
	const scale = linearFee.rateScale ?? 1n
	if (scale <= 0n) return undefined
	const estimatedRetentionFeeAttoEth = (elapsed * linearFee.rateAttoEthPerSecond) / scale
	if (estimatedRetentionFeeAttoEth > settlementCollateralAttoEth) return undefined
	return { estimatedRetentionFeeAttoEth, settlementCollateralAfterFeesAttoEth: settlementCollateralAttoEth - estimatedRetentionFeeAttoEth }
}
