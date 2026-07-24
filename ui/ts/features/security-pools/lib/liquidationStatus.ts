import { sameAddress } from '../../../lib/address.js'
import { isOracleManagerPriceUsable } from './securityVault.js'
import type { OracleManagerDetails, SecurityPoolOverviewActionResult } from '../../../types/contracts.js'

type LiquidationNoticeState = 'failed' | 'queued' | 'submitted' | 'successful'

export function getLiquidationNoticeState({
	currentTimestamp,
	currentPoolOracleManagerDetails,
	liquidationTargetVault,
	loadingPoolOracleManager,
	securityPoolOverviewResult,
}: {
	currentTimestamp?: bigint | undefined
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	liquidationTargetVault: string
	loadingPoolOracleManager: boolean
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
}): LiquidationNoticeState | undefined {
	if (securityPoolOverviewResult?.action !== 'queueLiquidation') return undefined
	if (securityPoolOverviewResult.stagedExecution !== undefined) return securityPoolOverviewResult.stagedExecution.success ? 'successful' : 'failed'
	if (securityPoolOverviewResult.queuedOperation?.operation === 'liquidation') return 'queued'
	if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return 'submitted'
	if (currentPoolOracleManagerDetails.pendingOperation?.operation === 'liquidation' && sameAddress(currentPoolOracleManagerDetails.pendingOperation.targetVault, liquidationTargetVault)) return 'queued'
	if (isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp)) return 'successful'
	return 'submitted'
}
