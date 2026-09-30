import * as forkAuctionCopy from '../copy/forkAuction.js'

export const TRUTH_AUCTION_TIME_LENGTH = 604_800n

export function getTruthAuctionEndsAt(auctionStarted: bigint | undefined) {
	if (auctionStarted === undefined || auctionStarted <= 0n) return undefined
	return auctionStarted + TRUTH_AUCTION_TIME_LENGTH
}

// Reserve a minute for wallet confirmation and inclusion; this is a bounded UI policy.
const TRUTH_AUCTION_BID_SUBMISSION_WINDOW_SECONDS = 60n

export function getTruthAuctionBidTimingGuardMessage(currentTimestamp: bigint | undefined, auctionEndsAt: bigint | undefined) {
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (auctionEndsAt === undefined || auctionEndsAt <= 0n) return 'Loading truth auction deadline.'
	if (currentTimestamp >= auctionEndsAt) return forkAuctionCopy.auctionEndedStatus
	if (auctionEndsAt <= currentTimestamp + TRUTH_AUCTION_BID_SUBMISSION_WINDOW_SECONDS) return forkAuctionCopy.auctionEndsTooSoonToBid
	return undefined
}
