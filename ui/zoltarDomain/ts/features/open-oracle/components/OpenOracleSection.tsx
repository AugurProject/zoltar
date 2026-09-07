import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { useEffect, useState } from 'preact/hooks'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionObjectContext } from '@zoltar/ui-core-shared/components/TransactionObjectContext.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { useChainBlockNumber, useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js'
import { getOpenOracleCreateGuardMessage, getOpenOracleCreateValidation, getOpenOracleReportStatus, OPEN_ORACLE_CREATE_FIELD_ORDER, type OpenOracleCreateField } from '../lib/openOracle.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '@zoltar/ui-core-shared/lib/pagination.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { OpenOracleReportSummaryPage } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleSectionProps, OpenOracleView } from '../../types.js'
import {
	BROWSE_PAGE_SIZE,
	type BrowseLoadState,
	type BrowseStatusFilter,
	getEffectiveOpenOracleReportDetails,
	getOpenOracleCreateFieldErrorId,
	getOpenOracleFieldDescribedBy,
	getSelectedWithdrawalBalance,
	loadBrowseReportPage,
	renderOpenOracleFieldError,
	renderReportSummaryCard,
	resolveBrowseStatusFilter,
	type SelectedReportModal,
} from './OpenOracleReportContent.js'
import { OpenOracleReportDetailsCard } from './OpenOracleReportDetailsCard.js'

function getOpenOracleRouteHeader(view: OpenOracleView) {
	if (view === 'browse') return { description: openOracleCopy.browseReportsDescription, title: openOracleCopy.browseReports }
	if (view === 'create') return { description: openOracleCopy.createReportDescription, title: openOracleCopy.createReport }
	return { description: openOracleCopy.selectedReportDescription, title: openOracleCopy.openOracleReportDetails }
}

export function OpenOracleSection({
	activeView,
	accountState,
	environmentReady,
	environmentRefreshKey,
	loadBrowseReports = loadBrowseReportPage,
	onApproveToken1,
	onApproveToken2,
	onCancelOpenOracleWithdrawalBalanceCheck,
	onCreateOpenOracleGame,
	onDisputeReport,
	onLoadOracleReport,
	onOpenOracleCreateFormChange,
	onOpenOracleFormChange,
	onSettleReport,
	onWithdrawOpenOracleBalance,
	loadingOpenOracleCreate,
	openOracleActiveAction,
	openOracleActiveWithdrawalBalance,
	openOracleCreateForm,
	openOracleCreateFieldErrors = {},
	openOracleDisputeSubmission,
	openOracleError,
	openOracleForm,
	openOracleReportLookupState,
	openOracleWithdrawalBalanceChecking,
	openOracleWithdrawalReviewMessage,
	openOracleTokenAccessState,
	openOracleReportDetails,
	openOracleResult,
	openOracleWithdrawableBalances,
	openOracleWithdrawableBalancesError,
	openOracleWithdrawableBalancesLoading,
	onActiveViewChange,
}: OpenOracleSectionProps) {
	const view = activeView
	const routeHeader = getOpenOracleRouteHeader(view)
	const chainCurrentTimestamp = useChainTimestamp()
	const chainCurrentBlockNumber = useChainBlockNumber()
	const [browsePage, setBrowsePage] = useState<OpenOracleReportSummaryPage | undefined>(undefined)
	const [browseLoadState, setBrowseLoadState] = useState<BrowseLoadState>({ requestKey: undefined, status: 'loading' })
	const [browseReloadKey, setBrowseReloadKey] = useState(0)
	const [browsePageIndex, setBrowsePageIndex] = useState(0)
	const [browseSearchText, setBrowseSearchText] = useState('')
	const [browseStatusFilter, setBrowseStatusFilter] = useState<BrowseStatusFilter>('all')
	const [selectedReportModal, setSelectedReportModal] = useState<SelectedReportModal>(undefined)
	const [touchedCreateFields, setTouchedCreateFields] = useState<ReadonlySet<OpenOracleCreateField>>(new Set())
	const [dismissedCreateSuccessKey, setDismissedCreateSuccessKey] = useState<string | undefined>(undefined)
	const changeSelectedReportModal = (modal: SelectedReportModal) => {
		if (getSelectedWithdrawalBalance(selectedReportModal) !== undefined && modal !== selectedReportModal) onCancelOpenOracleWithdrawalBalanceCheck()
		setSelectedReportModal(modal)
	}
	const browseLoad = useLoadController()
	const isConnected = accountState.address !== undefined
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const createValidation = getOpenOracleCreateValidation({ form: openOracleCreateForm })
	const hasCreateContractFieldErrors = openOracleCreateFieldErrors.token1Address !== undefined || openOracleCreateFieldErrors.token2Address !== undefined
	const rawCreateGuardMessage = getOpenOracleCreateGuardMessage({
		ethValueInput: openOracleCreateForm.ethValue,
		isOnActiveAppChain,
		settlerRewardInput: openOracleCreateForm.settlerRewardEthAmount,
		walletConnected: isConnected,
		walletBalanceAttoEth: accountState.ethBalanceAttoEth,
	})
	const createGuardMessage = !isConnected || !isOnActiveAppChain || createValidation.isValid ? rawCreateGuardMessage : undefined
	const markCreateFieldTouched = (field: OpenOracleCreateField) => setTouchedCreateFields(current => new Set([...current, field]))
	const getCreateContractFieldError = (field: OpenOracleCreateField) => {
		if (field === 'token1Address') return openOracleCreateFieldErrors.token1Address
		if (field === 'token2Address') return openOracleCreateFieldErrors.token2Address
		return undefined
	}
	const getVisibleCreateFieldError = (field: OpenOracleCreateField) => getCreateContractFieldError(field) ?? (touchedCreateFields.has(field) ? createValidation.fieldErrors[field] : undefined)
	const firstVisibleInvalidCreateField = OPEN_ORACLE_CREATE_FIELD_ORDER.find(field => getVisibleCreateFieldError(field) !== undefined)
	const createDisabledReasonElementId = createGuardMessage === undefined && firstVisibleInvalidCreateField !== undefined ? getOpenOracleCreateFieldErrorId(firstVisibleInvalidCreateField) : undefined
	const createAvailabilityMessage = createGuardMessage ?? openOracleCreateFieldErrors.token1Address ?? openOracleCreateFieldErrors.token2Address ?? createValidation.message
	const disputeDelayError = getVisibleCreateFieldError('disputeDelay')
	const escalationHaltError = getVisibleCreateFieldError('escalationHalt')
	const ethValueError = getVisibleCreateFieldError('ethValue')
	const exactToken1ReportError = getVisibleCreateFieldError('exactToken1Report')
	const feePercentageError = getVisibleCreateFieldError('feePercentage')
	const initialToken2AmountError = getVisibleCreateFieldError('initialToken2Amount')
	const multiplierError = getVisibleCreateFieldError('multiplier')
	const protocolFeeError = getVisibleCreateFieldError('protocolFee')
	const settlementTimeError = getVisibleCreateFieldError('settlementTime')
	const settlerRewardError = getVisibleCreateFieldError('settlerRewardEthAmount')
	const token1AddressError = getVisibleCreateFieldError('token1Address')
	const token2AddressError = getVisibleCreateFieldError('token2Address')
	const effectiveOpenOracleReportDetails = getEffectiveOpenOracleReportDetails(openOracleReportDetails, chainCurrentTimestamp, chainCurrentBlockNumber)
	const browseRequestKey = `${environmentRefreshKey}:${browsePageIndex}:${browseReloadKey}:${openOracleResult?.action ?? ''}:${openOracleResult?.hash ?? ''}`
	const successfulCreateKey = openOracleResult?.action === 'createReportInstance' ? openOracleResult.hash : undefined
	const showCreateSuccess = successfulCreateKey !== undefined && successfulCreateKey !== dismissedCreateSuccessKey
	useEffect(() => {
		if (successfulCreateKey === undefined) return
		setTouchedCreateFields(new Set())
	}, [successfulCreateKey])
	useEffect(() => {
		let cancelled = false
		const shouldLoadBrowse = view === 'browse' || openOracleResult?.action === 'createReportInstance'
		if (!environmentReady || !shouldLoadBrowse) return undefined
		const runBrowseLoad = async () => {
			await browseLoad.run({
				isCurrent: () => !cancelled,
				onStart: () => {
					setBrowseLoadState({ requestKey: browseRequestKey, status: 'loading' })
				},
				load: async () => await loadBrowseReports(browsePageIndex, BROWSE_PAGE_SIZE),
				onSuccess: page => {
					const pageCount = getPaginationPageCount(page.reportCount, BROWSE_PAGE_SIZE)
					const resolvedPageIndex = resolvePaginationPageIndex(browsePageIndex, pageCount)
					if (resolvedPageIndex !== browsePageIndex) {
						setBrowsePage(undefined)
						setBrowsePageIndex(resolvedPageIndex)
						return
					}
					setBrowsePage(page)
					setBrowseLoadState({ requestKey: browseRequestKey, status: 'ready' })
				},
				onError: error => {
					setBrowsePage(undefined)
					setBrowseLoadState({
						message: error instanceof Error ? error.message : openOracleCopy.reportLoadError,
						requestKey: browseRequestKey,
						status: 'error',
					})
				},
			})
		}
		void runBrowseLoad()
		return () => {
			cancelled = true
		}
	}, [browsePageIndex, browseReloadKey, environmentReady, environmentRefreshKey, loadBrowseReports, openOracleResult?.action, openOracleResult?.hash, view])
	const browseLoadStateIsCurrent = browseLoadState.requestKey === browseRequestKey
	const loadingBrowse = !environmentReady || !browseLoadStateIsCurrent || browseLoadState.status === 'loading'
	const browseLoadError = browseLoadStateIsCurrent && browseLoadState.status === 'error' ? browseLoadState.message : undefined
	const browseReady = browseLoadStateIsCurrent && browseLoadState.status === 'ready'
	const currentBrowsePage = browseReady ? browsePage : undefined
	const normalizedBrowseSearchText = browseSearchText.trim().toLowerCase()
	const browseReportCount = currentBrowsePage?.reportCount ?? 0n
	const browsePageCount = currentBrowsePage === undefined ? undefined : getPaginationPageCount(browseReportCount, BROWSE_PAGE_SIZE)
	const browseHasPreviousPage = browsePageIndex > 0
	const browseHasNextPage = getHasNextPaginationPage(browsePageIndex, browsePageCount)
	const filteredBrowseReports =
		currentBrowsePage?.reports.filter(report => {
			const status = getOpenOracleReportStatus(report)
			if (browseStatusFilter !== 'all' && status !== browseStatusFilter) return false
			if (normalizedBrowseSearchText === '') return true
			return (
				report.reportId.toString().includes(normalizedBrowseSearchText) ||
				report.token1Symbol.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token2Symbol.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token1.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token2.toLowerCase().includes(normalizedBrowseSearchText)
			)
		}) ?? []
	const hasActiveBrowseFilters = normalizedBrowseSearchText !== '' || browseStatusFilter !== 'all'
	const openBrowseReport = async (reportId: bigint) => {
		onOpenOracleFormChange({ reportId: reportId.toString() })
		onActiveViewChange('selected-report')
		await onLoadOracleReport(reportId.toString())
	}
	return (
		<div className='route-view-flow'>
			<RouteHeader description={routeHeader.description} eyebrow={openOracleCopy.openOracleGame} title={routeHeader.title} />
			{view === 'browse' ? (
				<div className='workflow-stack route-workflow-stack'>
					<SectionBlock
						actions={
							<PaginationControls
								hasNextPage={browseHasNextPage}
								hasPreviousPage={browseHasPreviousPage}
								loading={loadingBrowse}
								onNextPage={() => setBrowsePageIndex(current => current + 1)}
								onPreviousPage={() => setBrowsePageIndex(current => Math.max(0, current - 1))}
								summary={currentBrowsePage === undefined ? undefined : formatPaginationSummary(browsePageIndex, browsePageCount)}
							/>
						}
						density='compact'
						title={openOracleCopy.reportDirectory}
						variant='plain'
					>
						<div className='filter-toolbar'>
							<label className='field'>
								<span>{openOracleCopy.searchReports}</span>
								<FormInput value={browseSearchText} onInput={event => setBrowseSearchText(event.currentTarget.value)} placeholder={openOracleCopy.searchByReportIdTokenSymbolOrTokenAddress} />
							</label>
							<label className='field'>
								<span>{commonCopy.status}</span>
								<select value={browseStatusFilter} onChange={event => setBrowseStatusFilter(resolveBrowseStatusFilter(event.currentTarget.value))}>
									<option value='all'>{openOracleCopy.allStatuses}</option>
									<option value='Pending'>{commonCopy.pending}</option>
									<option value='Disputed'>{openOracleCopy.disputed}</option>
									<option value='Settled'>{commonCopy.settled}</option>
								</select>
							</label>
						</div>
						{currentBrowsePage === undefined || !hasActiveBrowseFilters ? undefined : <p className='detail'>{openOracleCopy.formatBrowseShownCountSummary(filteredBrowseReports.length.toString(), currentBrowsePage.reports.length.toString())}</p>}
						{(() => {
							if (loadingBrowse)
								return (
									<StateHint
										presentation={{
											key: 'loading',
											badgeLabel: commonCopy.loading,
											badgeTone: 'pending',
											detail: environmentReady ? openOracleCopy.reportSummariesRefreshingDetail : openOracleCopy.reportSummariesInitializingDetail,
											detailIsLoading: true,
										}}
									/>
								)
							if (browseLoadError !== undefined)
								return (
									<StateHint
										announcement='assertive'
										actions={
											<button className='secondary' type='button' onClick={() => setBrowseReloadKey(current => current + 1)}>
												{openOracleCopy.retryReports}
											</button>
										}
										presentation={{
											key: 'load_failed',
											badgeLabel: commonCopy.failed,
											badgeTone: 'error',
											detail: browseLoadError,
										}}
									/>
								)
							if (currentBrowsePage === undefined) return undefined
							if (currentBrowsePage.reports.length === 0) return <StateHint announcement='polite' presentation={{ key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail: openOracleCopy.oracleGamesEmpty }} />
							if (filteredBrowseReports.length === 0) return <StateHint announcement='polite' presentation={{ key: 'empty', badgeLabel: commonCopy.noMatches, badgeTone: 'muted', detail: openOracleCopy.reportFiltersEmpty }} />

							return <div className='comparison-record-list'>{filteredBrowseReports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>
						})()}
					</SectionBlock>
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='workflow-stack route-workflow-stack'>
					{!showCreateSuccess ? undefined : (
						<SectionBlock title={openOracleCopy.nextStep}>
							<div className='actions'>
								<button
									className='primary'
									type='button'
									onClick={() => {
										setDismissedCreateSuccessKey(successfulCreateKey)
										onActiveViewChange('browse')
									}}
								>
									{commonCopy.returnToBrowse}
								</button>
								<button className='secondary' type='button' onClick={() => setDismissedCreateSuccessKey(successfulCreateKey)}>
									{openOracleCopy.createAnother}
								</button>
							</div>
						</SectionBlock>
					)}
					{showCreateSuccess ? undefined : (
						<SectionBlock title={openOracleCopy.openOracleGame} variant='plain'>
							<p className='notice warning'>{openOracleCopy.standaloneOracleWarningDetail}</p>
							<p className='detail'>{openOracleCopy.standaloneOracleIntroduction}</p>
							<TransactionObjectContext
								className='mobile-workflow-context'
								title={openOracleCopy.reportAtAGlance}
								items={[
									{ label: openOracleCopy.baseToken, value: <AddressValue address={openOracleCreateForm.token1Address.trim() === '' ? undefined : openOracleCreateForm.token1Address} copyable={false} responsiveAbbreviation /> },
									{ label: openOracleCopy.quoteToken, value: <AddressValue address={openOracleCreateForm.token2Address.trim() === '' ? undefined : openOracleCreateForm.token2Address} copyable={false} responsiveAbbreviation /> },
									{ label: openOracleCopy.ethValueToSend, value: formatValueWithUnit(openOracleCreateForm.ethValue || commonCopy.metricUnavailablePlaceholder, commonCopy.eth) },
								]}
							/>
							<div className='form-grid'>
								<SectionBlock headingLevel={4} title={openOracleCopy.tokenPair} variant='embedded'>
									<div className='field-row'>
										<div className='field'>
											<label>
												<span>{openOracleCopy.token1Address}</span>
												<FormInput
													aria-describedby={token1AddressError === undefined ? undefined : 'open-oracle-token1-address-error'}
													aria-label={openOracleCopy.token1Address}
													invalid={token1AddressError !== undefined}
													onBlur={() => markCreateFieldTouched('token1Address')}
													onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })}
													placeholder={commonCopy.hexValuePlaceholder}
													value={openOracleCreateForm.token1Address}
												/>
											</label>
											{token1AddressError === undefined ? undefined : (
												<p className='field-error' id='open-oracle-token1-address-error' role='alert'>
													{token1AddressError}
												</p>
											)}
										</div>
										<div className='field'>
											<label>
												<span>{openOracleCopy.token2Address}</span>
												<FormInput
													aria-describedby={token2AddressError === undefined ? undefined : 'open-oracle-token2-address-error'}
													aria-label={openOracleCopy.token2Address}
													invalid={token2AddressError !== undefined}
													onBlur={() => markCreateFieldTouched('token2Address')}
													onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })}
													placeholder={commonCopy.hexValuePlaceholder}
													value={openOracleCreateForm.token2Address}
												/>
											</label>
											{token2AddressError === undefined ? undefined : (
												<p className='field-error' id='open-oracle-token2-address-error' role='alert'>
													{token2AddressError}
												</p>
											)}
										</div>
									</div>
								</SectionBlock>

								<SectionBlock headingLevel={4} title={openOracleCopy.initialEconomics} variant='embedded'>
									<div className='field-row'>
										<label className='field'>
											<span>{openOracleCopy.exactToken1Report}</span>
											<FormInput
												aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('exactToken1Report'), exactToken1ReportError, 'open-oracle-exact-token1-report-help')}
												aria-label={openOracleCopy.exactToken1Report}
												inputMode='decimal'
												invalid={exactToken1ReportError !== undefined}
												onBlur={() => markCreateFieldTouched('exactToken1Report')}
												onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })}
												value={openOracleCreateForm.exactToken1Report}
											/>
											<p id='open-oracle-exact-token1-report-help' className='field-help'>
												{openOracleCopy.initialToken1AmountHelpText}
											</p>
											{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('exactToken1Report'), exactToken1ReportError)}
										</label>
										<label className='field'>
											<span>{openOracleCopy.initialToken2Amount}</span>
											<FormInput
												aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('initialToken2Amount'), initialToken2AmountError, 'open-oracle-initial-token2-amount-help')}
												aria-label={openOracleCopy.initialToken2Amount}
												inputMode='decimal'
												invalid={initialToken2AmountError !== undefined}
												onBlur={() => markCreateFieldTouched('initialToken2Amount')}
												onInput={event => onOpenOracleCreateFormChange({ initialToken2Amount: event.currentTarget.value })}
												value={openOracleCreateForm.initialToken2Amount}
											/>
											<p id='open-oracle-initial-token2-amount-help' className='field-help'>
												{openOracleCopy.initialToken2AmountHelpText}
											</p>
											{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('initialToken2Amount'), initialToken2AmountError)}
										</label>
									</div>
									<label className='field'>
										<span>{openOracleCopy.settlerReward}</span>
										<FormInput
											aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('settlerRewardEthAmount'), settlerRewardError, 'open-oracle-settler-reward-help')}
											aria-label={openOracleCopy.settlerReward}
											inputMode='decimal'
											invalid={settlerRewardError !== undefined}
											onBlur={() => markCreateFieldTouched('settlerRewardEthAmount')}
											onInput={event => onOpenOracleCreateFormChange({ settlerRewardEthAmount: event.currentTarget.value })}
											value={openOracleCreateForm.settlerRewardEthAmount}
										/>
										<p id='open-oracle-settler-reward-help' className='field-help'>
											{openOracleCopy.settlerRewardHelpText}
										</p>
										{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('settlerRewardEthAmount'), settlerRewardError)}
									</label>
									<label className='field'>
										<span>{openOracleCopy.ethValueToSend}</span>
										<FormInput
											aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('ethValue'), ethValueError, 'open-oracle-eth-value-help')}
											aria-label={openOracleCopy.ethValueToSend}
											inputMode='decimal'
											invalid={ethValueError !== undefined}
											onBlur={() => markCreateFieldTouched('ethValue')}
											onInput={event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value })}
											value={openOracleCreateForm.ethValue}
										/>
										<p id='open-oracle-eth-value-help' className='field-help'>
											{openOracleCopy.creationFundingRequirementHelpText}
										</p>
										{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('ethValue'), ethValueError)}
									</label>
								</SectionBlock>

								<ReadOnlyDetailAccordion title={openOracleCopy.advancedDisputeAndTimingSettings}>
									<p className='detail'>{openOracleCopy.advancedDisputeAndTimingSettingsDetail}</p>
									<div className='field-row'>
										<label className='field'>
											<span>{openOracleCopy.disputeFeePercentage}</span>
											<FormInput
												aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('feePercentage'), feePercentageError)}
												aria-label={openOracleCopy.disputeFeePercentage}
												inputMode='decimal'
												invalid={feePercentageError !== undefined}
												onBlur={() => markCreateFieldTouched('feePercentage')}
												onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })}
												value={openOracleCreateForm.feePercentage}
											/>
											{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('feePercentage'), feePercentageError)}
										</label>
										<label className='field'>
											<span>{commonCopy.multiplier}</span>
											<FormInput
												aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('multiplier'), multiplierError, 'open-oracle-multiplier-help')}
												aria-label={commonCopy.multiplier}
												inputMode='numeric'
												invalid={multiplierError !== undefined}
												onBlur={() => markCreateFieldTouched('multiplier')}
												onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })}
												value={openOracleCreateForm.multiplier}
											/>
											<p id='open-oracle-multiplier-help' className='field-help'>
												{openOracleCopy.escalationMultiplierHelpText}
											</p>
											{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('multiplier'), multiplierError)}
										</label>
									</div>
									<SectionBlock headingLevel={4} title={openOracleCopy.timing} variant='embedded'>
										<div className='field-row'>
											<label className='field'>
												<span>{openOracleCopy.settlementDelaySeconds}</span>
												<FormInput
													aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('settlementTime'), settlementTimeError)}
													aria-label={openOracleCopy.settlementDelaySeconds}
													inputMode='numeric'
													invalid={settlementTimeError !== undefined}
													onBlur={() => markCreateFieldTouched('settlementTime')}
													onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })}
													value={openOracleCreateForm.settlementTime}
												/>
												{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('settlementTime'), settlementTimeError)}
											</label>
											<label className='field'>
												<span>{openOracleCopy.escalationHalt}</span>
												<FormInput
													aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('escalationHalt'), escalationHaltError, 'open-oracle-escalation-halt-help')}
													aria-label={openOracleCopy.escalationHalt}
													inputMode='decimal'
													invalid={escalationHaltError !== undefined}
													onBlur={() => markCreateFieldTouched('escalationHalt')}
													onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })}
													value={openOracleCreateForm.escalationHalt}
												/>
												<p id='open-oracle-escalation-halt-help' className='field-help'>
													{openOracleCopy.disputeEscalationStopAmountHelpText}
												</p>
												{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('escalationHalt'), escalationHaltError)}
											</label>
										</div>
										<div className='field-row'>
											<label className='field'>
												<span>{openOracleCopy.disputeDelaySeconds}</span>
												<FormInput
													aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('disputeDelay'), disputeDelayError)}
													aria-label={openOracleCopy.disputeDelaySeconds}
													inputMode='numeric'
													invalid={disputeDelayError !== undefined}
													onBlur={() => markCreateFieldTouched('disputeDelay')}
													onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })}
													value={openOracleCreateForm.disputeDelay}
												/>
												{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('disputeDelay'), disputeDelayError)}
											</label>
											<label className='field'>
												<span>{openOracleCopy.protocolFeePercentage}</span>
												<FormInput
													aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('protocolFee'), protocolFeeError)}
													aria-label={openOracleCopy.protocolFeePercentage}
													inputMode='decimal'
													invalid={protocolFeeError !== undefined}
													onBlur={() => markCreateFieldTouched('protocolFee')}
													onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })}
													value={openOracleCreateForm.protocolFee}
												/>
												{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('protocolFee'), protocolFeeError)}
											</label>
										</div>
									</SectionBlock>
									<h4>{openOracleCopy.parameterDetails}</h4>
									<p className='detail'>{openOracleCopy.standaloneParameterDetails}</p>
								</ReadOnlyDetailAccordion>

								<div className='actions'>
									<TransactionActionButton
										idleLabel={openOracleCopy.createStandaloneOracleGame}
										pendingLabel={openOracleCopy.creating}
										onClick={onCreateOpenOracleGame}
										pending={loadingOpenOracleCreate}
										availability={{ disabled: !isOnActiveAppChain || createGuardMessage !== undefined || !createValidation.isValid || hasCreateContractFieldErrors, reason: createAvailabilityMessage }}
										disabledReasonElementId={createDisabledReasonElementId}
										showDisabledReason={createDisabledReasonElementId === undefined}
									/>
								</div>
							</div>
						</SectionBlock>
					)}
					<ErrorNotice message={openOracleError} />
				</div>
			) : undefined}

			{view === 'selected-report' ? (
				<div className='workflow-stack route-workflow-stack open-oracle-report-stack'>
					<OpenOracleReportDetailsCard
						accountAddress={accountState.address}
						isConnected={isConnected}
						isOnActiveAppChain={isOnActiveAppChain}
						onApproveToken1={onApproveToken1}
						onApproveToken2={onApproveToken2}
						onDisputeReport={onDisputeReport}
						onLoadOracleReport={onLoadOracleReport}
						onOpenOracleFormChange={onOpenOracleFormChange}
						onSelectedReportModalChange={changeSelectedReportModal}
						onSettleReport={onSettleReport}
						onWithdrawOpenOracleBalance={onWithdrawOpenOracleBalance}
						openOracleActiveAction={openOracleActiveAction}
						openOracleActiveWithdrawalBalance={openOracleActiveWithdrawalBalance}
						openOracleDisputeSubmission={openOracleDisputeSubmission}
						openOracleForm={openOracleForm}
						openOracleReportDetails={effectiveOpenOracleReportDetails}
						openOracleReportLookupState={openOracleReportLookupState}
						openOracleResult={openOracleResult}
						openOracleTokenAccessState={openOracleTokenAccessState}
						openOracleWithdrawableBalances={openOracleWithdrawableBalances}
						openOracleWithdrawableBalancesError={openOracleWithdrawableBalancesError}
						openOracleWithdrawableBalancesLoading={openOracleWithdrawableBalancesLoading}
						openOracleWithdrawalBalanceChecking={openOracleWithdrawalBalanceChecking}
						openOracleWithdrawalReviewMessage={openOracleWithdrawalReviewMessage}
						selectedReportModal={selectedReportModal}
					/>
				</div>
			) : undefined}

			<ErrorNotice message={openOracleError} />
		</div>
	)
}
