import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolio.js'
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
import { getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { ReportingSection } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingSection.js'
import { TradingSection } from '@zoltar/ui-statoblast-shared/features/markets/components/TradingSection.js'
import { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { loadSecurityPoolListing, loadSelectedSecurityPool, type UnavailableSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
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

/** Question-specific shares and reporting; backing, liquidation and auctions live in the portfolio workspace. */
export function PortfolioQuestionWorkspace({ accountState, parameters, deploymentStatuses, enabled, environmentKey, universeId, currentTimestamp, selectedAddress, onSelect }: Props) {
	const [snapshot, setSnapshot] = useState<{ environmentKey: number; questions: ListedSecurityPool[]; unavailable: UnavailableSecurityPool[] }>({ environmentKey, questions: [], unavailable: [] })
	const questions = snapshot.environmentKey === environmentKey ? snapshot.questions : []
	const unavailable = snapshot.environmentKey === environmentKey ? snapshot.unavailable.filter(question => question.universeId === universeId) : []
	const [loading, setLoading] = useState(false)
	const [loadError, setLoadError] = useState<string>()
	const [refresh, setRefresh] = useState(0)
	useBlockRefresh(event => {
		if (event.reason === 'invalidate') setRefresh(value => value + 1)
	}, enabled)
	const selected = questions.find(question => question.securityPoolAddress.toLowerCase() === selectedAddress.toLowerCase())
	const reporting = useReportingOperations({ ...parameters, selectedSecurityPoolAddress: selectedAddress })
	const trading = useTradingOperations({ ...parameters, deploymentStatuses, enabled: enabled && selected !== undefined, selectedSecurityPoolAddress: selectedAddress })
	useEffect(() => {
		let current = true
		setLoadError(undefined)
		if (!enabled) {
			setSnapshot({ environmentKey, questions: [], unavailable: [] })
			setLoading(false)
			return
		}
		setLoading(true)
		void (async () => {
			const client = createConnectedReadClient()
			if (selectedAddress === '') return await loadSecurityPoolListing(client)
			if (!isAddress(selectedAddress)) throw new Error('Enter a valid question address.')
			return { pools: [await loadSelectedSecurityPool(client, getAddress(selectedAddress))], unavailable: [] }
		})()
			.then(value => {
				if (current) setSnapshot({ environmentKey, questions: value.pools, unavailable: value.unavailable })
			})
			.catch(error => {
				if (current) {
					setLoadError(getErrorMessage(error, 'Unable to load portfolio questions.'))
					if (selectedAddress !== '') setSnapshot({ environmentKey, questions: [], unavailable: [] })
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
		reporting.setReportingForm(form => ({ ...form, securityPoolAddress: selected.securityPoolAddress }))
		void reporting.loadReporting()
	}, [selected?.securityPoolAddress, environmentKey, refresh])
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
	if (selectedAddress !== '' && selected === undefined) return <EmptyState title={loading ? copy.loadingQuestion : copy.questionUnavailable} detail={loadError ?? copy.selectRegisteredQuestion} actions={<a href='#/portfolios'>{copy.openPortfolios}</a>} />
	if (selected === undefined)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={copy.portfolioQuestions} description={copy.portfolioQuestionsDescription} actions={<a href='#/portfolios'>{copy.openPortfolios}</a>} />
				<ErrorNotice message={loadError} />
				{unavailable.map(question => (
					<StateHint key={question.address} title={<AddressText address={question.address} />} presentation={{ key: 'load_failed', badgeLabel: copy.questionUnavailable, badgeTone: 'blocked', detail: question.reason }} />
				))}
				{loading && <EmptyState title={copy.loadingQuestions} />}
				{!loading && questions.filter(question => question.universeId === universeId).length === 0 && <EmptyState title={copy.noRegisteredQuestions} detail={copy.registerQuestionsHint} actions={<a href='#/portfolios'>{copy.openPortfolios}</a>} />}
				{!loading && questions.filter(question => question.universeId === universeId).length > 0 && (
					<div className='portfolio-questions-table' role='region' aria-label={copy.portfolioQuestions} tabIndex={0}>
						{/* Explicit roles keep the table semantics when phone widths stack each row (see .portfolio-questions-table). */}
						<table role='table'>
							<thead role='rowgroup'>
								<tr role='row'>
									<th role='columnheader'>{copy.questionColumn}</th>
									<th role='columnheader'>{copy.portfolioColumn}</th>
									<th role='columnheader'>{copy.outcomeColumn}</th>
								</tr>
							</thead>
							<tbody role='rowgroup'>
								{questions
									.filter(question => question.universeId === universeId)
									.map(question => (
										<tr key={question.securityPoolAddress} role='row'>
											<td role='cell'>
												<button type='button' onClick={() => onSelect(question.universeId, question.securityPoolAddress)}>
													{getQuestionTitle(question.marketDetails)}
												</button>
											</td>
											<td role='cell' data-label={copy.portfolioColumn}>
												{/* The address shortens only when its cell is too narrow for it; the full address stays in the page text, the link's accessible name and its title. */}
												<a className='portfolio-questions-address' href={`#/portfolios?portfolio=${question.portfolioAddress}&universe=${question.universeId}`} aria-label={copy.formatOpenPortfolioLabel(question.portfolioAddress)} title={question.portfolioAddress}>
													<AddressText address={question.portfolioAddress} />
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
	return (
		<div className='route-view-flow'>
			<RouteHeader title={getQuestionTitle(selected.marketDetails)} actions={<a href={`#/portfolios?portfolio=${selected.portfolioAddress}&universe=${selected.universeId}`}>{copy.manageBackingAndRecovery}</a>} />
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
				showSecurityPoolAddressInput={false}
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
					window.location.hash = `#/portfolios?portfolio=${selected.portfolioAddress}&universe=${selected.universeId}`
				}}
				onTriggerZoltarFork={() => void ownFork.triggerFork()}
				triggerZoltarForkApproval={ownFork.approval}
				triggerZoltarForkAvailability={ownFork.triggerForkAvailability}
				triggerZoltarForkPending={ownFork.forkPending}
				showSecurityPoolAddressInput={false}
			/>
			<InheritedReporterClaims parameters={parameters} accountState={accountState} details={reporting.reportingDetails} onRefresh={reporting.loadReporting} />
		</div>
	)
}
