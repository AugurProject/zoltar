import { hasSubmissionWindow } from '@zoltar/ui-core-shared/transactions/submissionTiming.js'
import * as forkAuctionCopy from '../copy/forkAuction.js'

export const FORK_MIGRATION_DURATION_SECONDS = 4_838_400n

export function getUnresolvedEscalationMigrationSubmissionGuard({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp > migrationEndsAt) return forkAuctionCopy.parentMigrationExpiredDetail
	if (!hasSubmissionWindow(currentTimestamp, migrationEndsAt)) return forkAuctionCopy.migrationWindowEndsTooSoon
	return undefined
}
