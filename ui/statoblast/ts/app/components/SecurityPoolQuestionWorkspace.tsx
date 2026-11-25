import { decodeSharesBalance, SavedShares } from './SavedShares.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { decodeReportingOverview, reportingOverview, StatoblastReportingOverview } from './StatoblastReportingOverview.js'
import { openHistory } from '../lib/watchlistHistory.js'
import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'
import { useStatoblastPageRefresh, useStatoblastRefreshError, type RegisterStatoblastPageRefresh, type ReportStatoblastReadStatus } from '@zoltar/ui-statoblast-shared/features/useStatoblastPageRefresh.js'
import { StatoblastSharesFacts } from './StatoblastSharesFacts.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { decodeQuestionHeading, StatoblastQuestionHead } from './StatoblastQuestionHead.js'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { LocateReportingDeposits } from '@zoltar/ui-statoblast-shared/features/reporting/components/LocateReportingDeposits.js'
import { statoblastPageHref, questionTabs, type StatoblastQuestionPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { InheritedReporterClaims } from '@zoltar/ui-statoblast-shared/features/reporting/components/InheritedReporterClaims.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { useOwnForkTrigger } from '../hooks/useOwnForkTrigger.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { ReportingSection } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingSection.js'
import { TradingSection } from '@zoltar/ui-statoblast-shared/features/markets/components/TradingSection.js'
import { getSelectedOutcomeShareBalance } from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { statoblastDisplayCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'
import { loadStatoblastQuestion, type QuestionReadCheckpoint } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
import { withStatoblastRequestTimeout } from '@zoltar/ui-statoblast-shared/protocol/requestTimeout.js'
import { deadlineRetryDelays } from '@zoltar/ui-statoblast-shared/lib/deadlineRefresh.js'
import type { ListedQuestionLedger } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { AccountState, WriteOperationsParameters } from '@zoltar/ui-statoblast-shared/types/app.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'

type Props = {
	accountState: AccountState
	parameters: WriteOperationsParameters
	deploymentStatuses: DeploymentStatus[]
	enabled: boolean
	environmentKey: number
	universeId: bigint
	currentTimestamp: bigint | undefined
	entry: StatoblastQuestionPage
	readUnavailable?: boolean
	registerPageRefresh?: RegisterStatoblastPageRefresh | undefined
	onReadStatus?: ReportStatoblastReadStatus | undefined
	autoRefresh?: boolean
	openDepositSearch?: boolean
}

/** Question-specific shares and reporting; backing, liquidation and auctions live in the security pool workspace. */
export function SecurityPoolQuestionWorkspace({ accountState, parameters, deploymentStatuses, enabled, environmentKey, universeId, currentTimestamp, entry, readUnavailable = false, registerPageRefresh, onReadStatus, autoRefresh = false, openDepositSearch = false }: Props) {
	const [snapshot, setSnapshot] = useState<{ environmentKey: number; identity: string; observedAt: number; block: { number: bigint; timestamp: bigint }; question: ListedQuestionLedger; sharesFacts: Awaited<ReturnType<typeof loadStatoblastQuestion>>['sharesFacts'] }>()
	const selectionKey = `${entry.pool}:${entry.questionId}:${universeId}`
	const selected = snapshot?.environmentKey === environmentKey && snapshot.identity === selectionKey ? snapshot.question : undefined
	const [cachedHeading, setCachedHeading] = useState<{ scope: string; page: NonNullable<ReturnType<typeof displayCache.read>> }>()
	const cacheScope = `${environmentKey}:${selectionKey}:${accountState.address ?? ''}`
	const readScope = `${cacheScope}:${entry.tab}`
	const displayCache = statoblastDisplayCache(getActiveNetworkProfile(), { universeId, owner: accountState.address, page: selectionKey }, decodeQuestionHeading)
	const cached = cacheScope === cachedHeading?.scope ? cachedHeading.page : undefined
	const [reportRead, setReportRead] = useState<{ scope: string; at: number }>()
	const [sharesRead, setSharesRead] = useState<{ scope: string; at: number }>()
	const [loading, setLoading] = useState(false)
	const [failure, setFailure] = useState<{ scope: string; message: string }>()
	const loadError = failure?.scope === readScope ? failure.message : undefined
	const [refresh, setRefresh] = useState(0)
	const [deadlineFailed, setDeadlineFailed] = useState(false)
	const [cachedReporting, setCachedReporting] = useState<{ scope: string; data: NonNullable<ReturnType<typeof decodeReportingOverview>> }>()
	const [cachedShares, setCachedShares] = useState<{ scope: string; savedAt: number; data: NonNullable<ReturnType<typeof decodeSharesBalance>> }>()
	const profile = getActiveNetworkProfile()
	const reportCache = statoblastDisplayCache(profile, { universeId, owner: accountState.address, page: `reporting:${selectionKey}` }, decodeReportingOverview)
	const sharesCache = statoblastDisplayCache(profile, { universeId, owner: accountState.address, page: `shares:${selectionKey}` }, decodeSharesBalance)
	const ledgerAddress = selected?.questionLedgerAddress
	const reporting = useReportingOperations({ ...parameters, selectedQuestionLedgerAddress: ledgerAddress ?? '', includeSchedule: entry.tab === 'reporting' })
	const reportingDetails = reporting.reportingDetails?.questionLedgerAddress === ledgerAddress ? reporting.reportingDetails : undefined
	const trading = useTradingOperations({
		...parameters,
		deploymentStatuses,
		enabled: enabled && selected !== undefined,
		selectedQuestionLedgerAddress: ledgerAddress ?? '',
		onTransactionPresented: presentation => parameters.onTransactionPresented({ ...presentation, showStatusDialog: false }),
	})
	useEffect(() => {
		const page = displayCache.read()
		setCachedHeading(page === undefined ? undefined : { scope: cacheScope, page })
		const storedReporting = reportCache.read()
		const storedShares = sharesCache.read()
		setCachedReporting(storedReporting === undefined ? undefined : { scope: cacheScope, data: storedReporting.value })
		setCachedShares(storedShares === undefined ? undefined : { scope: cacheScope, savedAt: storedShares.savedAt, data: storedShares.value })
	}, [cacheScope])
	const requestScope = useRef(readScope)
	requestScope.current = readScope
	const activeRead = useRef<{ scope: string; abort: AbortController; promise: Promise<void> }>()
	const questionRead = useRef<{ scope: string; checkpoint: QuestionReadCheckpoint }>()
	const [readStep, setReadStep] = useState(1)
	const reportFallback = cachedReporting?.scope === cacheScope && reportingDetails === undefined ? cachedReporting.data : undefined
	const sharesFallback = cachedShares?.scope === cacheScope && trading.tradingDetails?.shareBalances === undefined ? cachedShares : undefined
	const reportCheckedAt = reportRead?.scope === cacheScope ? reportRead.at : undefined
	const sharesCheckedAt = sharesRead?.scope === cacheScope ? sharesRead.at : undefined
	const dataAge = entry.tab === 'shares' ? (sharesFallback?.savedAt ?? sharesCheckedAt) : (reportFallback?.checkedAt ?? reportCheckedAt)
	const headingAge = selected !== undefined ? snapshot?.observedAt : cached?.savedAt
	const displayedAt = headingAge !== undefined && dataAge !== undefined ? Math.min(dataAge, headingAge) : (headingAge ?? dataAge)
	const refreshError = useStatoblastRefreshError(loadError, displayedAt)
	const readQuestion = () => {
		if (!enabled || document.hidden) return Promise.resolve()
		if (activeRead.current?.scope === readScope) return activeRead.current.promise
		const abort = new AbortController()
		const request = {
			scope: readScope,
			abort,
			promise: Promise.resolve().then(async () => {
				const isCurrent = () => requestScope.current === readScope && activeRead.current === request
				const showReadError = (error: unknown) => {
					if (isCurrent()) setFailure({ scope: readScope, message: getErrorMessage(error, copy.questionUnavailable) })
				}
				setFailure(undefined)
				setReadStep(1)
				setLoading(true)
				try {
					if (questionRead.current?.scope !== readScope) questionRead.current = { scope: readScope, checkpoint: {} }
					const client = withStatoblastRequestTimeout(createConnectedReadClient(), pageCopy.refreshTimeoutError, abort.signal)
					const { question, block, sharesFacts, observedAt } = await loadStatoblastQuestion(client, entry.pool, entry.questionId, universeId, true, entry.tab === 'shares', questionRead.current.checkpoint)
					if (!isCurrent()) return
					if (selected !== undefined && ledgerAddress === question.questionLedgerAddress) {
						setReadStep(2)
						const details = await (entry.tab === 'shares' ? trading.refreshShares(showReadError) : reporting.readReporting(showReadError))
						if (details === undefined || !isCurrent()) return
					}
					setSnapshot({ environmentKey, identity: selectionKey, block, question, sharesFacts, observedAt })
					displayCache.write(question, block, observedAt)
					questionRead.current = undefined
					setRefresh(value => value + 1)
				} catch (error) {
					showReadError(error)
				} finally {
					if (isCurrent()) {
						setLoading(false)
						activeRead.current = undefined
					}
				}
			}),
		}
		activeRead.current = request
		return request.promise
	}
	const readVisibleQuestion = useRef(readQuestion)
	readVisibleQuestion.current = readQuestion
	useStatoblastPageRefresh(registerPageRefresh, readQuestion)
	useBlockRefresh(() => void readQuestion(), enabled)
	useEffect(() => {
		if (!enabled) {
			setLoading(false)
			return
		}
		const cancel = () => {
			if (questionRead.current?.scope === readScope) questionRead.current = undefined
			if (activeRead.current?.scope !== readScope) return
			activeRead.current.abort.abort()
			activeRead.current = undefined
		}
		const visibilityChanged = () => {
			if (!document.hidden) {
				void readVisibleQuestion.current()
				return
			}
			cancel()
			setLoading(false)
		}
		document.addEventListener('visibilitychange', visibilityChanged)
		void readQuestion()
		return () => {
			document.removeEventListener('visibilitychange', visibilityChanged)
			cancel()
		}
	}, [enabled, readScope])
	useEffect(() => onReadStatus?.(displayedAt, loading ? pageCopy.refreshStep(readStep, 2) : undefined), [displayedAt, loading, readStep, onReadStatus])
	useEffect(() => {
		if (selected === undefined) return
		reporting.setReportingForm(form => ({ ...form, questionLedgerAddress: selected.questionLedgerAddress }))
		void reporting.loadReporting()
	}, [selected?.questionLedgerAddress, environmentKey])
	const visible = usePageVisible()
	let chainTime = snapshot?.identity === selectionKey ? snapshot.block.timestamp : currentTimestamp
	if (reportingDetails !== undefined && (chainTime === undefined || reportingDetails.currentTime > chainTime)) chainTime = reportingDetails.currentTime
	const [clock, setClock] = useState<{ chainTime: bigint; readAt: number; now: bigint }>()
	useEffect(() => {
		if (chainTime === undefined || !visible) return
		const readAt = clock?.chainTime === chainTime ? clock.readAt : Date.now()
		const update = () => setClock({ chainTime, readAt, now: chainTime + BigInt(Math.floor(Math.max(0, Date.now() - readAt) / 1000)) })
		update()
		const tick = setInterval(update, 1000)
		return () => clearInterval(tick)
	}, [chainTime, visible])
	const now = clock?.chainTime === chainTime ? clock?.now : chainTime
	const activeReporting = reportingDetails?.status === 'active' ? reportingDetails : undefined
	const liveDeadline = activeReporting?.hasReachedNonDecision !== true && selected?.questionOutcome === 'none' && !selected.universeHasForked ? (activeReporting?.escalationEndTime ?? selected.marketDetails.endTime) : undefined
	const checkingDeadline = liveDeadline !== undefined && liveDeadline > 0n && chainTime !== undefined && now !== undefined && chainTime < liveDeadline && now >= liveDeadline
	const boundaryRead = useRef<{ scope: string; attempts: number }>()
	useEffect(() => {
		const boundary = `${readScope}:${liveDeadline}`
		if (boundaryRead.current?.scope !== boundary) {
			boundaryRead.current = { scope: boundary, attempts: 0 }
			setDeadlineFailed(false)
		}
		if (!checkingDeadline || !enabled || !visible || loading || deadlineFailed) return
		const attempts = boundaryRead.current.attempts
		const delay = deadlineRetryDelays[attempts]
		if (delay === undefined) {
			setDeadlineFailed(true)
			return
		}
		const timer = setTimeout(() => {
			boundaryRead.current = { scope: boundary, attempts: attempts + 1 }
			void readQuestion()
		}, delay)
		return () => clearTimeout(timer)
	}, [readScope, liveDeadline, checkingDeadline, enabled, visible, loading, deadlineFailed])
	const ownFork = useOwnForkTrigger({
		active: selected !== undefined && !selected.universeHasForked && reportingDetails?.status === 'active' && reportingDetails.hasReachedNonDecision && reportingDetails.canTriggerOwnFork !== false,
		onForked: async hash => {
			if (selected === undefined) return
			await readQuestion()
			parameters.onTransactionPresented({ hash, title: copy.universeForkTriggered, tone: 'success', showStatusDialog: false, universeId: selected.universeId })
		},
		parameters,
		question: selected,
		refreshKey: refresh,
	})
	const retryQuestion = () => {
		boundaryRead.current = undefined
		setDeadlineFailed(false)
		void readQuestion()
	}
	const lastDisplayedDetails = useRef<{ scope: string; data: typeof reportingDetails }>()
	useEffect(() => {
		if (reportingDetails === undefined || (lastDisplayedDetails.current?.scope === cacheScope && lastDisplayedDetails.current.data === reportingDetails) || snapshot?.identity !== selectionKey) return
		lastDisplayedDetails.current = { scope: cacheScope, data: reportingDetails }
		const checkedAt = Date.now()
		setReportRead({ scope: cacheScope, at: checkedAt })
		reportCache.write(reportingOverview(reportingDetails, checkedAt), snapshot.block)
	}, [reportingDetails, cacheScope, snapshot])
	const shareBalances = trading.tradingDetails?.shareBalances
	const shareDecimals = trading.collateralFunding.collateral?.decimals
	const lastDisplayedBalances = useRef<{ scope: string; data: typeof shareBalances }>()
	const lastSavedBalances = useRef<{ scope: string; data: typeof shareBalances; decimals: number }>()
	useEffect(() => {
		if (shareBalances === undefined || (lastDisplayedBalances.current?.scope === cacheScope && lastDisplayedBalances.current.data === shareBalances) || snapshot?.identity !== selectionKey || selected === undefined) return
		lastDisplayedBalances.current = { scope: cacheScope, data: shareBalances }
		setSharesRead({ scope: cacheScope, at: Date.now() })
	}, [shareBalances, snapshot, cacheScope])
	useEffect(() => {
		if (shareBalances === undefined || shareDecimals === undefined || snapshot?.identity !== selectionKey) return
		if (lastSavedBalances.current?.scope === cacheScope && lastSavedBalances.current.data === shareBalances && lastSavedBalances.current.decimals === shareDecimals) return
		lastSavedBalances.current = { scope: cacheScope, data: shareBalances, decimals: shareDecimals }
		const data = { ...shareBalances, decimals: shareDecimals }
		const savedAt = Date.now()
		sharesCache.write(data, snapshot.block)
		setCachedShares({ scope: cacheScope, savedAt, data })
	}, [shareBalances, shareDecimals, snapshot, cacheScope])
	useEffect(() => {
		if (selected === undefined) return
		openHistory(profile).updateTitle(entry, selected.marketDetails.title, universeId)
	}, [profile, selectionKey, selected?.marketDetails.title])
	const availableClaim = reportingDetails?.settlementState === 'resolved' && activeReporting?.sides.some(side => side.key === reportingDetails.questionOutcome && side.userDeposits.some(deposit => deposit.amountAttoRep > 0n))
	const loadingShares = entry.tab === 'shares' && (loading || trading.loadingTradingDetails) && trading.tradingDetails === undefined && sharesFallback === undefined
	const loadingReporting = entry.tab === 'reporting' && (loading || reporting.loadingReportingDetails) && reportingDetails === undefined && reportFallback === undefined
	const winningOutcome = selected?.questionOutcome ?? cached?.value.questionOutcome
	const visibleShareBalances = shareBalances ?? sharesFallback?.data
	const winningBalance = winningOutcome === undefined || winningOutcome === 'none' ? undefined : getSelectedOutcomeShareBalance(visibleShareBalances, winningOutcome)
	const hasShares = visibleShareBalances !== undefined && (visibleShareBalances.yesAttoShares > 0n || visibleShareBalances.noAttoShares > 0n || visibleShareBalances.invalidAttoShares > 0n)
	const winningDecimals = shareDecimals ?? sharesFallback?.data.decimals
	const canRedeemShares = accountState.address !== undefined && (winningBalance ?? 0n) > 0n
	const winningShares = canRedeemShares && winningBalance !== undefined && winningDecimals !== undefined ? { winningShares: { amount: winningBalance, decimals: winningDecimals, href: statoblastPageHref({ ...entry, tab: 'shares', sharesAction: 'redeem' }) } } : undefined
	const tabLabels = { shares: pageCopy.shares, reporting: pageCopy.reporting, claims: pageCopy.inheritedClaims }
	const tabs = (
		<nav className='statoblast-page-tabs' aria-label={pageCopy.questionViews}>
			{questionTabs.map(tab =>
				tab === 'claims' && activeReporting?.forkContinuation !== true && entry.tab !== 'claims' ? undefined : (
					<a key={tab} aria-current={entry.tab === tab ? 'page' : undefined} href={statoblastPageHref({ ...entry, tab, sharesAction: undefined })}>
						{tabLabels[tab]}
						{tab === 'shares' && canRedeemShares && <Badge tone='ok'>{pageCopy.redeemAction}</Badge>}
						{tab === 'reporting' && availableClaim && <Badge tone='ok'>{pageCopy.claimAction}</Badge>}
						{tab === 'reporting' && activeReporting?.hasReachedNonDecision && activeReporting.settlementState !== 'resolved' && selected?.questionOutcome === 'none' && !selected.universeHasForked && <Badge tone='warning'>{pageCopy.fork}</Badge>}
					</a>
				),
			)}
		</nav>
	)
	if (selected === undefined) {
		const unavailable = loadError?.includes('Question pool unavailable') === true
		if (cached !== undefined && !unavailable && loadError?.includes('Question not registered') !== true) {
			return (
				<div className='route-view-flow'>
					<StatoblastQuestionHead page={entry} question={cached.value} reporting={undefined} now={cached.timestamp} hasShares={false} presentationOnly />
					<UpdatedAgo updatedAt={displayedAt} refreshing={loading} />
					{tabs}
					{entry.tab === 'shares' && cachedShares?.scope === cacheScope && <SavedShares {...cachedShares.data} />}
					{entry.tab === 'reporting' && cachedReporting?.scope === cacheScope && <StatoblastReportingOverview view={cachedReporting.data} now={cached.timestamp} autoRefresh={autoRefresh} {...winningShares} />}
					{loadingShares && <QuestionTabSkeleton label={pageCopy.loadingShares} />}
					{loadingReporting && <QuestionTabSkeleton label={pageCopy.loadingReporting} />}
					<RetryableNotice message={readUnavailable ? undefined : refreshError} retryLabel={pageCopy.tryAgain} onRetry={retryQuestion} disabled={loading} />
				</div>
			)
		}
		if (readUnavailable) return undefined
		if (loadError === undefined) {
			return (
				<div className='route-view-flow statoblast-question-loading'>
					<span className='visually-hidden' role='status'>
						{pageCopy.loadingQuestionDetails}
					</span>
					<div className='statoblast-question-skeleton' aria-busy='true' aria-hidden='true'>
						<span className='skeleton-line skeleton-line-title' />
						<div className='statoblast-question-head'>
							<span className='skeleton-line skeleton-line-detail' />
							<span className='skeleton-line' />
						</div>
						<span className='skeleton-line statoblast-question-skeleton-progress' />
						<div className='statoblast-question-skeleton-metrics'>
							{[1, 2, 3].map(index => (
								<div key={index}>
									<span className='skeleton-line skeleton-line-title' />
									<span className='skeleton-line' />
								</div>
							))}
						</div>
					</div>
					{tabs}
				</div>
			)
		}
		const forkPage = { kind: 'pool', pool: entry.pool, tab: 'fork' } as const
		const destination = unavailable ? statoblastPageHref(forkPage, universeId) : statoblastPageHref({ kind: 'watchlist' })
		return (
			<EmptyState
				title={copy.questionUnavailable}
				detail={unavailable ? pageCopy.questionUnprepared : loadError}
				actions={
					<>
						{!unavailable && (
							<button className='secondary' type='button' onClick={retryQuestion}>
								{pageCopy.tryAgain}
							</button>
						)}
						<a href={destination} onClick={() => unavailable && openHistory(profile).add(forkPage, entry.pool, universeId)}>
							{unavailable ? pageCopy.forkRecovery : pageCopy.watchlist}
						</a>
					</>
				}
			/>
		)
	}

	return (
		<div className='route-view-flow'>
			<StatoblastQuestionHead page={entry} question={selected} reporting={reportingDetails} now={now} checkingDeadline={checkingDeadline} hasShares={hasShares} />
			<UpdatedAgo updatedAt={displayedAt} refreshing={loading} />
			<RetryableNotice message={readUnavailable ? undefined : refreshError} retryLabel={pageCopy.tryAgain} onRetry={retryQuestion} disabled={loading} />
			<ErrorNotice message={ownFork.error} />
			{tabs}
			{entry.tab === 'shares' && <StatoblastSharesFacts question={selected} facts={snapshot?.sharesFacts} now={now} />}
			{loadingShares && <QuestionTabSkeleton label={pageCopy.loadingShares} />}
			{entry.tab === 'shares' && (
				<TradingSection
					actionDataReadAt={sharesCheckedAt}
					requestedSharesAction={entry.sharesAction}
					savedHoldings={sharesFallback === undefined ? undefined : <SavedShares {...sharesFallback.data} />}
					accountState={accountState}
					loadingTradingDetails={trading.loadingTradingDetails}
					loadingTradingForkUniverse={trading.loadingTradingForkUniverse}
					collateralFunding={trading.collateralFunding}
					mintLimits={trading.mintLimits}
					onCreateCompleteSet={trading.createCompleteSet}
					onMigrateShares={trading.migrateShares}
					onRedeemCompleteSet={trading.redeemCompleteSet}
					onRedeemShares={trading.redeemShares}
					onTradingFormChange={update => trading.setTradingForm(form => ({ ...form, ...update }))}
					selectedPool={selected}
					tradingActiveAction={trading.tradingActiveAction}
					tradingDetails={trading.tradingDetails}
					tradingError={trading.tradingError}
					tradingForkUniverse={trading.tradingForkUniverse}
					tradingForm={trading.tradingForm}
					tradingResult={trading.tradingResult}
					embedInCard
				/>
			)}
			{entry.tab === 'reporting' && reportingDetails !== undefined && (
				<StatoblastReportingOverview
					view={reportingOverview(reportingDetails, reportCheckedAt ?? displayedAt ?? Date.now())}
					now={now}
					autoRefresh={autoRefresh}
					checkingDeadline={checkingDeadline}
					question={selected}
					{...winningShares}
					onTakeLead={(outcome, amount) => {
						const side = activeReporting?.sides.find(candidate => candidate.label === outcome)
						if (side === undefined) return
						reporting.setReportingForm(form => ({ ...form, selectedOutcome: side.key, reportAmount: formatCurrencyInputBalance(amount) }))
						const input = document.getElementById('reporting-contribution-amount')
						input?.scrollIntoView({ block: 'center' })
						input?.focus()
					}}
				/>
			)}
			{entry.tab === 'reporting' && reportFallback !== undefined && <StatoblastReportingOverview view={reportFallback} now={now} autoRefresh={autoRefresh} checkingDeadline={checkingDeadline} {...winningShares} />}
			{deadlineFailed && (
				<button type='button' className='secondary' onClick={retryQuestion}>
					{pageCopy.tryAgain}
				</button>
			)}
			{loadingReporting && <QuestionTabSkeleton label={pageCopy.loadingReporting} />}
			{entry.tab === 'reporting' && (
				<ReportingSection
					actionDataReadAt={reportCheckedAt}
					accountState={accountState}
					currentTimestamp={now}
					showLifecycle={false}
					designedOverview
					manageDeadlineRefresh={false}
					embedInCard
					lockedReason={checkingDeadline ? pageCopy.deadlineChecking : undefined}
					allowInProgressClaims={false}
					loadingReportingDetails={reporting.loadingReportingDetails}
					onApproveReportingRep={reporting.onApproveReportingRep}
					onLoadReporting={reporting.loadReporting}
					onReportOutcome={reporting.onReportOutcome}
					onReportingFormChange={update => reporting.setReportingForm(form => ({ ...form, ...update }))}
					onWithdrawEscalation={reporting.withdrawEscalation}
					reportingActiveAction={reporting.reportingActiveAction}
					reportingDetails={reportingDetails}
					reportingError={reporting.reportingError}
					reportingForm={reporting.reportingForm}
					reportingResult={reporting.reportingResult}
					forkAlreadyTriggered={selected.universeHasForked}
					onOpenForkWorkflow={() => {
						window.location.hash = statoblastPageHref({ kind: 'pool', pool: selected.securityPoolAddress, tab: 'fork' }, selected.universeId)
					}}
					onTriggerZoltarFork={reportingDetails?.status === 'active' && reportingDetails.hasReachedNonDecision ? () => void ownFork.triggerFork() : undefined}
					triggerZoltarForkApproval={ownFork.approval}
					triggerZoltarForkAvailability={ownFork.triggerForkAvailability}
					triggerZoltarForkPending={ownFork.forkPending}
				/>
			)}
			{entry.tab === 'reporting' && reportingDetails?.status === 'active' && accountState.address !== undefined && <LocateReportingDeposits key={reportingDetails.escalationGameAddress} details={reportingDetails} wallet={accountState.address} refresh={reporting.loadReporting} openOnEntry={openDepositSearch} />}
			{entry.tab === 'claims' && <InheritedReporterClaims actionDataReadAt={reportCheckedAt} parameters={parameters} accountState={accountState} details={reportingDetails} onRefresh={reporting.loadReporting} />}
		</div>
	)
}

function QuestionTabSkeleton({ label }: { label: string }) {
	return (
		<section className='statoblast-question-skeleton' aria-busy='true'>
			<span className='visually-hidden' role='status'>
				{label}
			</span>
			<span className='skeleton-line skeleton-line-title' aria-hidden='true' />
			<div className='statoblast-question-skeleton-metrics' aria-hidden='true'>
				{[1, 2, 3].map(index => (
					<div key={index}>
						<span className='skeleton-line skeleton-line-title' />
						<span className='skeleton-line' />
					</div>
				))}
			</div>
			<span className='skeleton-line skeleton-line-detail' aria-hidden='true' />
		</section>
	)
}
