import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { formatEther, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioPriceApprovalRequest, buildPortfolioPricePreparationRequest, buildPortfolioPriceRequest, buildPortfolioPriceWrapRequest, quotePortfolioPriceFunding, type PortfolioForkSnapshot, type PortfolioPriceSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { buildPortfolioPriceFundingWithdrawal, buildPortfolioPriceRecovery, buildPortfolioPriceSettlement, loadPortfolioBranchPrice, loadPortfolioPriceReport, submittedPortfolioPriceReport, type PortfolioPriceReport } from '../../../protocol/securityPoolPortfolioPrice.js'
import type { PortfolioAccountSnapshot, PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import type { PortfolioSharedForkParameters } from './usePortfolioSharedFork.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import * as copy from '../../../copy/portfolioPrice.js'

/** The shared price feed one report funds. */
export type PortfolioPriceTarget = {
	portfolio: Address
	owner: Address
	universeId: bigint
	blockHash: string
	/** Reporting can open: a branch has started migrating, or the account's universe is not still importing one. */
	started: boolean
	/** A branch report must settle before the branch activates. */
	reportingDeadline: bigint | undefined
}
export function branchPriceTarget(fork: PortfolioForkSnapshot | undefined): PortfolioPriceTarget | undefined {
	const branch = fork?.branch
	if (fork === undefined || branch === undefined) return undefined
	return { portfolio: fork.portfolio, owner: fork.owner, universeId: branch.universeId, blockHash: fork.blockHash, started: branch.started, reportingDeadline: branch.ready ? undefined : fork.activationDeadline }
}
/** A universe still importing a fork reports through its branch, which knows the activation deadline. */
export function accountPriceTarget(account: Pick<PortfolioAccountSnapshot, 'portfolio' | 'owner' | 'universeId' | 'blockHash' | 'importing'> | undefined): PortfolioPriceTarget | undefined {
	if (account === undefined) return undefined
	return { portfolio: account.portfolio, owner: account.owner, universeId: account.universeId, blockHash: account.blockHash, started: !account.importing, reportingDeadline: undefined }
}
export type PortfolioPriceParameters = {
	scope: copy.PortfolioPriceScope
	target: PortfolioPriceTarget | undefined
	bidder?: Address | undefined
	actions: PortfolioSharedForkParameters['actions']
	/** Compared with the proposed price until this branch's feed has accepted one of its own. */
	referencePrice?: bigint | undefined
}
export function usePortfolioPrice({ scope, target, bidder, actions, referencePrice }: PortfolioPriceParameters) {
	const backend = getActiveBackend()
	const scoped = copy.scopes[scope]
	const priceInput = useSignal('')
	const wethInput = useSignal('')
	const reportInput = useSignal('')
	const version = useSignal(0)
	const loaded = useSignal<{ key: string; snapshot?: PortfolioPriceSnapshot; error?: string } | undefined>(undefined)
	const reports = useSignal<{ key: string; report?: PortfolioPriceReport; error?: string } | undefined>(undefined)
	const sponsor = bidder ?? target?.owner
	const identity = target === undefined ? undefined : `${target.portfolio}:${sponsor}:${target.universeId}`
	const previous = useRef<{ backend: typeof backend; identity: string }>()
	const loadedReference = useRef<{ backend: typeof backend; identity: string; price: bigint | undefined }>()
	useEffect(() => {
		if (previous.current?.backend === backend && (identity === undefined || previous.current.identity === identity)) return
		previous.current = identity === undefined ? undefined : { backend, identity }
		priceInput.value = ''
		wethInput.value = ''
		reportInput.value = ''
	}, [backend, identity])
	const key = `${backend.id}:${identity}:${target?.blockHash}:${version.value}`
	useEffect(() => {
		let active = true
		loaded.value = undefined
		if (target !== undefined && sponsor !== undefined) {
			void loadPortfolioBranchPrice(createConnectedReadClient(), target.portfolio, sponsor, target.universeId)
				.then(snapshot => {
					if (active && getActiveBackend() === backend) loaded.value = { key, snapshot }
				})
				.catch(error => {
					if (active && getActiveBackend() === backend) loaded.value = { key, error: getErrorMessage(error, 'Unable to load price requirements.') }
				})
		}
		return () => {
			active = false
		}
	}, [backend, key])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const snapshot = current?.snapshot
	// The target reloads on every block, so its last loaded reference stands in until the next load instead of the portfolio's price.
	if (loadedReference.current?.backend !== backend || (identity !== undefined && loadedReference.current.identity !== identity)) loadedReference.current = undefined
	// `previous` updates after the render that follows a backend change, so a snapshot from the old environment cannot set the new reference.
	if (identity !== undefined && snapshot !== undefined && previous.current?.backend === backend) {
		const observation = snapshot.observation
		loadedReference.current = { backend, identity, price: observation !== undefined && observation.lastSettlementTimestamp !== 0n ? observation.lastPrice : referencePrice }
	}
	const reportId = reportInput.value.trim() === '' ? snapshot?.observation?.pendingReportId : portfolioUnsignedId(reportInput.value)
	const reportKey = `${key}:${snapshot?.blockHash}:${reportId}`
	useEffect(() => {
		let active = true
		reports.value = undefined
		if (snapshot !== undefined && snapshot.observation !== undefined && reportId !== undefined && reportId > 0n) {
			void loadPortfolioPriceReport(createConnectedReadClient(), snapshot, reportId)
				.then(report => {
					if (active && getActiveBackend() === backend) reports.value = { key: reportKey, report }
				})
				.catch(error => {
					if (active && getActiveBackend() === backend) reports.value = { key: reportKey, error: getErrorMessage(error, 'Unable to load the selected price report.') }
				})
		}
		return () => {
			active = false
		}
	}, [backend, reportKey])
	const reportState = reports.value?.key === reportKey ? reports.value : undefined
	const report = reportState?.report
	const price = portfolioAmountOrUndefined(priceInput.value)
	const requestedWeth = wethInput.value.trim() === '' ? 0n : portfolioAmountOrUndefined(wethInput.value)
	let funding: ReturnType<typeof quotePortfolioPriceFunding> | undefined
	let minimumWethAttoEth: bigint | undefined
	let fundingError: string | undefined
	if (snapshot?.reportingOpen && snapshot.observation !== undefined && price !== undefined && price > 0n && requestedWeth !== undefined) {
		try {
			minimumWethAttoEth = quotePortfolioPriceFunding(snapshot, price, 0n).weth
			funding = quotePortfolioPriceFunding(snapshot, price, requestedWeth)
		} catch (error) {
			fundingError = getErrorMessage(error, 'Invalid report funding.')
		}
	}
	const baseReason = (bidder === undefined ? actions.ownerReason : undefined) ?? (target === undefined ? scoped.missingTarget : undefined) ?? current?.error ?? (snapshot === undefined ? scoped.loading : undefined)
	const startReason = baseReason ?? (!target?.started ? scoped.waitForStart : undefined)
	const prepareReason = startReason ?? (snapshot?.feed !== zeroAddress ? scoped.prepared : undefined) ?? (snapshot?.sourcePool === undefined ? copy.noPreparationSource : undefined)
	const reportingDeadline = target?.reportingDeadline
	const earliestSettlement = snapshot?.reportingOpen && snapshot.observation !== undefined ? snapshot.timestamp + snapshot.observation.settlementSeconds : undefined
	const tooLate = earliestSettlement !== undefined && reportingDeadline !== undefined && earliestSettlement >= reportingDeadline
	const reportWindowReason = startReason ?? (snapshot?.observation === undefined ? scoped.prepareFirst : undefined) ?? (!snapshot?.reportingOpen ? scoped.closed : undefined) ?? (tooLate ? copy.tooLate : undefined)
	const fundingReason = reportWindowReason ?? (price === undefined || price <= 0n ? copy.priceInvalid : undefined) ?? (requestedWeth === undefined ? copy.wethInvalid : undefined) ?? fundingError
	const walletReason =
		fundingReason ?? (snapshot !== undefined && funding !== undefined && snapshot.ethBalanceAttoEth < funding.requiredEth ? copy.insufficientEth : undefined) ?? (snapshot?.observation !== undefined && funding !== undefined && snapshot.observation.repBalanceAttoRep < funding.rep ? scoped.insufficientRep : undefined)
	const wrapReason = walletReason ?? (funding?.wrap === 0n ? copy.noWrap : undefined)
	const requestReason =
		walletReason ??
		(funding !== undefined && funding.wrap > 0n ? copy.insufficientWeth : undefined) ??
		(snapshot?.observation !== undefined && funding !== undefined && (snapshot.observation.wethAllowanceAttoEth < funding.weth || snapshot.observation.repAllowanceAttoRep < funding.rep) ? copy.approvalRequired : undefined)
	const selectedReportReason =
		baseReason ??
		(snapshot?.observation === undefined ? scoped.prepareFirst : undefined) ??
		(reportInput.value.trim() !== '' && (reportId === undefined || reportId === 0n) ? copy.reportInvalid : undefined) ??
		(reportId === undefined || reportId === 0n ? copy.noReport : undefined) ??
		reportState?.error ??
		(report === undefined ? scoped.reportLoading : undefined)
	const settleReason = selectedReportReason ?? (report?.state.settled ? copy.alreadySettled : undefined) ?? (snapshot !== undefined && report !== undefined && snapshot.timestamp < report.eligibleAt ? copy.waitForSettlement : undefined)
	const recoverReason = selectedReportReason ?? (!report?.state.settled ? copy.notSettled : undefined) ?? (report?.outcome !== 0n ? copy.callbackComplete : undefined)
	const withdrawReason = selectedReportReason ?? (report?.wethCredit === 0n && report.repCredit === 0n ? copy.noFunding : undefined)

	const run = (action: string, label: string, reason: string | undefined, build: (selected: PortfolioPriceSnapshot) => PortfolioTransaction, check: (latest: PortfolioPriceSnapshot) => Promise<void> = async () => undefined, captureReport = false) =>
		actions.runPortfolioAction(
			action,
			label,
			() => {
				if (reason !== undefined || snapshot === undefined) throw new Error(reason ?? scoped.loading)
				const selected = snapshot
				return {
					...build(selected),
					validateBeforeSubmit: async () => {
						if (getActiveBackend() !== backend || previous.current?.identity !== identity) throw new Error('Price feed or wallet environment changed. Review again.')
						const latest = await loadPortfolioBranchPrice(createConnectedReadClient(), selected.portfolio, selected.owner, selected.universeId)
						if (
							latest.chainId !== selected.chainId ||
							latest.feed !== selected.feed ||
							latest.repToken !== selected.repToken ||
							latest.factory !== selected.factory ||
							latest.sourcePool !== selected.sourcePool ||
							latest.observation?.weth !== selected.observation?.weth ||
							latest.observation?.openOracle !== selected.observation?.openOracle
						)
							throw new Error('Price feed identities changed. Review again.')
						await check(latest)
						if (getActiveBackend() !== backend || previous.current?.identity !== identity) throw new Error('Price feed or wallet environment changed. Review again.')
					},
				}
			},
			async () => undefined,
			async result => {
				if (getActiveBackend() !== backend || previous.current?.identity !== identity) return
				if (captureReport && snapshot !== undefined) {
					const id = submittedPortfolioPriceReport(result.receipt, snapshot.feed)
					if (id !== undefined) reportInput.value = id.toString()
				}
				version.value += 1
			},
		)
	const freshFunding = (latest: PortfolioPriceSnapshot) => {
		if (!latest.reportingOpen) throw new Error(scoped.closed)
		if (reportingDeadline !== undefined && latest.observation !== undefined && latest.timestamp + latest.observation.settlementSeconds >= reportingDeadline) throw new Error(copy.tooLate)
		if (price === undefined || requestedWeth === undefined || funding === undefined) throw new Error(copy.priceInvalid)
		const fresh = quotePortfolioPriceFunding(latest, price, requestedWeth)
		if (fresh.weth !== funding.weth || fresh.rep !== funding.rep || fresh.bounty !== funding.bounty) throw new Error('Report funding changed. Refresh and review the new amounts.')
		return fresh
	}
	const withReport = (build: (selected: PortfolioPriceSnapshot, selectedReport: PortfolioPriceReport) => PortfolioTransaction) => (selected: PortfolioPriceSnapshot) => {
		if (report === undefined) throw new Error(copy.noReport)
		return build(selected, report)
	}
	const freshReport = async (latest: PortfolioPriceSnapshot) => {
		if (report === undefined) throw new Error(copy.noReport)
		const fresh = await loadPortfolioPriceReport(createConnectedReadClient(), latest, report.reportId)
		if (fresh.escrow !== report.escrow || fresh.state.stateHash !== report.state.stateHash) throw new Error('This report changed. Refresh and review it again.')
		return fresh
	}
	return {
		proposedPrice: price,
		comparisonPrice: loadedReference.current?.price,
		snapshot,
		report,
		funding,
		minimumWethAttoEth,
		reportingDeadline,
		earliestSettlement,
		fundingReadError: current?.error ?? fundingError,
		error: current?.error ?? reportState?.error ?? fundingError,
		loading: current === undefined,
		priceInput: priceInput.value,
		wethInput: wethInput.value,
		reportInput: reportInput.value,
		setPrice: (value: string) => {
			priceInput.value = value
		},
		setWeth: (value: string) => {
			wethInput.value = value
		},
		setReportId: (value: string) => {
			reportInput.value = value
		},
		prepareReason,
		fundingReason,
		wrapReason,
		requestReason,
		settleReason,
		recoverReason,
		withdrawReason,
		refresh: () => {
			version.value += 1
		},
		prepare: () => run('preparePortfolioPrice', copy.prepare, prepareReason, buildPortfolioPricePreparationRequest),
		wrap: () =>
			run(
				'wrapPortfolioPrice',
				copy.wrap,
				wrapReason,
				selected => {
					if (funding === undefined) throw new Error(copy.priceInvalid)
					return buildPortfolioPriceWrapRequest(selected, funding.wrap)
				},
				async latest => {
					const fresh = freshFunding(latest)
					if (fresh.wrap !== funding?.wrap || latest.ethBalanceAttoEth < fresh.requiredEth) throw new Error('Wallet funding changed. Refresh before wrapping ETH.')
				},
			),
		approve: (token: 'weth' | 'rep', amount: bigint) =>
			run(
				token === 'weth' ? 'approvePortfolioPriceWeth' : 'approvePortfolioPriceRep',
				token === 'weth' ? copy.approveWeth : copy.approveRep,
				fundingReason,
				selected => ({
					...buildPortfolioPriceApprovalRequest(selected, token, amount),
					reviewDescription: scoped.formatApprovalReview(selected.feed, formatEther(amount), token),
				}),
				async latest => {
					freshFunding(latest)
				},
			),
		request: () =>
			run(
				'requestPortfolioPrice',
				scoped.request,
				requestReason,
				selected => {
					if (price === undefined || requestedWeth === undefined || funding === undefined) throw new Error(copy.priceInvalid)
					return {
						...buildPortfolioPriceRequest(selected, price, requestedWeth),
						reviewDescription: scoped.formatRequestReview(formatEther(funding.weth), formatEther(funding.rep), formatEther(funding.bounty)),
					}
				},
				async latest => {
					const fresh = freshFunding(latest)
					const observation = latest.observation
					if (observation === undefined || fresh.wrap > 0n || observation.repBalanceAttoRep < fresh.rep || latest.ethBalanceAttoEth < fresh.bounty) throw new Error('Wallet report funding is insufficient.')
					if (observation.wethAllowanceAttoEth < fresh.weth || observation.repAllowanceAttoRep < fresh.rep) throw new Error(copy.approvalRequired)
				},
				true,
			),
		settle: () =>
			run('settlePortfolioPrice', copy.settle, settleReason, withReport(buildPortfolioPriceSettlement), async latest => {
				const fresh = await freshReport(latest)
				if (fresh.state.settled || latest.timestamp < fresh.eligibleAt) throw new Error('This report is not ready to settle.')
			}),
		recover: () =>
			run('recoverPortfolioPrice', copy.recover, recoverReason, withReport(buildPortfolioPriceRecovery), async latest => {
				const fresh = await freshReport(latest)
				if (!fresh.state.settled || fresh.outcome !== 0n) throw new Error(copy.callbackComplete)
			}),
		withdraw: () =>
			run('withdrawPortfolioPrice', copy.withdraw, withdrawReason, withReport(buildPortfolioPriceFundingWithdrawal), async latest => {
				const fresh = await freshReport(latest)
				if (fresh.wethCredit === 0n && fresh.repCredit === 0n) throw new Error(copy.noFunding)
			}),
	}
}
