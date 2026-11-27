import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildSecurityPoolAuctionBidRequest,
	buildSecurityPoolAuctionOpenRequest,
	buildSecurityPoolAuctionRefundClaimRequest,
	buildSecurityPoolAuctionRefundCreditRequest,
	buildSecurityPoolAuctionRefundWithdrawRequest,
	quoteSecurityPoolAuctionRefundClaim,
	buildSecurityPoolAuctionMaterializeRequest,
	buildSecurityPoolAuctionClaimAllRequest,
	MAX_REPAIR_AUCTION_CLAIM_BATCH,
	securityPoolAuctionClaimReason,
	securityPoolAuctionOpeningReason,
	quoteSecurityPoolAuctionBid,
	type SecurityPoolAuctionBid,
	type SecurityPoolForkSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadSecurityPoolBranchAuction } from '../../../protocol/securityPoolRepairAuction.js'
import type { SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import type { SecurityPoolSharedForkParameters } from './useSecurityPoolSharedFork.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import * as copy from '../../../copy/securityPoolRepairAuction.js'
import * as collateralCopy from '../../../copy/collateral.js'

export type SecurityPoolAuctionParameters = { fork: SecurityPoolForkSnapshot | undefined; bidder: Address | undefined; actions: SecurityPoolSharedForkParameters['actions'] }
export function useSecurityPoolAuction({ fork, bidder, actions }: SecurityPoolAuctionParameters) {
	const backend = getActiveBackend()
	const lotsInput = useSignal('')
	const repInput = useSignal('')
	const pageStart = useSignal(0n)
	const version = useSignal(0)
	const loaded = useSignal<{ identity: string; key: string; snapshot?: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>> | undefined; error?: string } | undefined>(undefined)
	const identity = fork?.branch === undefined || bidder === undefined ? undefined : `${backend.id}:${fork.securityPool}:${bidder}:${fork.branch.universeId}`
	const currentIdentity = useRef(identity)
	currentIdentity.current = identity
	const previous = useRef<{ backend: typeof backend; bidder: Address | undefined; identity: string | undefined }>()
	useEffect(() => {
		if (previous.current?.backend === backend && previous.current.bidder === bidder && (identity === undefined || previous.current.identity === identity)) return
		previous.current = { backend, bidder, identity }
		lotsInput.value = ''
		repInput.value = ''
		pageStart.value = 0n
	}, [backend, bidder, identity])
	const key = `${identity}:${fork?.blockHash}:${pageStart.value}:${version.value}`
	useEffect(() => {
		let active = true
		if (fork?.branch !== undefined && bidder !== undefined && identity !== undefined) {
			void loadSecurityPoolBranchAuction(createConnectedReadClient(), fork.securityPool, bidder, fork.branch.universeId, pageStart.value)
				.then(snapshot => {
					if (active && getActiveBackend() === backend) loaded.value = { identity, key, snapshot }
				})
				.catch(error => {
					if (active && getActiveBackend() === backend) loaded.value = { identity, key, snapshot: loaded.value?.identity === identity ? loaded.value.snapshot : undefined, error: getErrorMessage(error, copy.loadError) }
				})
		}
		return () => {
			active = false
		}
	}, [backend, key])
	const presentationIdentity = identity ?? (previous.current?.backend === backend && previous.current.bidder === bidder ? previous.current.identity : undefined)
	const current = loaded.value?.identity === presentationIdentity ? loaded.value : undefined
	const snapshot = current?.snapshot
	const loading = identity !== undefined && current?.key !== key
	const baseReason = (bidder === undefined ? copy.connect : undefined) ?? (fork?.branch === undefined ? copy.selectBranch : undefined) ?? current?.error ?? (loading || snapshot === undefined ? copy.loading : undefined)
	const auction = snapshot?.auction
	const auctionReason = baseReason ?? (auction === undefined ? copy.noAuction : undefined)
	const openReason = baseReason ?? (snapshot === undefined ? copy.loading : securityPoolAuctionOpeningReason(snapshot))
	const biddingReason = auctionReason ?? (!auction?.opened ? copy.openFirst : undefined) ?? (auction?.finalized || (snapshot !== undefined && auction !== undefined && snapshot.timestamp >= auction.closesAt) || snapshot?.forkTime !== 0n ? copy.closed : undefined)
	const lots = securityPoolUnsignedId(lotsInput.value)
	const minimumAttoRepPerLot = securityPoolAmountOrUndefined(repInput.value)
	const inputReason = (lots === undefined || lots === 0n ? copy.lotsInvalid : undefined) ?? (minimumAttoRepPerLot === undefined || minimumAttoRepPerLot === 0n ? copy.repInvalid : undefined)
	let quote: ReturnType<typeof quoteSecurityPoolAuctionBid> | undefined
	let quoteError: string | undefined
	if (biddingReason === undefined && inputReason === undefined && snapshot !== undefined && lots !== undefined && minimumAttoRepPerLot !== undefined) {
		try {
			quote = quoteSecurityPoolAuctionBid(snapshot, { lots, minimumAttoRepPerLot })
		} catch (error) {
			quoteError = getErrorMessage(error, copy.quoteError)
		}
	}
	const fundingReason = biddingReason ?? inputReason ?? quoteError
	let bidReason = fundingReason
	if (bidReason === undefined && snapshot !== undefined && quote !== undefined) {
		try {
			buildSecurityPoolAuctionBidRequest(snapshot, quote)
		} catch (error) {
			bidReason = getErrorMessage(error, copy.quoteError)
		}
	}
	if (bidReason === undefined && snapshot !== undefined && quote !== undefined && snapshot.collateralAllowance < quote.bidAttoEth) bidReason = collateralCopy.approvalRequired
	const withdrawalReason = auctionReason ?? (auction?.refundAttoEth === 0n ? copy.noRefund : undefined)
	const refundReason = (bid: SecurityPoolAuctionBid) => {
		const reason = auctionReason ?? (bid.refundSettled ? copy.credited : undefined) ?? (!auction?.finalized && bid.earlyRefundAttoEth === 0n ? copy.bidMayStillWin : undefined)
		if (reason !== undefined || snapshot === undefined) return reason ?? copy.loading
		try {
			buildSecurityPoolAuctionRefundCreditRequest(snapshot, bid.id)
			return undefined
		} catch (error) {
			return getErrorMessage(error, copy.quoteError)
		}
	}
	const claimQuote = (selected: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>>, bid: SecurityPoolAuctionBid) => quoteSecurityPoolAuctionRefundClaim(selected, bid.id)
	const claimReason = (bid: SecurityPoolAuctionBid) => {
		if (auctionReason !== undefined || snapshot === undefined) return auctionReason ?? copy.loading
		try {
			claimQuote(snapshot, bid)
			return undefined
		} catch (error) {
			// The quote's own sentence is the complete reason; no generic prefix.
			return error instanceof Error ? error.message : copy.quoteError
		}
	}
	// An already credited bid only withdraws, so its review is titled as the withdrawal it performs.
	const claimTitle = (bid: SecurityPoolAuctionBid) => {
		if (snapshot === undefined || claimReason(bid) !== undefined) return copy.claim
		return claimQuote(snapshot, bid).settles ? copy.claim : copy.withdraw
	}
	// Each bid is claimed on its own; the claim-all action covers every page in one transaction.
	const bidClaimReason = (bid: SecurityPoolAuctionBid) => auctionReason ?? (snapshot === undefined ? copy.loading : securityPoolAuctionClaimReason(snapshot, bid.id))
	const claimableBidIds = snapshot?.claimableBidIds ?? []
	let claimAllReason = auctionReason ?? (auction?.unclaimedBidCount === 0n ? copy.allBidsClaimed : undefined) ?? (claimableBidIds.length === 0 ? copy.claimAfterClose : undefined)
	if (claimAllReason === undefined && snapshot !== undefined) {
		try {
			buildSecurityPoolAuctionClaimAllRequest(snapshot, claimableBidIds)
		} catch (error) {
			// The claim builder's sentence is the complete reason; the bid-funding prefix does not apply to claims.
			claimAllReason = error instanceof Error ? error.message : copy.quoteError
		}
	}
	const run = (action: string, title: string, reason: string | undefined, build: (selected: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>>) => SecurityPoolTransaction, verify: (latest: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>>) => void = () => undefined, onConfirmed?: () => void) =>
		actions.runSecurityPoolAction(
			action,
			title,
			() => {
				if (reason !== undefined || snapshot === undefined) throw new Error(reason ?? copy.loading)
				const selected = snapshot
				return {
					...build(selected),
					validateBeforeSubmit: async () => {
						if (getActiveBackend() !== backend || currentIdentity.current !== identity) throw new Error(copy.contextChanged)
						const latest = await loadSecurityPoolBranchAuction(createConnectedReadClient(), selected.securityPool, selected.bidder, selected.universeId, selected.auction?.bidStart ?? 0n)
						if (
							getActiveBackend() !== backend ||
							currentIdentity.current !== identity ||
							latest.chainId !== selected.chainId ||
							latest.auction?.address !== selected.auction?.address ||
							latest.auction?.engine !== selected.auction?.engine ||
							latest.repToken !== selected.repToken ||
							latest.capitalLedger !== selected.capitalLedger
						)
							throw new Error(copy.contextChanged)
						verify(latest)
					},
				}
			},
			async () => undefined,
			async () => {
				if (getActiveBackend() === backend && currentIdentity.current === identity) {
					version.value += 1
					onConfirmed?.()
				}
			},
		)
	const verifyQuote = (latest: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>>) => {
		if (quote === undefined) throw new Error(copy.quoteError)
		const fresh = quoteSecurityPoolAuctionBid(latest, quote)
		if (fresh.bidAttoEth !== quote.bidAttoEth || fresh.minimumPrincipalAttoRep !== quote.minimumPrincipalAttoRep) throw new Error(copy.fundingChanged)
		return fresh
	}
	return {
		approve: (amount: bigint) =>
			run(
				'approveAuctionCollateral',
				'Approve auction collateral',
				fundingReason,
				selected => {
					if (selected.auction === undefined) throw new Error('Auction is unavailable. Refresh before approving collateral.')
					return {
						account: selected.bidder,
						to: selected.collateralToken,
						value: 0n,
						data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [selected.auction.address, amount] }),
					}
				},
				verifyQuote,
			),
		snapshot,
		quote,
		loading,
		error: current?.error,
		lotsInput: lotsInput.value,
		repInput: repInput.value,
		setLots: (value: string) => {
			lotsInput.value = value
		},
		setRep: (value: string) => {
			repInput.value = value
		},
		openReason,
		fundingReason,
		bidReason,
		withdrawalReason,
		refundReason,
		claimReason,
		bidClaimReason,
		claimAllReason,
		claimableBidIds,
		refresh: () => {
			version.value += 1
		},
		previousPage: () => {
			pageStart.value = pageStart.value > 16n ? pageStart.value - 16n : 0n
		},
		nextPage: () => {
			if (auction !== undefined && pageStart.value + 16n < auction.totalBidCount) pageStart.value += 16n
		},
		open: () =>
			run('openSecurityPoolAuction', copy.open, openReason, buildSecurityPoolAuctionOpenRequest, latest => {
				buildSecurityPoolAuctionOpenRequest(latest)
			}),
		bid: () =>
			run(
				'bidSecurityPoolAuction',
				copy.bid,
				bidReason,
				selected => {
					if (quote === undefined) throw new Error(copy.quoteError)
					return { ...buildSecurityPoolAuctionBidRequest(selected, quote), reviewDescription: copy.bidReview(quote.lots, quote.bidAttoEth, quote.minimumAttoRepPerLot, selected.collateral.decimals, selected.collateral.symbol) }
				},
				latest => {
					buildSecurityPoolAuctionBidRequest(latest, verifyQuote(latest))
				},
			),
		credit: (bid: SecurityPoolAuctionBid) =>
			run(
				`creditSecurityPoolAuction${bid.id}`,
				copy.credit,
				refundReason(bid),
				selected => buildSecurityPoolAuctionRefundCreditRequest(selected, bid.id),
				latest => {
					buildSecurityPoolAuctionRefundCreditRequest(latest, bid.id)
				},
			),
		claim: (bid: SecurityPoolAuctionBid) =>
			run(
				`claimSecurityPoolAuction${bid.id}`,
				claimTitle(bid),
				claimReason(bid),
				selected => ({ ...buildSecurityPoolAuctionRefundClaimRequest(selected, bid.id, selected.bidder), reviewDescription: copy.claimReview(claimQuote(selected, bid), selected.collateral.decimals, selected.collateral.symbol) }),
				latest => {
					if (snapshot === undefined) throw new Error(copy.loading)
					// A credit someone else made in the meantime is skipped on chain; the
					// disclosed total must still match what the bidder reviewed.
					if (claimQuote(latest, bid).totalAttoEth !== claimQuote(snapshot, bid).totalAttoEth) throw new Error(copy.refundChanged)
					buildSecurityPoolAuctionRefundClaimRequest(latest, bid.id, latest.bidder)
				},
			),
		claimBid: (bid: SecurityPoolAuctionBid) =>
			run(
				`claimSecurityPoolAuctionBid${bid.id}`,
				copy.claimBid,
				bidClaimReason(bid),
				selected => ({ ...buildSecurityPoolAuctionMaterializeRequest(selected, [bid.id]), reviewDescription: copy.claimBidReview(bid.id, (bid.fill?.filledLots ?? 0n) > 0n) }),
				latest => {
					buildSecurityPoolAuctionMaterializeRequest(latest, [bid.id])
				},
			),
		claimAllBids: () =>
			run(
				'claimSecurityPoolAuctionBids',
				copy.claimAllBids,
				claimAllReason,
				selected => ({ ...buildSecurityPoolAuctionClaimAllRequest(selected, selected.claimableBidIds), reviewDescription: copy.claimAllReview(Math.min(selected.claimableBidIds.length, MAX_REPAIR_AUCTION_CLAIM_BATCH), selected.claimableBidIds.length) }),
				latest => {
					// Bids someone else claimed meanwhile are skipped on chain, so the reviewed list stays safe to send.
					buildSecurityPoolAuctionClaimAllRequest(latest, latest.claimableBidIds)
				},
			),
		withdraw: () =>
			run(
				'withdrawSecurityPoolAuction',
				copy.withdraw,
				withdrawalReason,
				selected => buildSecurityPoolAuctionRefundWithdrawRequest(selected, selected.bidder),
				latest => {
					buildSecurityPoolAuctionRefundWithdrawRequest(latest, latest.bidder)
				},
			),
	}
}
