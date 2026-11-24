import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { decodeReportingOverview, reportingOverview, StatoblastReportingOverview } from './StatoblastReportingOverview.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import { openHistory } from '../lib/watchlistHistory.js'
import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'
import { useStatoblastPageRefresh, type RegisterStatoblastPageRefresh, type ReportStatoblastReadStatus } from '@zoltar/ui-statoblast-shared/features/useStatoblastPageRefresh.js'
import { StatoblastSharesFacts } from './StatoblastSharesFacts.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
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
import { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { statoblastDisplayCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'
import { loadStatoblastQuestion } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
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
	registerPageRefresh?: RegisterStatoblastPageRefresh | undefined
	onReadStatus?: ReportStatoblastReadStatus | undefined
	autoRefresh?: boolean
	openDepositSearch?: boolean
}

/** Question-specific shares and reporting; backing, liquidation and auctions live in the security pool workspace. */
export function SecurityPoolQuestionWorkspace({ accountState, parameters, deploymentStatuses, enabled, environmentKey, universeId, currentTimestamp, entry, registerPageRefresh, onReadStatus, autoRefresh = false, openDepositSearch = false }: Props) {
	const [snapshot, setSnapshot] = useState<{ environmentKey: number; identity: string; block: { number: bigint; timestamp: bigint }; question: ListedQuestionLedger; sharesFacts: Awaited<ReturnType<typeof loadStatoblastQuestion>>['sharesFacts'] }>()
	const selectionKey = `${entry.pool}:${entry.questionId}:${universeId}`
	const selected = snapshot?.environmentKey === environmentKey && snapshot.identity === selectionKey ? snapshot.question : undefined
	const [cachedHeading, setCachedHeading] = useState<{ scope: string; page: NonNullable<ReturnType<typeof displayCache.read>> }>()
	const cacheScope = `${environmentKey}:${selectionKey}:${accountState.address ?? ''}`
	const displayCache = statoblastDisplayCache(getActiveNetworkProfile(), { universeId, owner: accountState.address, page: selectionKey }, decodeQuestionHeading)
	const cached = cacheScope === cachedHeading?.scope ? cachedHeading.page : undefined
	const [lastRead, setLastRead] = useState<{ scope: string; at: number }>()
	const [loading, setLoading] = useState(false)
	const [loadError, setLoadError] = useState<string>()
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
	const trading = useTradingOperations({ ...parameters, deploymentStatuses, enabled: enabled && selected !== undefined, selectedQuestionLedgerAddress: ledgerAddress ?? '' })
	useEffect(() => {
		const page = displayCache.read()
		setCachedHeading(page === undefined ? undefined : { scope: cacheScope, page })
		const storedReporting = reportCache.read()
		const storedShares = sharesCache.read()
		setCachedReporting(storedReporting === undefined ? undefined : { scope: cacheScope, data: storedReporting.value })
		setCachedShares(storedShares === undefined ? undefined : { scope: cacheScope, savedAt: storedShares.savedAt, data: storedShares.value })
	}, [cacheScope])
	const readScope = `${cacheScope}:${entry.tab}`
	const requestScope = useRef(readScope)
	requestScope.current = readScope
	const activeRead = useRef<{ scope: string; promise: Promise<void> }>()
	const [readStep, setReadStep] = useState(1)
	const reportFallback = cachedReporting?.scope === cacheScope && reportingDetails === undefined ? cachedReporting.data : undefined
	const sharesFallback = cachedShares?.scope === cacheScope && trading.tradingDetails === undefined ? cachedShares : undefined
	const dataAge = entry.tab === 'shares' ? sharesFallback?.savedAt : reportFallback?.checkedAt
	const displayedAt = dataAge ?? (lastRead?.scope === readScope ? lastRead.at : cached?.savedAt)
	const readQuestion = () => {
		if (!enabled || document.hidden) return Promise.resolve()
		if (activeRead.current?.scope === readScope) return activeRead.current.promise
		const request = {
			scope: readScope,
			promise: Promise.resolve().then(async () => {
				const isCurrent = () => requestScope.current === readScope && activeRead.current === request
				setLoadError(undefined)
				setReadStep(1)
				setLoading(true)
				try {
					const { question, block, sharesFacts } = await withTimeout(loadStatoblastQuestion(createConnectedReadClient(), entry.pool, entry.questionId, universeId, true, entry.tab === 'shares'), 15_000, pageCopy.refreshTimeoutError)
					if (!isCurrent()) return
					setSnapshot({ environmentKey, identity: selectionKey, block, question, sharesFacts })
					displayCache.write(question, block)
					if (ledgerAddress === question.questionLedgerAddress) {
						setReadStep(2)
						const details = await (entry.tab === 'shares' ? trading.refreshShares() : reporting.readReporting())
						if (details === undefined) return
					}
					if (isCurrent()) {
						setLastRead({ scope: readScope, at: Date.now() })
						setRefresh(value => value + 1)
					}
				} catch (error) {
					if (isCurrent()) setLoadError(getErrorMessage(error, copy.questionUnavailable))
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
	useStatoblastPageRefresh(registerPageRefresh, readQuestion)
	useBlockRefresh(() => void readQuestion(), enabled)
	useEffect(() => {
		if (!enabled) {
			setLoading(false)
			return
		}
		void readQuestion()
		return () => {
			if (activeRead.current?.scope === readScope) activeRead.current = undefined
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
		const delay = [0, 500, 2000][attempts]
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
	const lastDisplayedDetails = useRef(reportingDetails)
	const [reportCheckedAt, setReportCheckedAt] = useState<number>()
	useEffect(() => {
		if (reportingDetails === undefined || lastDisplayedDetails.current === reportingDetails || snapshot?.identity !== selectionKey) return
		lastDisplayedDetails.current = reportingDetails
		const checkedAt = Date.now()
		setReportCheckedAt(checkedAt)
		reportCache.write(reportingOverview(reportingDetails, checkedAt), snapshot.block)
	}, [reportingDetails, cacheScope, snapshot])
	useEffect(() => {
		const balances = trading.tradingDetails?.shareBalances
		if (balances !== undefined && snapshot?.identity === selectionKey && selected !== undefined) sharesCache.write(balances, snapshot.block)
	}, [trading.tradingDetails, snapshot, cacheScope])
	useEffect(() => {
		if (selected === undefined) return
		openHistory(profile).add({ ...entry, tab: 'shares', sharesAction: undefined }, selected.marketDetails.title, universeId)
	}, [profile, selectionKey, selected?.marketDetails.title])
	const availableClaim = reportingDetails?.settlementState === 'resolved' && activeReporting?.sides.some(side => side.key === reportingDetails.questionOutcome && side.userDeposits.some(deposit => deposit.amountAttoRep > 0n))
	const tabLabels = { shares: pageCopy.shares, reporting: pageCopy.reporting, claims: pageCopy.inheritedClaims }
	const tabs = (
		<nav className='statoblast-page-tabs' aria-label={pageCopy.questionViews}>
			{questionTabs.map(tab =>
				tab === 'claims' && activeReporting?.forkContinuation !== true && entry.tab !== 'claims' ? undefined : (
					<a key={tab} aria-current={entry.tab === tab ? 'page' : undefined} href={statoblastPageHref({ ...entry, tab, sharesAction: undefined })}>
						{tabLabels[tab]}
						{tab === 'reporting' && availableClaim && <Badge tone='ok'>{pageCopy.claimAction}</Badge>}
						{tab === 'reporting' && activeReporting?.hasReachedNonDecision && !selected?.universeHasForked && <Badge tone='warning'>{pageCopy.fork}</Badge>}
					</a>
				),
			)}
		</nav>
	)
	const losing = reportingDetails?.status === 'active' && reportingDetails.settlementState === 'resolved' ? reportingDetails.sides.filter(side => side.key !== reportingDetails.questionOutcome).flatMap(side => side.deposits.map(deposit => ({ side, deposit }))) : []
	if (selected === undefined) {
		const unavailable = loadError?.includes('Question pool unavailable') === true
		if (cached !== undefined && !unavailable && loadError?.includes('Question not registered') !== true) {
			return (
				<div className='route-view-flow'>
					<StatoblastQuestionHead page={entry} question={cached.value} reporting={undefined} now={cached.timestamp} hasShares={false} presentationOnly />
					<UpdatedAgo updatedAt={displayedAt} refreshing={loading} />
					{tabs}
					{entry.tab === 'shares' && cachedShares?.scope === cacheScope && <SavedShares {...cachedShares.data} />}
					{entry.tab === 'reporting' && cachedReporting?.scope === cacheScope && <StatoblastReportingOverview view={cachedReporting.data} now={cached.timestamp} autoRefresh={autoRefresh} />}
					<RetryableNotice message={loadError === undefined ? undefined : copy.formatStaleQuestionDetails(loadError)} retryLabel={copy.retryQuestionDetails} onRetry={retryQuestion} disabled={loading} />
				</div>
			)
		}
		const destination = unavailable ? statoblastPageHref({ kind: 'pool', pool: entry.pool, tab: 'fork' }) : statoblastPageHref({ kind: 'watchlist' })
		return <EmptyState title={loading ? copy.loadingQuestion : copy.questionUnavailable} detail={unavailable ? pageCopy.questionUnprepared : (loadError ?? pageCopy.loadingQuestionDetails)} actions={<a href={destination}>{unavailable ? pageCopy.forkRecovery : pageCopy.watchlist}</a>} />
	}

	return (
		<div className='route-view-flow'>
			<StatoblastQuestionHead page={entry} question={selected} reporting={reportingDetails} now={now} checkingDeadline={checkingDeadline} hasShares={Object.values(trading.tradingDetails?.shareBalances ?? {}).some(balance => balance > 0n)} />
			<UpdatedAgo updatedAt={displayedAt} refreshing={loading} />
			<RetryableNotice message={loadError === undefined ? undefined : copy.formatStaleQuestionDetails(loadError)} retryLabel={copy.retryQuestionDetails} onRetry={retryQuestion} disabled={loading} />
			<ErrorNotice message={ownFork.error} />
			{tabs}
			{entry.tab === 'shares' && <StatoblastSharesFacts question={selected} facts={snapshot?.sharesFacts} now={now} />}
			{entry.tab === 'shares' && sharesFallback !== undefined && <SavedShares {...sharesFallback.data} />}
			{entry.tab === 'shares' && (
				<TradingSection
					requestedSharesAction={entry.sharesAction}
					accountState={accountState}
					loadingTradingDetails={trading.loadingTradingDetails}
					loadingTradingForkUniverse={trading.loadingTradingForkUniverse}
					collateralFunding={trading.collateralFunding}
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
					repPerEthPrice={selected.lastOraclePrice}
					repPerEthSource={selected.lastOraclePrice === undefined ? undefined : 'open-oracle'}
					repPerEthSourceUrl={undefined}
					showQuestionLedgerAddressInput={false}
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
			{entry.tab === 'reporting' && reportFallback !== undefined && <StatoblastReportingOverview view={reportFallback} now={now} autoRefresh={autoRefresh} checkingDeadline={checkingDeadline} />}
			{deadlineFailed && (
				<button type='button' className='secondary' onClick={retryQuestion}>
					{pageCopy.tryAgain}
				</button>
			)}
			{entry.tab === 'reporting' && (
				<ReportingSection
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
					showQuestionLedgerAddressInput={false}
				/>
			)}
			{entry.tab === 'reporting' && reportingDetails?.status === 'active' && accountState.address !== undefined && <LocateReportingDeposits key={reportingDetails.escalationGameAddress} details={reportingDetails} wallet={accountState.address} refresh={reporting.loadReporting} openOnEntry={openDepositSearch} />}
			{entry.tab === 'reporting' && losing.length > 0 && (
				<SectionBlock title={pageCopy.losingDeposits}>
					<ul>
						{losing.map(({ side, deposit }) => (
							<li key={`${side.key}:${deposit.depositIndex}`}>
								{side.label} #{deposit.depositIndex.toString()} · {deposit.originalAttoRep === undefined ? undefined : <CurrencyValue value={deposit.originalAttoRep} suffix={pageCopy.rep} />}
								{pageCopy.losingDepositPayoutTail}
							</li>
						))}
					</ul>
				</SectionBlock>
			)}
			{entry.tab === 'claims' && <InheritedReporterClaims parameters={parameters} accountState={accountState} details={reportingDetails} onRefresh={reporting.loadReporting} />}
		</div>
	)
}

function decodeSharesBalance(value: unknown) {
	return decodeStoredValue(value, read => ({ yesAttoShares: read.bigint('yesAttoShares'), noAttoShares: read.bigint('noAttoShares'), invalidAttoShares: read.bigint('invalidAttoShares') }))
}

function SavedShares({ yesAttoShares, noAttoShares, invalidAttoShares }: NonNullable<ReturnType<typeof decodeSharesBalance>>) {
	return (
		<SectionBlock title={pageCopy.savedHoldings}>
			<dl className='statoblast-saved-share-balances'>
				<div>
					<dt>{pageCopy.yes}</dt>
					<dd>
						<CurrencyValue value={yesAttoShares} />
					</dd>
				</div>
				<div>
					<dt>{pageCopy.no}</dt>
					<dd>
						<CurrencyValue value={noAttoShares} />
					</dd>
				</div>
				<div>
					<dt>{pageCopy.invalid}</dt>
					<dd>
						<CurrencyValue value={invalidAttoShares} />
					</dd>
				</div>
			</dl>
		</SectionBlock>
	)
}
