import { sameAddress } from './address.js'
import type { OracleManagerDetails, SecurityPoolOverviewActionResult } from '../types/contracts.js'

type LiquidationNoticeState = 'failed' | 'queued' | 'submitted' | 'successful'

export function getLiquidationNoticeState({
	currentPoolOracleManagerDetails,
	liquidationTargetVault,
	loadingPoolOracleManager,
	securityPoolOverviewResult,
}: {
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	liquidationTargetVault: string
	loadingPoolOracleManager: boolean
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
}): LiquidationNoticeState | undefined {
	if (securityPoolOverviewResult?.action !== 'queueLiquidation') return undefined
	if (securityPoolOverviewResult.stagedExecution !== undefined) return securityPoolOverviewResult.stagedExecution.success ? 'successful' : 'failed'
	if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return 'submitted'
	if (currentPoolOracleManagerDetails.pendingOperation?.operation === 'liquidation' && sameAddress(currentPoolOracleManagerDetails.pendingOperation.targetVault, liquidationTargetVault)) {
		return 'queued'
	}
	if (currentPoolOracleManagerDetails.isPriceValid) return 'successful'
	return 'submitted'
}
