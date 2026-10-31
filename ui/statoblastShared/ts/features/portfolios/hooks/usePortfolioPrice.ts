import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { formatEther, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioPriceApprovalRequest, buildPortfolioPricePreparationRequest, buildPortfolioPriceRequest, buildPortfolioPriceWrapRequest, quotePortfolioPriceFunding, type PortfolioForkSnapshot, type PortfolioPriceSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { buildPortfolioPriceFundingWithdrawal, buildPortfolioPriceRecovery, buildPortfolioPriceSettlement, loadPortfolioBranchPrice, loadPortfolioPriceReport, submittedPortfolioPriceReport, type PortfolioPriceReport } from '../../../protocol/securityPoolPortfolioPrice.js'
import type { PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import type { PortfolioSharedForkParameters } from './usePortfolioSharedFork.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import * as copy from '../../../copy/portfolioPrice.js'

export type PortfolioPriceParameters = { fork: PortfolioForkSnapshot | undefined; bidder?: Address | undefined; actions: PortfolioSharedForkParameters['actions'] }
export function usePortfolioPrice({ fork, bidder, actions }: PortfolioPriceParameters) {
	const backend = getActiveBackend()
	const priceInput = useSignal('')
	const wethInput = useSignal('')
	const reportInput = useSignal('')
	const version = useSignal(0)
	const loaded = useSignal<{ key: string; snapshot?: PortfolioPriceSnapshot; error?: string } | undefined>(undefined)
	const reports = useSignal<{ key: string; report?: PortfolioPriceReport; error?: string } | undefined>(undefined)
	const sponsor = bidder ?? fork?.owner
	const identity = fork?.branch === undefined ? undefined : `${fork.portfolio}:${sponsor}:${fork.branch.universeId}`
	const previous = useRef<{ backend: typeof backend; identity: string }>()
	useEffect(() => {
		if (previous.current?.backend === backend && (identity === undefined || previous.current.identity === identity)) return
		previous.current = identity === undefined ? undefined : { backend, identity }
		priceInput.value = ''
		wethInput.value = ''
		reportInput.value = ''
	}, [backend, identity])
	const key = `${backend.id}:${identity}:${fork?.blockHash}:${version.value}`
	useEffect(() => {
		let active = true
		loaded.value = undefined
		if (fork?.branch !== undefined && sponsor !== undefined) {
			void loadPortfolioBranchPrice(createConnectedReadClient(), fork.portfolio, sponsor, fork.branch.universeId)
				.then(snapshot => {
					if (active && getActiveBackend() === backend) loaded.value = { key, snapshot }
				})
				.catch(error => {
					if (active && getActiveBackend() === backend) loaded.value = { key, error: getErrorMessage(error, 'Unable to load branch price requirements.') }
				})
		}
		return () => {
			active = false
		}
	}, [backend, key])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const snapshot = current?.snapshot
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
	const baseReason = (bidder === undefined ? actions.ownerReason : undefined) ?? (fork?.branch === undefined ? copy.selectBranch : undefined) ?? current?.error ?? (snapshot === undefined ? copy.loading : undefined)
	const branchReason = baseReason ?? (!fork?.branch?.started ? copy.waitForStart : undefined)
	const prepareReason = branchReason ?? (snapshot?.feed !== zeroAddress ? copy.prepared : undefined) ?? (snapshot?.sourcePool === undefined ? copy.noPreparationSource : undefined)
	const reportingDeadline = fork?.branch?.ready ? undefined : fork?.activationDeadline
	const earliestSettlement = snapshot?.reportingOpen && snapshot.observation !== undefined ? snapshot.timestamp + snapshot.observation.settlementSeconds : undefined
	const tooLate = earliestSettlement !== undefined && reportingDeadline !== undefined && earliestSettlement >= reportingDeadline
	const reportWindowReason = branchReason ?? (snapshot?.observation === undefined ? copy.prepareFirst : undefined) ?? (!snapshot?.reportingOpen ? copy.closed : undefined) ?? (tooLate ? copy.tooLate : undefined)
	const fundingReason = reportWindowReason ?? (price === undefined || price <= 0n ? copy.priceInvalid : undefined) ?? (requestedWeth === undefined ? copy.wethInvalid : undefined) ?? fundingError
	const walletReason =
		fundingReason ?? (snapshot !== undefined && funding !== undefined && snapshot.ethBalanceAttoEth < funding.requiredEth ? copy.insufficientEth : undefined) ?? (snapshot?.observation !== undefined && funding !== undefined && snapshot.observation.repBalanceAttoRep < funding.rep ? copy.insufficientRep : undefined)
	const wrapReason = walletReason ?? (funding?.wrap === 0n ? copy.noWrap : undefined)
	const requestReason =
		walletReason ??
		(funding !== undefined && funding.wrap > 0n ? copy.insufficientWeth : undefined) ??
		(snapshot?.observation !== undefined && funding !== undefined && (snapshot.observation.wethAllowanceAttoEth < funding.weth || snapshot.observation.repAllowanceAttoRep < funding.rep) ? copy.approvalRequired : undefined)
	const selectedReportReason =
		baseReason ??
		(snapshot?.observation === undefined ? copy.prepareFirst : undefined) ??
		(reportInput.value.trim() !== '' && (reportId === undefined || reportId === 0n) ? copy.reportInvalid : undefined) ??
		(reportId === undefined || reportId === 0n ? copy.noReport : undefined) ??
		reportState?.error ??
		(report === undefined ? copy.reportLoading : undefined)
	const settleReason = selectedReportReason ?? (report?.state.settled ? copy.alreadySettled : undefined) ?? (snapshot !== undefined && report !== undefined && snapshot.timestamp < report.eligibleAt ? copy.waitForSettlement : undefined)
	const recoverReason = selectedReportReason ?? (!report?.state.settled ? copy.notSettled : undefined) ?? (report?.outcome !== 0n ? copy.callbackComplete : undefined)
	const withdrawReason = selectedReportReason ?? (report?.wethCredit === 0n && report.repCredit === 0n ? copy.noFunding : undefined)

	const run = (action: string, label: string, reason: string | undefined, build: (selected: PortfolioPriceSnapshot) => PortfolioTransaction, check: (latest: PortfolioPriceSnapshot) => Promise<void> = async () => undefined, captureReport = false) =>
		actions.runPortfolioAction(
			action,
			label,
			() => {
				if (reason !== undefined || snapshot === undefined) throw new Error(reason ?? copy.loading)
				const selected = snapshot
				return {
					...build(selected),
					validateBeforeSubmit: async () => {
						if (getActiveBackend() !== backend || previous.current?.identity !== identity) throw new Error('Branch or wallet environment changed. Review again.')
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
							throw new Error('Branch price identities changed. Review again.')
						await check(latest)
						if (getActiveBackend() !== backend || previous.current?.identity !== identity) throw new Error('Branch or wallet environment changed. Review again.')
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
		if (!latest.reportingOpen) throw new Error(copy.closed)
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
					reviewDescription: `Allow branch price feed ${selected.feed} to spend up to ${formatEther(amount)} ${token === 'weth' ? 'WETH' : 'branch REP'} from your wallet. This sets the total allowance; it does not request a price report.`,
				}),
				async latest => {
					freshFunding(latest)
				},
			),
		request: () =>
			run(
				'requestPortfolioPrice',
				copy.request,
				requestReason,
				selected => {
					if (price === undefined || requestedWeth === undefined || funding === undefined) throw new Error(copy.priceInvalid)
					return {
						...buildPortfolioPriceRequest(selected, price, requestedWeth),
						reviewDescription: `Fund this branch price report with ${formatEther(funding.weth)} WETH, ${formatEther(funding.rep)} branch REP and ${formatEther(funding.bounty)} ETH bounty. Disputes may change the token amounts returned to your wallet. This does not activate the branch. Accepted prices can enable provider fees once the branch is active.`,
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
