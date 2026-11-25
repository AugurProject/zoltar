import { collateralPresentation } from '../../../protocol/collateral.js'
import { useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { formatEther, formatUnits, getAddress, isAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolPriceApprovalRequest, buildSecurityPoolPricePreparationRequest, buildSecurityPoolPriceRequest, buildSecurityPoolPriceWrapRequest, quoteSecurityPoolPriceFunding, type SecurityPoolForkSnapshot, type SecurityPoolPriceSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import {
	buildSecurityPoolPriceFundingWithdrawal,
	buildSecurityPoolPriceTokenWithdrawal,
	buildSecurityPoolPriceRecovery,
	buildSecurityPoolPriceSettlement,
	loadSecurityPoolBranchPrice,
	loadSecurityPoolPriceReport,
	rememberSecurityPoolPriceReport,
	securityPoolPriceReportCache,
	submittedSecurityPoolPriceReport,
	type SecurityPoolPriceReport,
} from '../../../protocol/securityPoolPrice.js'
import type { SecurityPoolAccountSnapshot, SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import type { SecurityPoolSharedForkParameters } from './useSecurityPoolSharedFork.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import * as copy from '../../../copy/securityPoolPrice.js'

/** The shared price feed one report funds. */
export type SecurityPoolPriceTarget = {
	securityPool: Address
	owner: Address
	universeId: bigint
	blockHash: string
	/** Reporting can open: a branch has started migrating, or the account's universe is not still importing one. */
	started: boolean
	/** A branch report must settle before the branch activates. */
	reportingDeadline: bigint | undefined
}
export function branchPriceTarget(fork: SecurityPoolForkSnapshot | undefined): SecurityPoolPriceTarget | undefined {
	const branch = fork?.branch
	if (fork === undefined || branch === undefined) return undefined
	return { securityPool: fork.securityPool, owner: fork.owner, universeId: branch.universeId, blockHash: fork.blockHash, started: branch.started, reportingDeadline: branch.ready ? undefined : fork.activationDeadline }
}
/** A universe still importing a fork reports through its branch, which knows the activation deadline. */
export function accountPriceTarget(account: Pick<SecurityPoolAccountSnapshot, 'securityPool' | 'owner' | 'universeId' | 'blockHash' | 'importing'> | undefined): SecurityPoolPriceTarget | undefined {
	if (account === undefined) return undefined
	return { securityPool: account.securityPool, owner: account.owner, universeId: account.universeId, blockHash: account.blockHash, started: !account.importing, reportingDeadline: undefined }
}
const actionNames = {
	prepare: 'prepareSecurityPoolPrice',
	wrap: 'wrapSecurityPoolPrice',
	approveWeth: 'approveSecurityPoolPriceWeth',
	approveRep: 'approveSecurityPoolPriceRep',
	request: 'requestSecurityPoolPrice',
	settle: 'settleSecurityPoolPrice',
	recover: 'recoverSecurityPoolPrice',
	withdraw: 'withdrawSecurityPoolPrice',
	withdrawCollateral: 'withdrawSecurityPoolPriceCollateral',
	withdrawRep: 'withdrawSecurityPoolPriceRep',
}
/** The page shows a universe report and a branch report together, so each owns its action IDs and a pending transaction marks only the button that started it. */
function securityPoolPriceAction(scope: copy.SecurityPoolPriceScope, name: keyof typeof actionNames) {
	return scope === 'branch' ? actionNames[name] : `${actionNames[name]}:universe`
}
export type SecurityPoolPriceParameters = {
	scope: copy.SecurityPoolPriceScope
	target: SecurityPoolPriceTarget | undefined
	displayTarget?: SecurityPoolPriceTarget | undefined
	bidder?: Address | undefined
	defaultReportId?: bigint | undefined
	actions: SecurityPoolSharedForkParameters['actions']
	/** Compared with the proposed price until this branch's feed has accepted one of its own. */
	referencePrice?: bigint | undefined
}
export function useSecurityPoolPrice({ scope, target, displayTarget = target, bidder, actions, referencePrice, defaultReportId }: SecurityPoolPriceParameters) {
	const backend = getActiveBackend()
	const profile = getActiveNetworkProfile()
	const scoped = copy.scopes[scope]
	const priceInput = useSignal('')
	const wethInput = useSignal('')
	const reportInput = useSignal('')
	const recipientInput = useSignal<{ reportId: bigint; value: string } | undefined>(undefined)
	const version = useSignal(0)
	const loaded = useSignal<{ backend: typeof backend; key: string; snapshot?: SecurityPoolPriceSnapshot; error?: string } | undefined>(undefined)
	const reports = useSignal<{ backend: typeof backend; key: string; report?: SecurityPoolPriceReport; error?: string } | undefined>(undefined)
	const shownTarget = target ?? displayTarget
	const sponsor = bidder ?? shownTarget?.owner
	const identity = shownTarget === undefined ? undefined : `${shownTarget.securityPool}:${sponsor}:${shownTarget.universeId}`
	const previous = useRef<{ backend: typeof backend; identity: string }>()
	const loadedReference = useRef<{ backend: typeof backend; identity: string; price: bigint | undefined; collateralToken: Address | undefined }>()
	useEffect(() => {
		if (previous.current?.backend === backend && (identity === undefined || previous.current.identity === identity)) return
		previous.current = identity === undefined ? undefined : { backend, identity }
		priceInput.value = ''
		wethInput.value = ''
		reportInput.value = ''
		recipientInput.value = undefined
	}, [backend, identity])
	const key = `${backend.id}:${identity}:${target?.blockHash}:${version.value}`
	useEffect(() => {
		let active = true
		loaded.value = undefined
		if (target !== undefined && sponsor !== undefined) {
			void withTimeout(loadSecurityPoolBranchPrice(createConnectedReadClient(), target.securityPool, sponsor, target.universeId), 15_000, copy.readTimeout)
				.then(snapshot => {
					if (active && getActiveBackend() === backend) loaded.value = { backend, key, snapshot }
				})
				.catch(error => {
					if (active && getActiveBackend() === backend) loaded.value = { backend, key, error: getErrorMessage(error, 'Unable to load price requirements.') }
				})
		}
		return () => {
			active = false
		}
	}, [backend, key])
	const current = loaded.value?.backend === backend && loaded.value.key === key ? loaded.value : undefined
	const snapshot = current?.snapshot
	// The target reloads on every block, so its last loaded reference stands in until the next load instead of the security pool's price.
	if (loadedReference.current?.backend !== backend || (identity !== undefined && loadedReference.current.identity !== identity)) loadedReference.current = undefined
	// `previous` updates after the render that follows a backend change, so a snapshot from the old environment cannot set the new reference.
	if (identity !== undefined && snapshot !== undefined && previous.current?.backend === backend) {
		const observation = snapshot.observation
		loadedReference.current = { backend, identity, collateralToken: observation?.weth, price: observation !== undefined && observation.lastSettlementTimestamp !== 0n ? observation.lastPrice : referencePrice }
	}
	const reportId = reportInput.value.trim() === '' ? (defaultReportId ?? snapshot?.observation?.pendingReportId) : securityPoolUnsignedId(reportInput.value)
	const cache = useMemo(() => (shownTarget === undefined || sponsor === undefined || reportId === undefined || reportId === 0n ? undefined : securityPoolPriceReportCache(profile, shownTarget.securityPool, shownTarget.universeId, sponsor, reportId)), [profile, identity, reportId])
	const saved = useMemo(() => cache?.read(), [cache, version.value, snapshot?.blockHash])
	const reportKey = `${key}:${snapshot?.blockHash}:${reportId}`
	useEffect(() => {
		let active = true
		reports.value = undefined
		if (snapshot !== undefined && snapshot.observation !== undefined && reportId !== undefined && reportId > 0n) {
			const collateralToken = snapshot.observation.weth
			void withTimeout(loadSecurityPoolPriceReport(createConnectedReadClient(), snapshot, reportId), 15_000, copy.readTimeout)
				.then(report => {
					if (!active || getActiveBackend() !== backend) return
					const { sponsor, outcome, eligibleAt, baseFeePerGas, maxSettlementBaseFee, wethCredit, repCredit } = report
					cache?.write({ reportId, sponsor, outcome, state: { settled: report.state.settled }, eligibleAt, baseFeePerGas, maxSettlementBaseFee, wethCredit, repCredit, collateralToken }, { number: snapshot.blockNumber, timestamp: snapshot.timestamp })
					reports.value = { backend, key: reportKey, report }
				})
				.catch(error => {
					if (active && getActiveBackend() === backend) reports.value = { backend, key: reportKey, error: getErrorMessage(error, 'Unable to load the selected price report.') }
				})
		}
		return () => {
			active = false
		}
	}, [backend, cache, reportKey])
	const reportState = reports.value?.backend === backend && reports.value.key === reportKey ? reports.value : undefined
	const report = reportState?.report
	const savedReport = report === undefined ? saved : undefined
	const collateral = collateralPresentation(snapshot?.observation?.weth ?? savedReport?.value.collateralToken ?? loadedReference.current?.collateralToken)
	const price = securityPoolAmountOrUndefined(priceInput.value, 36 - collateral.decimals)
	const requestedWeth = wethInput.value.trim() === '' ? 0n : securityPoolAmountOrUndefined(wethInput.value, collateral.decimals)
	let funding: ReturnType<typeof quoteSecurityPoolPriceFunding> | undefined
	let minimumWethAttoEth: bigint | undefined
	let fundingError: string | undefined
	if (snapshot?.reportingOpen && snapshot.observation !== undefined && price !== undefined && price > 0n && requestedWeth !== undefined) {
		try {
			funding = quoteSecurityPoolPriceFunding(snapshot, price, requestedWeth)
			minimumWethAttoEth = funding.minimumWeth
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
	const wrapReason = walletReason ?? (collateral.symbol !== 'WETH' ? 'Wrapping does not apply to this collateral.' : undefined) ?? (funding?.wrap === 0n ? copy.noWrap : undefined)
	const requestReason =
		walletReason ??
		(snapshot?.observation !== undefined && funding !== undefined && snapshot.observation.wethBalanceAttoEth < funding.weth ? copy.insufficientWeth : undefined) ??
		(snapshot?.observation !== undefined && funding !== undefined && (snapshot.observation.wethAllowanceAttoEth < funding.weth || snapshot.observation.repAllowanceAttoRep < funding.rep) ? copy.approvalRequired : undefined)
	const selectedReportReason =
		baseReason ??
		(snapshot?.observation === undefined ? scoped.prepareFirst : undefined) ??
		(reportInput.value.trim() !== '' && (reportId === undefined || reportId === 0n) ? copy.reportInvalid : undefined) ??
		(reportId === undefined || reportId === 0n ? copy.noReport : undefined) ??
		reportState?.error ??
		(report === undefined ? scoped.reportLoading : undefined)
	// Nothing loads without a target, so the report waits for one instead of showing a load that never ends.
	const refreshReason = (target === undefined ? scoped.missingTarget : undefined) ?? (current === undefined ? scoped.loading : undefined)
	const feeReason = (selected: SecurityPoolPriceReport | undefined) => (selected?.recoveryBaseFeeBlocked === true ? copy.waitForBaseFee : undefined)
	const settleReason = selectedReportReason ?? (report?.state.settled ? copy.alreadySettled : undefined) ?? (snapshot !== undefined && report !== undefined && snapshot.timestamp < report.eligibleAt ? copy.waitForSettlement : undefined)
	const recoverReason = selectedReportReason ?? (!report?.state.settled ? copy.notSettled : undefined) ?? (report?.outcome !== 0n ? copy.callbackComplete : undefined) ?? feeReason(report)
	const withdrawReason = selectedReportReason ?? (report?.wethCredit === 0n && report.repCredit === 0n ? copy.noFunding : undefined)
	const canRedirectFunding = snapshot !== undefined && report !== undefined && getAddress(snapshot.owner) === getAddress(report.sponsor)
	const recipientSelection = recipientInput.value
	const recipientValue = recipientSelection !== undefined && recipientSelection.reportId === reportId ? recipientSelection.value : ''
	const recipientDraft = canRedirectFunding ? recipientValue.trim() : ''
	const parsedRecipient = isAddress(recipientDraft) ? getAddress(recipientDraft) : undefined
	const recipient = recipientDraft === '' ? report?.sponsor : parsedRecipient
	const recipientError = recipientDraft !== '' && (recipient === undefined || recipient === zeroAddress || recipient === report?.escrow) ? copy.invalidWithdrawalRecipient : undefined
	const credit = (selected: SecurityPoolPriceReport | undefined, token: 'collateral' | 'rep') => (token === 'collateral' ? selected?.wethCredit : selected?.repCredit)
	const tokenWithdrawReason = (token: 'collateral' | 'rep') => selectedReportReason ?? recipientError ?? (credit(report, token) === 0n ? copy.noFunding : undefined)

	const run = (action: string, label: string, reason: string | undefined, build: (selected: SecurityPoolPriceSnapshot) => SecurityPoolTransaction, check: (latest: SecurityPoolPriceSnapshot) => Promise<void> = async () => undefined, captureReport = false) =>
		actions.runSecurityPoolAction(
			action,
			label,
			() => {
				if (reason !== undefined || snapshot === undefined) throw new Error(reason ?? scoped.loading)
				const selected = snapshot
				return {
					...build(selected),
					validateBeforeSubmit: async () => {
						if (getActiveBackend() !== backend || previous.current?.identity !== identity) throw new Error('Price feed or wallet environment changed. Review again.')
						const latest = await loadSecurityPoolBranchPrice(createConnectedReadClient(), selected.securityPool, selected.owner, selected.universeId)
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
				if (getActiveBackend() !== backend) return
				let createdReportId: bigint | undefined
				if (captureReport && snapshot !== undefined) {
					createdReportId = submittedSecurityPoolPriceReport(result.receipt, snapshot.feed)
					if (createdReportId !== undefined) rememberSecurityPoolPriceReport(profile, snapshot.securityPool, snapshot.universeId, snapshot.owner, createdReportId, { number: result.receipt.blockNumber, timestamp: snapshot.timestamp })
				}
				if (previous.current?.identity !== identity) return
				if (createdReportId !== undefined) reportInput.value = createdReportId.toString()
				version.value += 1
			},
		)
	const freshFunding = (latest: SecurityPoolPriceSnapshot, submitsRequest = false) => {
		if (!latest.reportingOpen) throw new Error(scoped.closed)
		if (reportingDeadline !== undefined && latest.observation !== undefined && latest.timestamp + latest.observation.settlementSeconds >= reportingDeadline) throw new Error(copy.tooLate)
		if (price === undefined || requestedWeth === undefined || funding === undefined) throw new Error(copy.priceInvalid)
		const fresh = quoteSecurityPoolPriceFunding(latest, price, requestedWeth)
		if (fresh.weth !== funding.weth || fresh.rep !== funding.rep || (submitsRequest && fresh.bounty > funding.bounty)) {
			version.value += 1
			throw new Error('Report funding changed. Review the updated amounts before trying again.')
		}
		return submitsRequest ? { ...fresh, bounty: funding.bounty, requiredEth: fresh.wrap + funding.bounty } : fresh
	}
	const withReport = (build: (selected: SecurityPoolPriceSnapshot, selectedReport: SecurityPoolPriceReport) => SecurityPoolTransaction) => (selected: SecurityPoolPriceSnapshot) => {
		if (report === undefined) throw new Error(copy.noReport)
		return build(selected, report)
	}
	const freshReport = async (latest: SecurityPoolPriceSnapshot) => {
		if (report === undefined) throw new Error(copy.noReport)
		const fresh = await loadSecurityPoolPriceReport(createConnectedReadClient(), latest, report.reportId)
		if (fresh.escrow !== report.escrow || fresh.state.stateHash !== report.state.stateHash) throw new Error('This report changed. Refresh and review it again.')
		return fresh
	}
	const withdrawToken = (token: 'collateral' | 'rep') => {
		const symbol = token === 'collateral' ? collateral.symbol : 'REP'
		return run(
			securityPoolPriceAction(scope, token === 'collateral' ? 'withdrawCollateral' : 'withdrawRep'),
			copy.withdrawToken(symbol),
			tokenWithdrawReason(token),
			withReport((selected, selectedReport) => {
				if (recipient === undefined) throw new Error(copy.invalidWithdrawalRecipient)
				return { ...buildSecurityPoolPriceTokenWithdrawal(selected, selectedReport, token, recipient), reviewDescription: copy.tokenWithdrawalReview(symbol, recipient) }
			}),
			async latest => {
				const fresh = await freshReport(latest)
				if (fresh.sponsor !== report?.sponsor) throw new Error(copy.reportFunderChanged)
				if (credit(fresh, token) === 0n) throw new Error(copy.noFunding)
			},
		)
	}
	return {
		collateral,
		proposedPrice: price,
		comparisonPrice: loadedReference.current?.price,
		snapshot,
		report: report ?? savedReport?.value,
		savedReportAt: savedReport?.savedAt,
		savedReportTimestamp: savedReport?.timestamp,
		funding,
		minimumWethAttoEth,
		reportingDeadline,
		earliestSettlement,
		fundingReadError: current?.error ?? fundingError,
		error: current?.error ?? reportState?.error ?? fundingError,
		loading: target !== undefined && current === undefined,
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
			recipientInput.value = undefined
		},
		prepareReason,
		fundingReason,
		wrapReason,
		requestReason,
		settleReason,
		recoverReason,
		withdrawReason,
		withdrawCollateralReason: tokenWithdrawReason('collateral'),
		withdrawRepReason: tokenWithdrawReason('rep'),
		withdrawToken,
		canRedirectFunding,
		recipientInput: recipientValue,
		recipientError,
		setRecipient: (value: string) => {
			if (reportId !== undefined) recipientInput.value = { reportId, value }
		},
		refreshReason,
		/** Changes only when the drafts reset (another security pool, sponsor, universe or environment), never on a block reload or while folded. */
		draftKey: previous.current?.identity,
		refresh: () => {
			version.value += 1
		},
		actionId: (name: keyof typeof actionNames) => securityPoolPriceAction(scope, name),
		prepare: () => run(securityPoolPriceAction(scope, 'prepare'), copy.prepare, prepareReason, buildSecurityPoolPricePreparationRequest),
		wrap: () =>
			run(
				securityPoolPriceAction(scope, 'wrap'),
				copy.wrap,
				wrapReason,
				selected => {
					if (funding === undefined) throw new Error(copy.priceInvalid)
					return buildSecurityPoolPriceWrapRequest(selected, funding.wrap)
				},
				async latest => {
					const fresh = freshFunding(latest)
					if (fresh.wrap !== funding?.wrap || latest.ethBalanceAttoEth < fresh.requiredEth) throw new Error('Wallet funding changed. Refresh before wrapping ETH.')
				},
			),
		approve: (token: 'weth' | 'rep', amount: bigint) =>
			run(
				securityPoolPriceAction(scope, token === 'weth' ? 'approveWeth' : 'approveRep'),
				token === 'weth' ? copy.approveWeth : copy.approveRep,
				fundingReason,
				selected => ({
					...buildSecurityPoolPriceApprovalRequest(selected, token, amount),
					reviewDescription: scoped.formatApprovalReview(selected.feed, formatUnits(amount, token === 'weth' ? collateral.decimals : 18), token, collateral.symbol),
				}),
				async latest => {
					freshFunding(latest)
				},
			),
		request: () =>
			run(
				securityPoolPriceAction(scope, 'request'),
				scoped.request,
				requestReason,
				selected => {
					if (price === undefined || requestedWeth === undefined || funding === undefined) throw new Error(copy.priceInvalid)
					return {
						...buildSecurityPoolPriceRequest(selected, price, requestedWeth),
						reviewDescription: scoped.formatRequestReview(formatUnits(funding.weth, collateral.decimals), formatEther(funding.rep), formatEther(funding.bounty), collateral.symbol),
					}
				},
				async latest => {
					const fresh = freshFunding(latest, true)
					const observation = latest.observation
					if (observation === undefined || observation.wethBalanceAttoEth < fresh.weth || observation.repBalanceAttoRep < fresh.rep || latest.ethBalanceAttoEth < fresh.bounty) throw new Error('Wallet report funding is insufficient.')
					if (observation.wethAllowanceAttoEth < fresh.weth || observation.repAllowanceAttoRep < fresh.rep) throw new Error(copy.approvalRequired)
				},
				true,
			),
		settle: () =>
			run(
				securityPoolPriceAction(scope, 'settle'),
				copy.settle,
				settleReason,
				withReport((selected, selectedReport) => ({
					...buildSecurityPoolPriceSettlement(selected, selectedReport),
					reviewDescription: copy.formatSettlementReview(selectedReport.baseFeePerGas === undefined ? undefined : formatUnits(selectedReport.baseFeePerGas, 9), formatUnits(selectedReport.maxSettlementBaseFee, 9)),
				})),
				async latest => {
					const fresh = await freshReport(latest)
					if (fresh.state.settled || latest.timestamp < fresh.eligibleAt) throw new Error('This report is not ready to settle.')
				},
			),
		recover: () =>
			run(securityPoolPriceAction(scope, 'recover'), copy.recover, recoverReason, withReport(buildSecurityPoolPriceRecovery), async latest => {
				const fresh = await freshReport(latest)
				if (!fresh.state.settled || fresh.outcome !== 0n) throw new Error(copy.callbackComplete)
				if (feeReason(fresh) !== undefined) throw new Error(copy.waitForBaseFee)
			}),
		withdraw: () =>
			run(securityPoolPriceAction(scope, 'withdraw'), copy.withdraw, withdrawReason, withReport(buildSecurityPoolPriceFundingWithdrawal), async latest => {
				const fresh = await freshReport(latest)
				if (fresh.wethCredit === 0n && fresh.repCredit === 0n) throw new Error(copy.noFunding)
			}),
	}
}
