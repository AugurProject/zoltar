import { buildRouteHref, getTopLevelRouteSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { setOrDeleteSearchParam, updateSearchParams } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import { getReportingOutcomeLabel } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reporting.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { InheritedReporterClaims } from '@zoltar/ui-statoblast-shared/features/reporting/components/InheritedReporterClaims.js'
import { useEffect, useState } from 'preact/hooks'
import { getAddress, isAddress } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { useOwnForkTrigger } from '../hooks/useOwnForkTrigger.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { AddressText } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { ReportingSection } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingSection.js'
import { TradingSection } from '@zoltar/ui-statoblast-shared/features/markets/components/TradingSection.js'
import { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { loadQuestionLedgerListing, loadSelectedQuestionLedger, type UnavailableQuestionLedger } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
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
	selectedAddress: string
	onSelect: (universe: bigint, address: string) => void
}

function securityPoolsHref(universeId: bigint, securityPoolAddress?: string) {
	const search = updateSearchParams(getTopLevelRouteSearch('security-pools'), params => {
		setOrDeleteSearchParam(params, 'securityPool', securityPoolAddress)
		params.set('universe', universeId.toString())
		params.delete('owner')
	})
	return buildRouteHref('#/security-pools', search)
}

/** Question-specific shares and reporting; backing, liquidation and auctions live in the security pool workspace. */
export function SecurityPoolQuestionWorkspace({ accountState, parameters, deploymentStatuses, enabled, environmentKey, universeId, currentTimestamp, selectedAddress, onSelect }: Props) {
	const [snapshot, setSnapshot] = useState<{ environmentKey: number; address: string; questions: ListedQuestionLedger[]; unavailable: UnavailableQuestionLedger[] }>()
	const currentSnapshot = snapshot?.environmentKey === environmentKey && snapshot.address === selectedAddress ? snapshot : undefined
	const questions = currentSnapshot?.questions ?? []
	const unavailable = currentSnapshot?.unavailable.filter(question => question.universeId === universeId) ?? []
	const [loading, setLoading] = useState(false)
	const [loadError, setLoadError] = useState<string>()
	const [refresh, setRefresh] = useState(0)
	useBlockRefresh(event => {
		if (event.reason === 'invalidate' || !loading) setRefresh(value => value + 1)
	}, enabled)
	const selected = questions.find(question => question.questionLedgerAddress.toLowerCase() === selectedAddress.toLowerCase())
	const reporting = useReportingOperations({ ...parameters, selectedQuestionLedgerAddress: selectedAddress })
	const trading = useTradingOperations({ ...parameters, deploymentStatuses, enabled: enabled && selected !== undefined, selectedQuestionLedgerAddress: selectedAddress })
	useEffect(() => {
		let current = true
		setLoadError(undefined)
		if (!enabled) {
			setSnapshot(undefined)
			setLoading(false)
			return
		}
		setLoading(true)
		void (async () => {
			const client = createConnectedReadClient()
			if (selectedAddress === '') return await loadQuestionLedgerListing(client)
			if (!isAddress(selectedAddress)) throw new Error('Enter a valid question address.')
			return { pools: [await loadSelectedQuestionLedger(client, getAddress(selectedAddress))], unavailable: [] }
		})()
			.then(value => {
				if (current) setSnapshot({ environmentKey, address: selectedAddress, questions: value.pools, unavailable: value.unavailable })
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
	}, [enabled, environmentKey, refresh, selectedAddress])
	useEffect(() => {
		if (selected === undefined) return
		reporting.setReportingForm(form => ({ ...form, questionLedgerAddress: selected.questionLedgerAddress }))
		void reporting.loadReporting()
	}, [selected?.questionLedgerAddress, environmentKey, refresh])
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
	if (selectedAddress !== '' && selected === undefined)
		return (
			<EmptyState
				title={loading ? copy.loadingQuestion : copy.questionUnavailable}
				detail={loadError ?? copy.selectRegisteredQuestion}
				actions={
					<>
						<a href={securityPoolsHref(universeId)}>{copy.openSecurityPools}</a>
						{loadError === undefined ? undefined : (
							<button type='button' onClick={retryQuestion}>
								{copy.retryQuestionDetails}
							</button>
						)}
					</>
				}
			/>
		)
	if (selected === undefined) {
		const listedQuestions = questions.filter(question => question.universeId === universeId)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={copy.securityPoolQuestions} description={copy.securityPoolQuestionsDescription} actions={<a href={securityPoolsHref(universeId)}>{copy.openSecurityPools}</a>} />
				<RetryableNotice message={loadError} retryLabel={copy.retryQuestionList} onRetry={retryQuestion} disabled={loading} />
				{unavailable.map(question => (
					<StateHint key={question.address} title={<AddressText address={question.address} />} presentation={{ key: 'load_failed', badgeLabel: copy.questionUnavailable, badgeTone: 'blocked', detail: question.reason }} />
				))}
				{loading && currentSnapshot === undefined && <EmptyState title={copy.loadingQuestions} />}
				{!loading && loadError === undefined && currentSnapshot !== undefined && listedQuestions.length === 0 && unavailable.length === 0 && <EmptyState title={copy.noRegisteredQuestions} detail={copy.registerQuestionsHint} actions={<a href={securityPoolsHref(universeId)}>{copy.openSecurityPools}</a>} />}
				{listedQuestions.length > 0 && (
					<div className='security-pool-questions-table' role='region' aria-label={copy.securityPoolQuestions} tabIndex={0}>
						{/* Explicit roles keep the table semantics when phone widths stack each row (see .security-pool-questions-table). */}
						<table role='table'>
							<thead role='rowgroup'>
								<tr role='row'>
									<th role='columnheader'>{copy.questionColumn}</th>
									<th role='columnheader'>{copy.securityPoolColumn}</th>
									<th role='columnheader'>{copy.outcomeColumn}</th>
								</tr>
							</thead>
							<tbody role='rowgroup'>
								{listedQuestions.map(question => (
									<tr key={question.questionLedgerAddress} role='row'>
										<td role='cell'>
											<button type='button' onClick={() => onSelect(question.universeId, question.questionLedgerAddress)}>
												{getQuestionTitle(question.marketDetails)}
											</button>
										</td>
										<td role='cell' data-label={copy.securityPoolColumn}>
											{/* The address shortens only when its cell is too narrow for it; the full address stays in the page text, the link's accessible name and its title. */}
											<a className='security-pool-questions-address' href={securityPoolsHref(question.universeId, question.securityPoolAddress)} aria-label={copy.formatOpenSecurityPoolLabel(question.securityPoolAddress)} title={question.securityPoolAddress}>
												<AddressText address={question.securityPoolAddress} />
											</a>
										</td>
										<td role='cell' data-label={copy.outcomeColumn}>
											{getReportingOutcomeLabel(question.questionOutcome)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		)
	}
	return (
		<div className='route-view-flow'>
			<RouteHeader title={getQuestionTitle(selected.marketDetails)} actions={<a href={securityPoolsHref(selected.universeId, selected.securityPoolAddress)}>{copy.manageBackingAndRecovery}</a>} />
			<RetryableNotice message={loadError === undefined ? undefined : copy.formatStaleQuestionDetails(loadError)} retryLabel={copy.retryQuestionDetails} onRetry={retryQuestion} disabled={loading} />
			<ErrorNotice message={ownFork.error} />
			<TradingSection
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
			/>
			<ReportingSection
				accountState={accountState}
				currentTimestamp={currentTimestamp}
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
					window.location.hash = securityPoolsHref(selected.universeId, selected.securityPoolAddress)
				}}
				onTriggerZoltarFork={() => void ownFork.triggerFork()}
				triggerZoltarForkApproval={ownFork.approval}
				triggerZoltarForkAvailability={ownFork.triggerForkAvailability}
				triggerZoltarForkPending={ownFork.forkPending}
				showQuestionLedgerAddressInput={false}
			/>
			<InheritedReporterClaims parameters={parameters} accountState={accountState} details={reporting.reportingDetails} onRefresh={reporting.loadReporting} />
		</div>
	)
}
