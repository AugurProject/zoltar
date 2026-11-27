import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
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
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import { loadSecurityPoolBranchAuction, securityPoolAuctionCache } from '../../../protocol/securityPoolRepairAuction.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import type { SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import type { SecurityPoolSharedForkParameters } from './useSecurityPoolSharedFork.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import { reviewBalance, type ReviewRow } from '../lib/reviewRows.js'
import * as copy from '../../../copy/securityPoolRepairAuction.js'
import * as collateralCopy from '../../../copy/collateral.js'

export type SecurityPoolAuctionParameters = { fork: SecurityPoolForkSnapshot | undefined; savedBranch?: { securityPool: Address; universeId: bigint } | undefined; bidder: Address | undefined; actions: SecurityPoolSharedForkParameters['actions'] }
export function useSecurityPoolAuction({ fork, savedBranch, bidder, actions }: SecurityPoolAuctionParameters) {
	const backend = getActiveBackend()
	const profile = getActiveNetworkProfile()
	const lotsInput = useSignal('')
	const repInput = useSignal('')
	const pageStart = useSignal(0n)
	const version = useSignal(0)
	const loaded = useSignal<{ backend: typeof backend; page: string; key: string; snapshot?: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>> | undefined; readAt?: number | undefined; error?: string } | undefined>(undefined)
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
	const shownPool = fork?.branch === undefined ? savedBranch?.securityPool : fork.securityPool
	const shownUniverse = fork?.branch?.universeId ?? savedBranch?.universeId
	const page = `${profile.id}:${shownPool}:${bidder}:${shownUniverse}:${pageStart.value}`
	const key = `${page}:${fork?.blockHash}:${version.value}`
	const cache = useMemo(() => (shownPool === undefined || shownUniverse === undefined || bidder === undefined ? undefined : securityPoolAuctionCache(profile, shownPool, shownUniverse, bidder, pageStart.value)), [profile, shownPool, shownUniverse, bidder, pageStart.value])
	const saved = useMemo(() => cache?.read(), [cache, key])
	useEffect(() => {
		const controller = new AbortController()
		if (fork?.branch !== undefined && bidder !== undefined && identity !== undefined) {
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), copy.readTimeout, controller.signal)
			void loadSecurityPoolBranchAuction(client, fork.securityPool, bidder, fork.branch.universeId, pageStart.value)
				.then(snapshot => {
					if (controller.signal.aborted || getActiveBackend() !== backend) return
					if (snapshot.auction !== undefined) cache?.write({ ...snapshot, auction: snapshot.auction }, { number: snapshot.blockNumber, timestamp: snapshot.timestamp })
					loaded.value = { backend, page, key, snapshot, readAt: Date.now() }
				})
				.catch(error => {
					if (!controller.signal.aborted && getActiveBackend() === backend) {
						const previousPage = loaded.value?.backend === backend && loaded.value.page === page ? loaded.value : undefined
						loaded.value = { backend, page, key, snapshot: previousPage?.snapshot, readAt: previousPage?.readAt, error: getErrorMessage(error, copy.loadError) }
					}
				})
		}
		return () => controller.abort()
	}, [backend, cache, key])
	const current = loaded.value?.backend === backend && loaded.value.page === page ? loaded.value : undefined
	const snapshot = current?.snapshot
	const loading = identity !== undefined && current?.key !== key
	const baseReason = (bidder === undefined ? copy.connect : undefined) ?? (fork?.branch === undefined ? copy.selectBranch : undefined) ?? current?.error ?? (loading || snapshot === undefined ? copy.loading : undefined)
	const savedSnapshot = snapshot === undefined ? saved : undefined
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
	const run = (
		action: string,
		title: string,
		reason: string | undefined,
		build: (selected: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>>) => SecurityPoolTransaction,
		verify: (latest: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>>) => readonly ReviewRow[] | void = () => undefined,
		onConfirmed?: () => void,
	) =>
		actions.runSecurityPoolAction(
			action,
			title,
			() => {
				if (reason !== undefined || snapshot === undefined) throw new Error(reason ?? copy.loading)
				const selected = snapshot
				let reviewRows: readonly ReviewRow[] = []
				return {
					...build(selected),
					readReviewRows: () => reviewRows,
					validateBeforeSubmit: async () => {
						if (getActiveBackend() !== backend || currentIdentity.current !== identity) throw new Error(copy.contextChanged)
						const client = withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)
						const latest = await loadSecurityPoolBranchAuction(client, selected.securityPool, selected.bidder, selected.universeId, selected.auction?.bidStart ?? 0n)
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
						reviewRows = verify(latest) ?? []
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
				copy.approvalTitle,
				fundingReason,
				selected => {
					if (selected.auction === undefined) throw new Error(copy.approvalNeedsAuction)
					return {
						account: selected.bidder,
						to: selected.collateralToken,
						value: 0n,
						data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [selected.auction.address, amount] }),
					}
				},
				latest => {
					verifyQuote(latest)
				},
			),
		snapshot: snapshot ?? savedSnapshot?.value,
		displayedAt: snapshot === undefined ? savedSnapshot?.savedAt : current?.readAt,
		savedAt: savedSnapshot?.savedAt ?? (loading || current?.error !== undefined || fork?.branch === undefined ? current?.readAt : undefined),
		quote,
		loading,
		error: current?.error,
		lotsInput: lotsInput.value,
		repInput: repInput.value,
		lots,
		ask: minimumAttoRepPerLot,
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
				return [{ label: copy.status, value: `${copy.states.unopened} → ${copy.states.bidding}` }]
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
					const fresh = verifyQuote(latest)
					buildSecurityPoolAuctionBidRequest(latest, fresh)
					const { decimals, symbol } = latest.collateral
					return [reviewBalance(collateralCopy.walletBalance(symbol), latest.walletCollateral, latest.walletCollateral - fresh.bidAttoEth, decimals, symbol), reviewBalance(copy.lotCount, 0n, fresh.lots, 0)]
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
					const auction = latest.auction
					const selected = auction?.bids.find(item => item.id === bid.id)
					if (auction === undefined || selected === undefined) throw new Error(copy.contextChanged)
					const refund = auction.finalized ? (selected.fill?.refundAttoEth ?? 0n) : selected.earlyRefundAttoEth
					return refund === 0n ? [] : [reviewBalance(copy.refundEth, auction.refundAttoEth, auction.refundAttoEth + refund, latest.collateral.decimals, latest.collateral.symbol)]
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
					const fresh = claimQuote(latest, bid)
					if (fresh.totalAttoEth !== claimQuote(snapshot, bid).totalAttoEth) throw new Error(copy.refundChanged)
					buildSecurityPoolAuctionRefundClaimRequest(latest, bid.id, latest.bidder)
					return [reviewBalance(collateralCopy.walletBalance(latest.collateral.symbol), latest.walletCollateral, latest.walletCollateral + fresh.totalAttoEth, latest.collateral.decimals, latest.collateral.symbol)]
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
					const refund = latest.auction?.refundAttoEth ?? 0n
					const { decimals, symbol } = latest.collateral
					return [reviewBalance(copy.refundEth, refund, 0n, decimals, symbol), reviewBalance(collateralCopy.walletBalance(symbol), latest.walletCollateral, latest.walletCollateral + refund, decimals, symbol)]
				},
			),
	}
}
