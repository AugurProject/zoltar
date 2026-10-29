import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { parseUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioAuctionApprovalRequest,
	buildPortfolioAuctionBidRequest,
	buildPortfolioAuctionOpenRequest,
	buildPortfolioAuctionRefundCreditRequest,
	buildPortfolioAuctionRefundWithdrawRequest,
	buildPortfolioAuctionMaterializeRequest,
	portfolioAuctionOpeningReason,
	quotePortfolioAuctionBid,
	type PortfolioAuctionBid,
	type PortfolioAuctionSnapshot,
	type PortfolioForkSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadPortfolioBranchAuction } from '../../../protocol/securityPoolPortfolioAuction.js'
import type { PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import type { PortfolioSharedForkParameters } from './usePortfolioSharedFork.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import * as copy from '../../../copy/portfolioAuction.js'

export type PortfolioAuctionParameters = { fork: PortfolioForkSnapshot | undefined; bidder: Address | undefined; actions: PortfolioSharedForkParameters['actions']; openVault?: ((vault: Address, universeId: bigint) => void) | undefined }
export function usePortfolioAuction({ fork, bidder, actions, openVault }: PortfolioAuctionParameters) {
	const backend = getActiveBackend()
	const lotsInput = useSignal('')
	const repInput = useSignal('')
	const healthInput = useSignal('120')
	const reserveInput = useSignal('')
	const pageStart = useSignal(0n)
	const version = useSignal(0)
	const loaded = useSignal<{ identity: string; key: string; snapshot?: PortfolioAuctionSnapshot | undefined; error?: string } | undefined>(undefined)
	const identity = fork?.branch === undefined || bidder === undefined ? undefined : `${backend.id}:${fork.portfolio}:${bidder}:${fork.branch.universeId}`
	const currentIdentity = useRef(identity)
	currentIdentity.current = identity
	const previous = useRef<{ backend: typeof backend; bidder: Address | undefined; identity: string | undefined }>()
	useEffect(() => {
		if (previous.current?.backend === backend && previous.current.bidder === bidder && (identity === undefined || previous.current.identity === identity)) return
		previous.current = { backend, bidder, identity }
		lotsInput.value = ''
		repInput.value = ''
		healthInput.value = '120'
		reserveInput.value = ''
		pageStart.value = 0n
	}, [backend, bidder, identity])
	const key = `${identity}:${fork?.blockHash}:${pageStart.value}:${version.value}`
	useEffect(() => {
		let active = true
		if (fork?.branch !== undefined && bidder !== undefined && identity !== undefined) {
			void loadPortfolioBranchAuction(createConnectedReadClient(), fork.portfolio, bidder, fork.branch.universeId, pageStart.value)
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
	const openReason = baseReason ?? (snapshot === undefined ? copy.loading : portfolioAuctionOpeningReason(snapshot))
	const biddingReason = auctionReason ?? (!auction?.opened ? copy.openFirst : undefined) ?? (auction?.finalized || (snapshot !== undefined && auction !== undefined && snapshot.timestamp >= auction.closesAt) || snapshot?.forkTime !== 0n ? copy.closed : undefined)
	const lots = portfolioUnsignedId(lotsInput.value)
	const minimumAttoRepPerLot = portfolioAmountOrUndefined(repInput.value)
	const targetHealthFactorBps = /^\d+(\.\d{0,2})?$/.test(healthInput.value.trim()) ? parseUnits(healthInput.value.trim(), 2) : undefined
	const executionReservePerLotAttoEth = reserveInput.value.trim() === '' ? auction?.minimumExecutionReservePerLotAttoEth : portfolioAmountOrUndefined(reserveInput.value)
	const inputReason =
		(lots === undefined || lots === 0n ? copy.lotsInvalid : undefined) ??
		(minimumAttoRepPerLot === undefined || minimumAttoRepPerLot === 0n ? copy.repInvalid : undefined) ??
		(targetHealthFactorBps === undefined || targetHealthFactorBps < 10_000n ? copy.healthInvalid : undefined) ??
		(executionReservePerLotAttoEth === undefined ? copy.reserveInvalid : undefined)
	let quote: ReturnType<typeof quotePortfolioAuctionBid> | undefined
	let quoteError: string | undefined
	if (biddingReason === undefined && inputReason === undefined && snapshot !== undefined && lots !== undefined && minimumAttoRepPerLot !== undefined && targetHealthFactorBps !== undefined && executionReservePerLotAttoEth !== undefined) {
		try {
			quote = quotePortfolioAuctionBid(snapshot, { lots, minimumAttoRepPerLot, targetHealthFactorBps, executionReservePerLotAttoEth })
		} catch (error) {
			quoteError = getErrorMessage(error, copy.quoteError)
		}
	}
	const fundingReason = biddingReason ?? inputReason ?? quoteError
	let bidReason = fundingReason
	if (bidReason === undefined && snapshot !== undefined && quote !== undefined) {
		try {
			buildPortfolioAuctionBidRequest(snapshot, quote)
		} catch (error) {
			bidReason = getErrorMessage(error, copy.quoteError)
		}
	}
	const withdrawalReason = auctionReason ?? (auction?.refundAttoEth === 0n && auction.refundAttoRep === 0n ? copy.noRefund : undefined)
	const refundReason = (bid: PortfolioAuctionBid) => auctionReason ?? (!auction?.finalized ? copy.waitClose : undefined) ?? (bid.refundSettled ? copy.credited : undefined)
	const activateReason = (bid: PortfolioAuctionBid) => auctionReason ?? (bid.fill === undefined || bid.fill.filledLots === 0n ? copy.managePending : undefined) ?? (bid.materialized ? copy.activated : undefined)
	const run = (action: string, title: string, reason: string | undefined, build: (selected: PortfolioAuctionSnapshot) => PortfolioTransaction, verify: (latest: PortfolioAuctionSnapshot) => void = () => undefined, onConfirmed?: () => void) =>
		actions.runPortfolioAction(
			action,
			title,
			() => {
				if (reason !== undefined || snapshot === undefined) throw new Error(reason ?? copy.loading)
				const selected = snapshot
				return {
					...build(selected),
					validateBeforeSubmit: async () => {
						if (getActiveBackend() !== backend || currentIdentity.current !== identity) throw new Error(copy.contextChanged)
						const latest = await loadPortfolioBranchAuction(createConnectedReadClient(), selected.portfolio, selected.bidder, selected.universeId, selected.auction?.bidStart ?? 0n)
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
	const verifyQuote = (latest: PortfolioAuctionSnapshot) => {
		if (quote === undefined) throw new Error(copy.quoteError)
		const fresh = quotePortfolioAuctionBid(latest, quote)
		if (fresh.topUpAttoRep !== quote.topUpAttoRep || fresh.totalAttoEth !== quote.totalAttoEth || fresh.minimumPrincipalAttoRep !== quote.minimumPrincipalAttoRep) throw new Error(copy.fundingChanged)
		return fresh
	}
	return {
		snapshot,
		quote,
		loading,
		error: current?.error ?? quoteError,
		fundingReadError: current?.error,
		lotsInput: lotsInput.value,
		repInput: repInput.value,
		healthInput: healthInput.value,
		reserveInput: reserveInput.value,
		setLots: (value: string) => {
			lotsInput.value = value
		},
		setRep: (value: string) => {
			repInput.value = value
		},
		setHealth: (value: string) => {
			healthInput.value = value
		},
		setReserve: (value: string) => {
			reserveInput.value = value
		},
		openReason,
		fundingReason,
		bidReason,
		withdrawalReason,
		refundReason,
		activateReason,
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
			run('openPortfolioAuction', copy.open, openReason, buildPortfolioAuctionOpenRequest, latest => {
				buildPortfolioAuctionOpenRequest(latest)
			}),
		approve: (amount: bigint) =>
			run(
				'approvePortfolioAuction',
				copy.approve,
				fundingReason,
				selected => ({ ...buildPortfolioAuctionApprovalRequest(selected, amount), reviewDescription: copy.approvalReview(amount, selected.auction?.address ?? selected.controller) }),
				latest => {
					verifyQuote(latest)
				},
			),
		bid: () =>
			run(
				'bidPortfolioAuction',
				copy.bid,
				bidReason,
				selected => {
					if (quote === undefined) throw new Error(copy.quoteError)
					return { ...buildPortfolioAuctionBidRequest(selected, quote), reviewDescription: copy.bidReview(quote.lots, quote.bidAttoEth, quote.topUpAttoRep, quote.executionReserveAttoEth, quote.minimumAttoRepPerLot) }
				},
				latest => {
					buildPortfolioAuctionBidRequest(latest, verifyQuote(latest))
				},
			),
		credit: (bid: PortfolioAuctionBid) =>
			run(
				`creditPortfolioAuction${bid.id}`,
				copy.credit,
				refundReason(bid),
				selected => buildPortfolioAuctionRefundCreditRequest(selected, bid.id),
				latest => {
					buildPortfolioAuctionRefundCreditRequest(latest, bid.id)
				},
			),
		activate: (bid: PortfolioAuctionBid) =>
			run(
				`activatePortfolioAuction${bid.id}`,
				copy.activate,
				activateReason(bid),
				selected => buildPortfolioAuctionMaterializeRequest(selected, bid.id),
				latest => {
					buildPortfolioAuctionMaterializeRequest(latest, bid.id)
				},
				() => {
					if (snapshot !== undefined) openVault?.(bid.vault, snapshot.universeId)
				},
			),
		withdraw: () =>
			run(
				'withdrawPortfolioAuction',
				copy.withdraw,
				withdrawalReason,
				selected => buildPortfolioAuctionRefundWithdrawRequest(selected, selected.bidder),
				latest => {
					buildPortfolioAuctionRefundWithdrawRequest(latest, latest.bidder)
				},
			),
	}
}
