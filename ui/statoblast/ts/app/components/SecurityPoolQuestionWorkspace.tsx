import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'
import { useStatoblastPageRefresh, type RegisterStatoblastPageRefresh } from '@zoltar/ui-statoblast-shared/features/useStatoblastPageRefresh.js'
import { StatoblastSharesFacts } from './StatoblastSharesFacts.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { decodeQuestionHeading, StatoblastQuestionHead } from './StatoblastQuestionHead.js'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { LocateReportingDeposits } from '@zoltar/ui-statoblast-shared/features/reporting/components/LocateReportingDeposits.js'
import { statoblastPageHref, questionTabs, type StatoblastQuestionPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { InheritedReporterClaims } from '@zoltar/ui-statoblast-shared/features/reporting/components/InheritedReporterClaims.js'
import { useEffect, useState } from 'preact/hooks'
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
}

/** Question-specific shares and reporting; backing, liquidation and auctions live in the security pool workspace. */
export function SecurityPoolQuestionWorkspace({ accountState, parameters, deploymentStatuses, enabled, environmentKey, universeId, currentTimestamp, entry, registerPageRefresh }: Props) {
	const [snapshot, setSnapshot] = useState<{ environmentKey: number; identity: string; question: ListedQuestionLedger; sharesFacts: Awaited<ReturnType<typeof loadStatoblastQuestion>>['sharesFacts'] }>()
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
	useStatoblastPageRefresh(registerPageRefresh, async () => {
		if (!loading) setRefresh(value => value + 1)
	})
	useBlockRefresh(() => {
		if (!loading) setRefresh(value => value + 1)
	}, enabled)
	const ledgerAddress = selected?.questionLedgerAddress
	const reporting = useReportingOperations({ ...parameters, selectedQuestionLedgerAddress: ledgerAddress ?? '' })
	const trading = useTradingOperations({ ...parameters, deploymentStatuses, enabled: enabled && selected !== undefined, selectedQuestionLedgerAddress: ledgerAddress ?? '' })
	useEffect(() => {
		const page = displayCache.read()
		setCachedHeading(page === undefined ? undefined : { scope: cacheScope, page })
	}, [cacheScope])
	useEffect(() => {
		let current = true
		setLoadError(undefined)
		if (!enabled) {
			setSnapshot(undefined)
			setLoading(false)
			return
		}
		setLoading(true)
		void withTimeout(loadStatoblastQuestion(createConnectedReadClient(), entry.pool, entry.questionId, universeId, true, entry.tab === 'shares'), 15_000, pageCopy.refreshTimeoutError)
			.then(({ question, block, sharesFacts }) => {
				if (!current) return
				setSnapshot({ environmentKey, identity: selectionKey, question, sharesFacts })
				setLastRead({ scope: cacheScope, at: Date.now() })
				displayCache.write(question, block)
			})
			.catch(error => {
				if (current) {
					setLoadError(getErrorMessage(error, 'Unable to load security pool questions.'))
				}
			})
			.finally(() => {
				if (current) setLoading(false)
			})
		return () => {
			current = false
		}
	}, [enabled, environmentKey, refresh, selectionKey, universeId, cacheScope, entry.tab])
	useEffect(() => {
		if (selected === undefined) return
		reporting.setReportingForm(form => ({ ...form, questionLedgerAddress: selected.questionLedgerAddress }))
		void reporting.loadReporting()
	}, [selected?.questionLedgerAddress, environmentKey, refresh])
	const visible = usePageVisible()
	const chainTime = reporting.reportingDetails?.currentTime ?? currentTimestamp
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
	const ownFork = useOwnForkTrigger({
		active: selected !== undefined && !selected.universeHasForked && reporting.reportingDetails?.status === 'active' && reporting.reportingDetails.hasReachedNonDecision && reporting.reportingDetails.canTriggerOwnFork !== false,
		onForked: async hash => {
			if (selected === undefined) return
			setRefresh(value => value + 1)
			await reporting.loadReporting()
			parameters.onTransactionPresented({ hash, title: copy.universeForkTriggered, tone: 'success', showStatusDialog: false, universeId: selected.universeId })
		},
		parameters,
		question: selected,
		refreshKey: refresh,
	})
	const retryQuestion = () => setRefresh(value => value + 1)
	const reportingDetails = reporting.reportingDetails
	const tabLabels = { shares: pageCopy.shares, reporting: pageCopy.reporting, claims: pageCopy.inheritedClaims }
	const losing = reportingDetails?.status === 'active' && reportingDetails.settlementState === 'resolved' ? reportingDetails.sides.filter(side => side.key !== reportingDetails.questionOutcome).flatMap(side => side.deposits.map(deposit => ({ side, deposit }))) : []
	if (selected === undefined) {
		const unavailable = loadError?.includes('Question pool unavailable') === true
		if (cached !== undefined && !unavailable && loadError?.includes('Question not registered') !== true) {
			return (
				<div className='route-view-flow'>
					<StatoblastQuestionHead page={entry} question={cached.value} reporting={undefined} now={cached.timestamp} hasShares={false} presentationOnly />
					<UpdatedAgo updatedAt={cached.savedAt} refreshing={loading} />
					<RetryableNotice message={loadError === undefined ? undefined : copy.formatStaleQuestionDetails(loadError)} retryLabel={copy.retryQuestionDetails} onRetry={retryQuestion} disabled={loading} />
				</div>
			)
		}
		const destination = unavailable ? statoblastPageHref({ kind: 'pool', pool: entry.pool, tab: 'fork' }) : statoblastPageHref({ kind: 'watchlist' })
		return <EmptyState title={loading ? copy.loadingQuestion : copy.questionUnavailable} detail={unavailable ? pageCopy.questionUnprepared : (loadError ?? pageCopy.loadingQuestionDetails)} actions={<a href={destination}>{unavailable ? pageCopy.forkRecovery : pageCopy.watchlist}</a>} />
	}

	return (
		<div className='route-view-flow'>
			<StatoblastQuestionHead page={entry} question={selected} reporting={reporting.reportingDetails} now={now} hasShares={Object.values(trading.tradingDetails?.shareBalances ?? {}).some(balance => balance > 0n)} />
			<UpdatedAgo updatedAt={lastRead?.scope === cacheScope ? lastRead.at : undefined} refreshing={loading} />
			<RetryableNotice message={loadError === undefined ? undefined : copy.formatStaleQuestionDetails(loadError)} retryLabel={copy.retryQuestionDetails} onRetry={retryQuestion} disabled={loading} />
			<ErrorNotice message={ownFork.error} />
			{
				<nav className='statoblast-page-tabs' aria-label={pageCopy.questionViews}>
					{questionTabs.map(tab =>
						tab === 'claims' && (reporting.reportingDetails?.status !== 'active' || reporting.reportingDetails.forkContinuation !== true) ? undefined : (
							<a key={tab} aria-current={entry.tab === tab ? 'page' : undefined} href={statoblastPageHref({ ...entry, tab, sharesAction: undefined })}>
								{tabLabels[tab]}
							</a>
						),
					)}
				</nav>
			}
			{entry.tab === 'shares' && <StatoblastSharesFacts question={selected} facts={snapshot?.sharesFacts} now={now} />}
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
			{entry.tab === 'reporting' && (
				<ReportingSection
					accountState={accountState}
					currentTimestamp={now}
					showLifecycle={false}
					allowInProgressClaims={false}
					loadingReportingDetails={reporting.loadingReportingDetails}
					onApproveReportingRep={reporting.onApproveReportingRep}
					onLoadReporting={reporting.loadReporting}
					onReportOutcome={reporting.onReportOutcome}
					onReportingFormChange={update => reporting.setReportingForm(form => ({ ...form, ...update }))}
					onWithdrawEscalation={reporting.withdrawEscalation}
					reportingActiveAction={reporting.reportingActiveAction}
					reportingDetails={reporting.reportingDetails}
					reportingError={reporting.reportingError}
					reportingForm={reporting.reportingForm}
					reportingResult={reporting.reportingResult}
					forkAlreadyTriggered={selected.universeHasForked}
					onOpenForkWorkflow={() => {
						window.location.hash = statoblastPageHref({ kind: 'pool', pool: selected.securityPoolAddress, tab: 'fork' }, selected.universeId)
					}}
					onTriggerZoltarFork={reporting.reportingDetails?.status === 'active' && reporting.reportingDetails.hasReachedNonDecision ? () => void ownFork.triggerFork() : undefined}
					triggerZoltarForkApproval={ownFork.approval}
					triggerZoltarForkAvailability={ownFork.triggerForkAvailability}
					triggerZoltarForkPending={ownFork.forkPending}
					showQuestionLedgerAddressInput={false}
				/>
			)}
			{entry.tab === 'reporting' && reporting.reportingDetails?.status === 'active' && accountState.address !== undefined && <LocateReportingDeposits key={reporting.reportingDetails.escalationGameAddress} details={reporting.reportingDetails} wallet={accountState.address} refresh={reporting.loadReporting} />}
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
			{entry.tab === 'claims' && <InheritedReporterClaims parameters={parameters} accountState={accountState} details={reporting.reportingDetails} onRefresh={reporting.loadReporting} />}
		</div>
	)
}
