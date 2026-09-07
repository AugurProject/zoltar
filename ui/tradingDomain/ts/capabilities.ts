export type TradingDeploymentVersion = 1 | 2

export type TradingCapabilities = Readonly<{
	receiveBasedShareOperations: boolean
	directLiquidityRemovalDeadline: boolean
	lpTokenPermit: boolean
}>

const legacyCapabilities: TradingCapabilities = {
	receiveBasedShareOperations: false,
	directLiquidityRemovalDeadline: false,
	lpTokenPermit: false,
}

const versionTwoCapabilities: TradingCapabilities = {
	receiveBasedShareOperations: true,
	directLiquidityRemovalDeadline: true,
	lpTokenPermit: true,
}

export function capabilitiesForTradingVersion(version: TradingDeploymentVersion | undefined): TradingCapabilities {
	return version === 2 ? versionTwoCapabilities : legacyCapabilities
}

export function requireTradingVersion(value: unknown): TradingDeploymentVersion {
	if (value === 1 || value === 2) return value
	throw new Error('Trading deployment version must be 1 or 2')
}
