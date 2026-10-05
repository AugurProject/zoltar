import { hasSubmissionWindow } from '@zoltar/ui-core-shared/transactions/submissionTiming.js'
import * as forkAuctionCopy from '../copy/forkAuction.js'

export const TRUTH_AUCTION_TIME_LENGTH = 604_800n

export function getTruthAuctionEndsAt(auctionStarted: bigint | undefined) {
	if (auctionStarted === undefined || auctionStarted <= 0n) return undefined
	return auctionStarted + TRUTH_AUCTION_TIME_LENGTH
}

export function getTruthAuctionBidTimingGuardMessage(currentTimestamp: bigint | undefined, auctionEndsAt: bigint | undefined) {
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (auctionEndsAt === undefined || auctionEndsAt <= 0n) return 'Loading truth auction deadline…'
	if (currentTimestamp >= auctionEndsAt) return forkAuctionCopy.auctionEndedReason
	if (!hasSubmissionWindow(currentTimestamp, auctionEndsAt)) return forkAuctionCopy.auctionEndsTooSoonToBid
	return undefined
}
