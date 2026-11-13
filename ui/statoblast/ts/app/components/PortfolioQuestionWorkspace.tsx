import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolio.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { InheritedReporterClaims } from '@zoltar/ui-statoblast-shared/features/reporting/components/InheritedReporterClaims.js'
import { useEffect, useState } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { getAddress, isAddress } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { ReportingSection } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingSection.js'
import { TradingSection } from '@zoltar/ui-statoblast-shared/features/markets/components/TradingSection.js'
import { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { loadAllSecurityPools } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import { getInfraContractAddresses } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
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
	const [snapshot, setSnapshot] = useState<{ environmentKey: number; questions: ListedSecurityPool[] }>({ environmentKey, questions: [] })
	const questions = snapshot.environmentKey === environmentKey ? snapshot.questions : []
	const [loading, setLoading] = useState(false)
	const [loadError, setLoadError] = useState<string>()
	const [refresh, setRefresh] = useState(0)
	useBlockRefresh(event => {
		if (event.reason === 'invalidate') setRefresh(value => value + 1)
	}, enabled)
	const forkError = useSignal<string | undefined>(undefined)
	const forkPending = useSignal(false)
	const selected = questions.find(question => question.securityPoolAddress.toLowerCase() === selectedAddress.toLowerCase())
	const reporting = useReportingOperations({ ...parameters, selectedSecurityPoolAddress: selectedAddress })
	const trading = useTradingOperations({ ...parameters, deploymentStatuses, enabled: enabled && selected !== undefined, selectedSecurityPoolAddress: selectedAddress })
	useEffect(() => {
		let current = true
		setLoadError(undefined)
		if (!enabled) {
			setSnapshot({ environmentKey, questions: [] })
			setLoading(false)
			return
		}
		setLoading(true)
		void loadAllSecurityPools(createConnectedReadClient())
			.then(value => {
				if (current) setSnapshot({ environmentKey, questions: value })
			})
			.catch(error => {
				if (current) setLoadError(getErrorMessage(error, 'Unable to load portfolio questions.'))
			})
			.finally(() => {
				if (current) setLoading(false)
			})
		return () => {
			current = false
		}
	}, [enabled, environmentKey, refresh])
	useEffect(() => {
		if (selected === undefined) return
		reporting.setReportingForm(form => ({ ...form, securityPoolAddress: selected.securityPoolAddress }))
		void reporting.loadReporting()
	}, [selected?.securityPoolAddress, environmentKey, refresh])
	const triggerFork = async () => {
		if (forkPending.value || selected === undefined || !isAddress(selectedAddress)) return
		const question = selected
		forkPending.value = true
		forkError.value = undefined
		try {
			await runWriteAction(
				buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, forkError, 'Connect your wallet.', {
					action: 'forkQuestion',
					source: 'Question reporting',
					submittedTitle: copy.triggerUniverseFork,
					universeId: question.universeId,
				}),
				async (account, context) => {
					const client = createWalletWriteClient(account, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					const hash = await writeContractAndWait(client, () => ({
						address: getInfraContractAddresses().securityPoolForker,
						abi: forkerArtifact.abi,
						functionName: 'forkZoltarWithOwnEscalationGame',
						args: [getAddress(question.securityPoolAddress)],
						reviewTitle: copy.triggerUniverseFork,
						reviewDescription: copy.triggerUniverseForkDescription,
					}))
					return { hash }
				},
				'Unable to trigger the universe fork.',
				async result => {
					setRefresh(value => value + 1)
					await reporting.loadReporting()
					parameters.onTransactionPresented({ hash: result.hash, title: copy.universeForkTriggered, tone: 'success', showStatusDialog: false, universeId: question.universeId })
				},
			)
		} finally {
			forkPending.value = false
		}
	}
	if (selectedAddress !== '' && selected === undefined) return <EmptyState title={loading ? copy.loadingQuestion : copy.questionUnavailable} detail={loadError ?? copy.selectRegisteredQuestion} actions={<a href='#/portfolios'>{copy.openPortfolios}</a>} />
	if (selected === undefined)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={copy.portfolioQuestions} description={copy.portfolioQuestionsDescription} actions={<a href='#/portfolios'>{copy.openPortfolios}</a>} />
				<ErrorNotice message={loadError} />
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
												{/* The short address keeps the column narrow; the full address stays in the accessible name and title. */}
												<a className='portfolio-questions-address' href={`#/portfolios?portfolio=${question.portfolioAddress}&universe=${question.universeId}`} aria-label={copy.formatOpenPortfolioLabel(question.portfolioAddress)} title={question.portfolioAddress}>
													{abbreviateAddress(question.portfolioAddress, 6, 4)}
												</a>
											</td>
											<td role='cell' data-label={copy.outcomeColumn}>
												{question.questionOutcome}
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
			<ErrorNotice message={forkError.value} />
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
				onTriggerZoltarFork={() => void triggerFork()}
				triggerZoltarForkPending={forkPending.value}
				showSecurityPoolAddressInput={false}
			/>
			<InheritedReporterClaims parameters={parameters} accountState={accountState} details={reporting.reportingDetails} onRefresh={reporting.loadReporting} />
		</div>
	)
}
