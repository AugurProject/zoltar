import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { createTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { withActiveAppChainWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionObjectContext } from '@zoltar/ui-core-shared/components/TransactionObjectContext.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { getLocalEntityScope, useRememberOpenedEntity } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { useChainBlockNumber, useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { formatOpenOracleSecondsInputHint, getOpenOracleCreateEthSent, getOpenOracleCreateGuardMessage, getOpenOracleCreateValidation, getOpenOracleImpliedPrice, OPEN_ORACLE_CREATE_FIELD_ORDER, type OpenOracleCreateField } from '../lib/openOracle.js'
import { getCreatedOpenOracleReportId } from '../../../protocol/openOracle.js'
import { loadOpenOracleCreateTokenMetadata, useOpenOracleCreateTokenMetadata, type LoadOpenOracleCreateTokenMetadata, type OpenOracleCreateTokenMetadata } from '../hooks/useOpenOracleCreateTokenMetadata.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { getOpenOracleReportEntityId, openOracleReportDownloadStore, toCachedOpenOracleReportSummary } from '../lib/reportBrowse.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { formatCurrencyBalance, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { OpenOracleSectionProps, OpenOracleView } from '../../oracleTypes.js'
import { BROWSE_PAGE_SIZE, getEffectiveOpenOracleReportDetails, getOpenOracleCreateFieldErrorId, loadBrowseReportPage, OPEN_ORACLE_PRICE_UNITS, type SelectedReportModal } from './OpenOracleReportContent.js'
import { OpenOracleReportBrowser } from './OpenOracleReportBrowser.js'
import { OpenOracleReportDetailsCard } from './OpenOracleReportDetailsCard.js'

function getOpenOracleRouteHeader(view: OpenOracleView) {
	if (view === 'browse') return { description: openOracleCopy.browseReportsDescription, title: openOracleCopy.browseReports }
	if (view === 'create') return { description: openOracleCopy.createReportDescription, title: openOracleCopy.createReport }
	return { description: openOracleCopy.selectedReportDescription, title: openOracleCopy.openOracleReportDetails }
}

function getCreateTokenSymbol(metadata: OpenOracleCreateTokenMetadata) {
	return metadata.status === 'ready' ? metadata.symbol : undefined
}

function getCreateTokenHint(metadata: OpenOracleCreateTokenMetadata) {
	if (metadata.status === 'loading') return openOracleCopy.readingTokenMetadata
	if (metadata.status === 'ready') return openOracleCopy.formatResolvedToken(metadata.symbol ?? commonCopy.metricUnavailablePlaceholder, metadata.decimals.toString())
	return undefined
}

type OpenOracleSectionDependencies = {
	/** Reads a create-form token's decimals and symbol; tests replace the connected-wallet read. */
	loadCreateTokenMetadata?: LoadOpenOracleCreateTokenMetadata
}

export function OpenOracleSection({
	activeView,
	accountState,
	environmentReady,
	loadBrowseReports = loadBrowseReportPage,
	loadCreateTokenMetadata = loadOpenOracleCreateTokenMetadata,
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
}: OpenOracleSectionProps & OpenOracleSectionDependencies) {
	const view = activeView
	const routeHeader = getOpenOracleRouteHeader(view)
	const chainCurrentTimestamp = useChainTimestamp()
	const chainCurrentBlockNumber = useChainBlockNumber()
	const [selectedReportModal, setSelectedReportModal] = useState<SelectedReportModal>(undefined)
	const [touchedCreateFields, setTouchedCreateFields] = useState<ReadonlySet<OpenOracleCreateField>>(new Set())
	const [dismissedCreateSuccessKey, setDismissedCreateSuccessKey] = useState<string | undefined>(undefined)
	const changeSelectedReportModal = (modal: SelectedReportModal) => {
		setSelectedReportModal(modal)
	}
	const cancelWithdrawal = useRef(onCancelOpenOracleWithdrawalBalanceCheck)
	cancelWithdrawal.current = onCancelOpenOracleWithdrawalBalanceCheck
	useEffect(() => () => cancelWithdrawal.current(), [view])
	const isConnected = accountState.address !== undefined
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const createTokenMetadata = useOpenOracleCreateTokenMetadata({ environmentReady, loadTokenMetadata: loadCreateTokenMetadata, token1Address: openOracleCreateForm.token1Address, token2Address: openOracleCreateForm.token2Address })
	const token1Decimals = createTokenMetadata.token1.status === 'ready' ? createTokenMetadata.token1.decimals : undefined
	const token2Decimals = createTokenMetadata.token2.status === 'ready' ? createTokenMetadata.token2.decimals : undefined
	const token1Symbol = getCreateTokenSymbol(createTokenMetadata.token1)
	const token2Symbol = getCreateTokenSymbol(createTokenMetadata.token2)
	const createTokenMetadataLoading = createTokenMetadata.token1.status === 'loading' || createTokenMetadata.token2.status === 'loading'
	// Known token decimals let amount fields report precision errors while typing instead of after submitting.
	const createValidation = getOpenOracleCreateValidation({ form: openOracleCreateForm, token1Decimals, token2Decimals })
	const token1ContractError = openOracleCreateFieldErrors.token1Address ?? (createTokenMetadata.token1.status === 'failure' ? createTokenMetadata.token1.message : undefined)
	const token2ContractError = openOracleCreateFieldErrors.token2Address ?? (createTokenMetadata.token2.status === 'failure' ? createTokenMetadata.token2.message : undefined)
	const hasCreateContractFieldErrors = token1ContractError !== undefined || token2ContractError !== undefined
	const rawCreateGuardMessage = getOpenOracleCreateGuardMessage({
		isOnActiveAppChain,
		settlerRewardInput: openOracleCreateForm.settlerRewardEthAmount,
		walletConnected: isConnected,
		walletBalanceAttoEth: accountState.ethBalanceAttoEth,
	})
	const createGuardMessage = !isConnected || !isOnActiveAppChain || createValidation.isValid ? rawCreateGuardMessage : undefined
	const markCreateFieldTouched = (field: OpenOracleCreateField) => setTouchedCreateFields(current => new Set([...current, field]))
	// Editing a field hides its validation error again until the next blur, so the live region stays quiet while typing.
	const clearCreateFieldTouched = (field: OpenOracleCreateField) =>
		setTouchedCreateFields(current => {
			if (!current.has(field)) return current
			const next = new Set(current)
			next.delete(field)
			return next
		})
	const editCreateField = (field: OpenOracleCreateField, update: Parameters<OpenOracleSectionProps['onOpenOracleCreateFormChange']>[0]) => {
		clearCreateFieldTouched(field)
		onOpenOracleCreateFormChange(update)
	}
	const getCreateContractFieldError = (field: OpenOracleCreateField) => {
		if (field === 'token1Address') return token1ContractError
		if (field === 'token2Address') return token2ContractError
		return undefined
	}
	const getVisibleCreateFieldError = (field: OpenOracleCreateField) => getCreateContractFieldError(field) ?? (touchedCreateFields.has(field) ? createValidation.fieldErrors[field] : undefined)
	const firstVisibleInvalidCreateField = OPEN_ORACLE_CREATE_FIELD_ORDER.find(field => getVisibleCreateFieldError(field) !== undefined)
	const createDisabledReasonElementId = createGuardMessage === undefined && firstVisibleInvalidCreateField !== undefined ? getOpenOracleCreateFieldErrorId(firstVisibleInvalidCreateField) : undefined
	const createAvailabilityMessage = createGuardMessage ?? token1ContractError ?? token2ContractError ?? (createTokenMetadataLoading ? openOracleCopy.readingTokenMetadata : undefined) ?? createValidation.message
	const disputeDelayError = getVisibleCreateFieldError('disputeDelay')
	const escalationHaltError = getVisibleCreateFieldError('escalationHalt')
	const exactToken1ReportError = getVisibleCreateFieldError('exactToken1Report')
	const feePercentageError = getVisibleCreateFieldError('feePercentage')
	const initialToken2AmountError = getVisibleCreateFieldError('initialToken2Amount')
	const multiplierError = getVisibleCreateFieldError('multiplier')
	const protocolFeeError = getVisibleCreateFieldError('protocolFee')
	const settlementTimeError = getVisibleCreateFieldError('settlementTime')
	const settlerRewardError = getVisibleCreateFieldError('settlerRewardEthAmount')
	const token1AddressError = getVisibleCreateFieldError('token1Address')
	const token2AddressError = getVisibleCreateFieldError('token2Address')
	const createEthSentAttoEth = getOpenOracleCreateEthSent(openOracleCreateForm.settlerRewardEthAmount)
	const createEthSentText = createEthSentAttoEth === undefined || createEthSentAttoEth < 0n ? commonCopy.metricUnavailablePlaceholder : formatCurrencyBalance(createEthSentAttoEth)
	const createImpliedPrice = getOpenOracleImpliedPrice({ token1Amount: openOracleCreateForm.exactToken1Report, token2Amount: openOracleCreateForm.initialToken2Amount })
	const createPriceUnit = openOracleCopy.formatReportPriceUnit(token1Symbol ?? openOracleCopy.baseToken, token2Symbol ?? openOracleCopy.quoteToken)
	const createImpliedPriceValue = createImpliedPrice === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={createImpliedPrice} suffix={createPriceUnit} units={OPEN_ORACLE_PRICE_UNITS} />
	const effectiveOpenOracleReportDetails = getEffectiveOpenOracleReportDetails(openOracleReportDetails, chainCurrentTimestamp, chainCurrentBlockNumber)
	const successfulCreateKey = openOracleResult?.action === 'createReportInstance' ? openOracleResult.hash : undefined
	const createdReportId = getCreatedOpenOracleReportId(openOracleResult)
	const showCreateSuccess = successfulCreateKey !== undefined && successfulCreateKey !== dismissedCreateSuccessKey
	useEffect(() => {
		if (successfulCreateKey === undefined) return
		setTouchedCreateFields(new Set())
	}, [successfulCreateKey])
	// A new report is newest on the first registry page; one bounded read adds it to the downloaded reports. Opening a report saves it to favorites even if this best-effort read fails.
	useEffect(() => {
		if (successfulCreateKey === undefined || !environmentReady) return undefined
		let cancelled = false
		void loadBrowseReports(0, BROWSE_PAGE_SIZE)
			.then(page => {
				if (cancelled) return
				openOracleReportDownloadStore.record(
					getLocalEntityScope('statoblast', 'oracleReport'),
					page.reports.map(report => ({ data: toCachedOpenOracleReportSummary(report), id: getOpenOracleReportEntityId(report.reportId) })),
				)
			})
			.catch(() => undefined)
		return () => {
			cancelled = true
		}
	}, [environmentReady, loadBrowseReports, successfulCreateKey])
	// Opening a report favorites it once per visit and keeps its cached summary current for browsing. A refresh keeps the
	// loaded details while it is loading, so the opened report stays the same entity and an un-star is not undone.
	const openedReportIsLoaded = openOracleReportDetails !== undefined && openOracleReportLookupState !== 'missing' && openOracleReportLookupState !== 'load-failed'
	const openedReportSummary = useMemo(() => (view === 'selected-report' && openedReportIsLoaded && openOracleReportDetails !== undefined ? toCachedOpenOracleReportSummary(openOracleReportDetails) : undefined), [openOracleReportDetails, openedReportIsLoaded, view])
	useRememberOpenedEntity('statoblast', 'oracleReport', openOracleReportDownloadStore, openedReportSummary === undefined ? undefined : getOpenOracleReportEntityId(openedReportSummary.reportId), openedReportSummary)
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
					<OpenOracleReportBrowser onOpenReport={reportId => void openBrowseReport(reportId)} />
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='workflow-stack route-workflow-stack'>
					{!showCreateSuccess ? undefined : (
						<SectionBlock title={openOracleCopy.reportCreated}>
							<UserMessage tone='success' detail={createdReportId === undefined ? openOracleCopy.reportCreatedWithoutIdDetail : openOracleCopy.formatReportCreatedDetail(createdReportId.toString())} />
							<div className='actions'>
								{createdReportId === undefined ? undefined : (
									<button
										className='primary'
										type='button'
										onClick={() => {
											setDismissedCreateSuccessKey(successfulCreateKey)
											void openBrowseReport(createdReportId)
										}}
									>
										{openOracleCopy.formatOpenReportById(createdReportId.toString())}
									</button>
								)}
								<button
									className={createdReportId === undefined ? 'primary' : 'secondary'}
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
						<SectionBlock title={openOracleCopy.standaloneReportSettings} variant='plain'>
							<UserMessage tone='warning' detail={openOracleCopy.standaloneOracleWarningDetail} />
							<UserMessage className='detail' detail={openOracleCopy.standaloneOracleIntroduction} />
							<TransactionObjectContext
								className='mobile-workflow-context'
								title={openOracleCopy.reportAtAGlance}
								items={[
									{ label: openOracleCopy.baseToken, value: <AddressValue address={openOracleCreateForm.token1Address.trim() === '' ? undefined : openOracleCreateForm.token1Address} copyable={false} responsiveAbbreviation /> },
									{ label: openOracleCopy.quoteToken, value: <AddressValue address={openOracleCreateForm.token2Address.trim() === '' ? undefined : openOracleCreateForm.token2Address} copyable={false} responsiveAbbreviation /> },
									{ label: openOracleCopy.impliedInitialPrice, value: createImpliedPriceValue },
									{ label: openOracleCopy.ethSent, value: formatValueWithUnit(createEthSentText, commonCopy.eth) },
								]}
							/>
							<div className='form-grid'>
								<SectionBlock headingLevel={4} title={openOracleCopy.tokenPair} variant='embedded'>
									<div className='field-row'>
										<div className='field'>
											<label>
												<span>{openOracleCopy.token1Address}</span>
												<FormInput
													aria-label={openOracleCopy.token1Address}
													error={token1AddressError}
													errorId={getOpenOracleCreateFieldErrorId('token1Address')}
													hint={token1AddressError === undefined ? getCreateTokenHint(createTokenMetadata.token1) : undefined}
													liveError
													onBlur={() => markCreateFieldTouched('token1Address')}
													onInput={event => editCreateField('token1Address', { token1Address: event.currentTarget.value })}
													placeholder={commonCopy.hexValuePlaceholder}
													value={openOracleCreateForm.token1Address}
												/>
											</label>
										</div>
										<div className='field'>
											<label>
												<span>{openOracleCopy.token2Address}</span>
												<FormInput
													aria-label={openOracleCopy.token2Address}
													error={token2AddressError}
													errorId={getOpenOracleCreateFieldErrorId('token2Address')}
													hint={token2AddressError === undefined ? getCreateTokenHint(createTokenMetadata.token2) : undefined}
													liveError
													onBlur={() => markCreateFieldTouched('token2Address')}
													onInput={event => editCreateField('token2Address', { token2Address: event.currentTarget.value })}
													placeholder={commonCopy.hexValuePlaceholder}
													value={openOracleCreateForm.token2Address}
												/>
											</label>
										</div>
									</div>
								</SectionBlock>

								<SectionBlock headingLevel={4} title={openOracleCopy.initialEconomics} variant='embedded'>
									<div className='field-row'>
										<label className='field'>
											<span>{openOracleCopy.exactToken1Report}</span>
											<FormInput
												adornment={token1Symbol}
												aria-label={openOracleCopy.exactToken1Report}
												error={exactToken1ReportError}
												errorId={getOpenOracleCreateFieldErrorId('exactToken1Report')}
												hint={openOracleCopy.initialToken1AmountHelpText}
												inputMode='decimal'
												liveError
												onBlur={() => markCreateFieldTouched('exactToken1Report')}
												onInput={event => editCreateField('exactToken1Report', { exactToken1Report: event.currentTarget.value })}
												value={openOracleCreateForm.exactToken1Report}
											/>
										</label>
										<label className='field'>
											<span>{openOracleCopy.initialToken2Amount}</span>
											<FormInput
												adornment={token2Symbol}
												aria-label={openOracleCopy.initialToken2Amount}
												error={initialToken2AmountError}
												errorId={getOpenOracleCreateFieldErrorId('initialToken2Amount')}
												hint={openOracleCopy.initialToken2AmountHelpText}
												inputMode='decimal'
												liveError
												onBlur={() => markCreateFieldTouched('initialToken2Amount')}
												onInput={event => editCreateField('initialToken2Amount', { initialToken2Amount: event.currentTarget.value })}
												value={openOracleCreateForm.initialToken2Amount}
											/>
										</label>
									</div>
									<label className='field'>
										<span>{openOracleCopy.settlerReward}</span>
										<FormInput
											adornment={commonCopy.eth}
											aria-label={openOracleCopy.settlerReward}
											error={settlerRewardError}
											errorId={getOpenOracleCreateFieldErrorId('settlerRewardEthAmount')}
											hint={openOracleCopy.settlerRewardHelpText}
											inputMode='decimal'
											liveError
											onBlur={() => markCreateFieldTouched('settlerRewardEthAmount')}
											onInput={event => editCreateField('settlerRewardEthAmount', { settlerRewardEthAmount: event.currentTarget.value })}
											value={openOracleCreateForm.settlerRewardEthAmount}
										/>
									</label>
								</SectionBlock>

								<ReadOnlyDetailAccordion title={openOracleCopy.advancedDisputeAndTimingSettings}>
									<UserMessage className='detail' detail={openOracleCopy.advancedDisputeAndTimingSettingsDetail} />
									<div className='field-row'>
										<label className='field'>
											<span>{openOracleCopy.disputeFeePercentage}</span>
											<FormInput
												aria-label={openOracleCopy.disputeFeePercentage}
												error={feePercentageError}
												errorId={getOpenOracleCreateFieldErrorId('feePercentage')}
												inputMode='decimal'
												liveError
												onBlur={() => markCreateFieldTouched('feePercentage')}
												onInput={event => editCreateField('feePercentage', { feePercentage: event.currentTarget.value })}
												value={openOracleCreateForm.feePercentage}
											/>
										</label>
										<label className='field'>
											<span>{commonCopy.multiplier}</span>
											<FormInput
												adornment={openOracleCopy.multiplierUnit}
												aria-label={commonCopy.multiplier}
												error={multiplierError}
												errorId={getOpenOracleCreateFieldErrorId('multiplier')}
												hint={openOracleCopy.escalationMultiplierHelpText}
												inputMode='decimal'
												liveError
												onBlur={() => markCreateFieldTouched('multiplier')}
												onInput={event => editCreateField('multiplier', { multiplier: event.currentTarget.value })}
												value={openOracleCreateForm.multiplier}
											/>
										</label>
									</div>
									<SectionBlock headingLevel={4} title={openOracleCopy.timing} variant='embedded'>
										<div className='field-row'>
											<label className='field'>
												<span>{openOracleCopy.settlementDelaySeconds}</span>
												<FormInput
													aria-label={openOracleCopy.settlementDelaySeconds}
													error={settlementTimeError}
													errorId={getOpenOracleCreateFieldErrorId('settlementTime')}
													hint={formatOpenOracleSecondsInputHint(openOracleCreateForm.settlementTime)}
													inputMode='numeric'
													liveError
													onBlur={() => markCreateFieldTouched('settlementTime')}
													onInput={event => editCreateField('settlementTime', { settlementTime: event.currentTarget.value })}
													value={openOracleCreateForm.settlementTime}
												/>
											</label>
											<label className='field'>
												<span>{openOracleCopy.escalationHalt}</span>
												<FormInput
													adornment={token1Symbol}
													aria-label={openOracleCopy.escalationHalt}
													error={escalationHaltError}
													errorId={getOpenOracleCreateFieldErrorId('escalationHalt')}
													hint={openOracleCopy.disputeEscalationStopAmountHelpText}
													inputMode='decimal'
													liveError
													onBlur={() => markCreateFieldTouched('escalationHalt')}
													onInput={event => editCreateField('escalationHalt', { escalationHalt: event.currentTarget.value })}
													value={openOracleCreateForm.escalationHalt}
												/>
											</label>
										</div>
										<div className='field-row'>
											<label className='field'>
												<span>{openOracleCopy.disputeDelaySeconds}</span>
												<FormInput
													aria-label={openOracleCopy.disputeDelaySeconds}
													error={disputeDelayError}
													errorId={getOpenOracleCreateFieldErrorId('disputeDelay')}
													hint={formatOpenOracleSecondsInputHint(openOracleCreateForm.disputeDelay)}
													inputMode='numeric'
													liveError
													onBlur={() => markCreateFieldTouched('disputeDelay')}
													onInput={event => editCreateField('disputeDelay', { disputeDelay: event.currentTarget.value })}
													value={openOracleCreateForm.disputeDelay}
												/>
											</label>
											<label className='field'>
												<span>{openOracleCopy.protocolFeePercentage}</span>
												<FormInput
													aria-label={openOracleCopy.protocolFeePercentage}
													error={protocolFeeError}
													errorId={getOpenOracleCreateFieldErrorId('protocolFee')}
													inputMode='decimal'
													liveError
													onBlur={() => markCreateFieldTouched('protocolFee')}
													onInput={event => editCreateField('protocolFee', { protocolFee: event.currentTarget.value })}
													value={openOracleCreateForm.protocolFee}
												/>
											</label>
										</div>
									</SectionBlock>
									<h4>{openOracleCopy.parameterDetails}</h4>
									<UserMessage className='detail' detail={openOracleCopy.standaloneParameterDetails} />
								</ReadOnlyDetailAccordion>

								<div className='actions'>
									<TransactionActionButton
										idleLabel={openOracleCopy.createStandaloneOracleGame}
										pendingLabel={openOracleCopy.creating}
										onClick={onCreateOpenOracleGame}
										pending={loadingOpenOracleCreate}
										availability={withActiveAppChainWalletBlocker(
											{ disabled: !isOnActiveAppChain || createGuardMessage !== undefined || !createValidation.isValid || hasCreateContractFieldErrors || createTokenMetadataLoading, reason: createAvailabilityMessage },
											{ accountAddress: accountState.address, isOnActiveAppChain },
										)}
										disabledReasonElementId={createDisabledReasonElementId}
										showDisabledReason={createDisabledReasonElementId === undefined}
									/>
								</div>
							</div>
						</SectionBlock>
					)}
				</div>
			) : undefined}

			{view === 'selected-report' ? (
				<div className='workflow-stack route-workflow-stack open-oracle-report-stack'>
					<TransactionScopeProvider scope={createTransactionScope('open-oracle-report', openOracleForm.reportId)}>
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
					</TransactionScopeProvider>
				</div>
			) : undefined}

			<ErrorNotice message={openOracleError} />
		</div>
	)
}
