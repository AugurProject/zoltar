import { getReportingSubmissionTimingGuard } from '../../../protocol/reportingTiming.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ReportingDepositPreview } from './ReportingDepositPreview.js'
import { getDisplayedLeadingEscalationOutcome, getReportingOutcomeLabel, hasReportingOpened, deriveReportingStage, isReportingOutcomeEnabled, isWithdrawEscalationEnabled } from '../lib/reporting.js'
import { getOutcomeSides, ReportingOutcomePicker } from './ReportingOutcomePicker.js'
import { useKeyedConfirmation } from '../hooks/useKeyedConfirmation.js'
import { getReportingMaxContribution } from '../lib/reportingMaxContribution.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { useId, useRef } from 'preact/hooks'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { RepAmount } from './RepAmount.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WalletActionFixReason } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { getActiveAppChainWalletBlocker, withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { pickFirstReason } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { formatCurrencyBalance, formatCurrencyInputBalance, formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { parseOptionalRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getWrongNetworkReason, isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getEscalationPhase, getReportingMaxProfitContribution, getReportingMinimumOutcomeChangeContribution, getRemainingSelectedOutcomeContributionCapacity, isPoolQuestionFinalized, previewReportingContribution, reportingContributionTriggersFork } from '../lib/reportingDomain.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import type { ReportingDetails } from '../../../types/contracts.js'
import { ReportingSettlementSection } from './ReportingSettlementSection.js'
import { ForkTriggeredActions } from './ForkTriggeredActions.js'
import { useOldActionDataNotice } from '../../useStatoblastPageRefresh.js'
import type { ReportingSectionProps } from '../../oracleTypes.js'
function getEffectiveReportingDetails(reportingDetails: ReportingDetails | undefined, currentTimestamp: bigint | undefined) {
	if (reportingDetails === undefined || currentTimestamp === undefined || reportingDetails.currentTime === currentTimestamp) return reportingDetails
	return { ...reportingDetails, currentTime: currentTimestamp }
}

function formatKnownAmount(amount: bigint | undefined) {
	return amount === undefined ? commonCopy.metricUnavailablePlaceholder : formatCurrencyBalance(amount)
}
type ReportingStatus = 'active' | 'missing' | 'not-started'
const LOAD_REPORTING_PRESETS_REASON = reportingCopy.loadingReportingDetails
const SELECT_OUTCOME_PRESET_REASON = reportingCopy.presetOutcomeSelectionRequired
const SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE = reportingCopy.reportingActivationHint
function isRedundantPresetReason(reason: string | undefined) {
	return reason === LOAD_REPORTING_PRESETS_REASON || reason === SELECT_OUTCOME_PRESET_REASON
}
export function ReportingSection({
	accountState,
	actionDataReadAt,
	oracleBlocker,
	currentTimestamp,
	forkAlreadyTriggered = false,
	loadingReportingDetails,
	lockedReason,
	onApproveReportingRep,
	onLoadReporting,
	onOpenForkWorkflow,
	onOpenPriceOracle,
	onTriggerZoltarFork,
	onReportOutcome,
	onReportingFormChange,
	onWithdrawEscalation,
	reportingActiveAction,
	reportingDetails,
	reportingError,
	reportingForm,
	reportActionGuardMessage,
	triggerZoltarForkApproval,
	triggerZoltarForkAvailability,
	triggerZoltarForkPending = false,
}: ReportingSectionProps) {
	const oldActionData = useOldActionDataNotice(actionDataReadAt)
	const presetBlockerId = useId()
	const reportDisabledReasonId = useId()
	const settlementDisabledReasonId = useId()
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const walletBlocker = getActiveAppChainWalletBlocker({ accountAddress: accountState.address, isOnActiveAppChain })
	const reportActionButtonRef = useRef<HTMLButtonElement>(null)
	const effectiveCurrentTimestamp = currentTimestamp ?? reportingDetails?.currentTime
	const effectiveReportingDetails = getEffectiveReportingDetails(reportingDetails, effectiveCurrentTimestamp)
	const activeReportingDetails = effectiveReportingDetails?.status === 'active' ? effectiveReportingDetails : undefined
	const escalationPhase = activeReportingDetails === undefined ? undefined : getEscalationPhase(activeReportingDetails)
	const reportingStatus: ReportingStatus = effectiveReportingDetails === undefined ? 'missing' : effectiveReportingDetails.status
	const marketDetails = effectiveReportingDetails?.marketDetails
	const reportingReady = marketDetails === undefined ? undefined : hasReportingOpened(marketDetails.endTime, effectiveCurrentTimestamp)
	const reportingStageKey = deriveReportingStage({
		reportingDetails: effectiveReportingDetails,
		reportingReady,
	})
	const reportOutcomeEnabled = isReportingOutcomeEnabled(reportingStageKey)
	const withdrawEscalationEnabled = isWithdrawEscalationEnabled(reportingStageKey)
	const reportLifecycleReason = reportingStageKey === 'timedOut' ? reportingCopy.refreshFinalizedOutcomeReason : undefined

	const fullReportingLoadingReason = loadingReportingDetails ? reportingCopy.loadingReportingDetails : undefined
	const reportControlsLockedReason = pickFirstReason(fullReportingLoadingReason, effectiveReportingDetails?.reportingBlockedReason, reportActionGuardMessage, lockedReason, reportLifecycleReason)
	const reportControlsLocked = !reportOutcomeEnabled || reportControlsLockedReason !== undefined
	let settlementLifecycleReason: string | undefined
	if (reportingStageKey === 'timedOut') settlementLifecycleReason = reportingCopy.refreshFinalizedOutcomeReason
	else if (reportingStageKey === 'activeLocked') settlementLifecycleReason = reportingCopy.questionFinalizationRequired
	const withdrawControlsLockedReason = activeReportingDetails?.settlementState === 'resolved' && loadingReportingDetails ? reportingCopy.loadingReportingDetails : (lockedReason ?? settlementLifecycleReason)
	const withdrawControlsLocked = !withdrawEscalationEnabled || withdrawControlsLockedReason !== undefined
	const selectedAmount = parseOptionalRepAmountInput(reportingForm.reportAmount)
	const selectedOutcome = reportingForm.selectedOutcome
	const outcomeSides = getOutcomeSides(effectiveReportingDetails)
	const finalized = isPoolQuestionFinalized(effectiveReportingDetails)
	const leadingOutcome = activeReportingDetails === undefined || (escalationPhase === 'Timed Out' && !finalized) ? undefined : getDisplayedLeadingEscalationOutcome(activeReportingDetails.sides)
	const reportContributionPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : previewReportingContribution(effectiveReportingDetails, selectedOutcome, selectedAmount)
	const actualReportDepositAmount = reportContributionPreview?.actualDepositAmount
	const walletDepositAmount = actualReportDepositAmount
	const selectedOutcomeLabel = selectedOutcome === undefined ? reportingCopy.selectedSide : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome))
	const availableReportingRep = effectiveReportingDetails?.viewerWalletRepBalanceAttoRep
	const reportTriggersFork = reportingContributionTriggersFork(effectiveReportingDetails, selectedOutcome, selectedAmount)
	// A confirmation covers one exact fork-triggering report; any change to the pool, side, or amount asks again.
	const forkConfirmation = useKeyedConfirmation(reportTriggersFork ? `${effectiveReportingDetails?.questionLedgerAddress ?? ''}:${selectedOutcome ?? ''}:${selectedAmount?.toString() ?? ''}` : undefined)
	const reportDisplayAmount = formatCurrencyBalance(actualReportDepositAmount ?? selectedAmount ?? 0n)
	const reportButtonLabel = selectedOutcome === undefined ? reportingCopy.reportOnSelectedSide : commonCopy.launchAction((reportTriggersFork ? reportingCopy.reportAndEndReportingLabel : reportingCopy.reportAmountLabel)(selectedOutcomeLabel, reportDisplayAmount))
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const takingLeadWouldFork = reportingContributionTriggersFork(effectiveReportingDetails, selectedOutcome, minimumOutcomeChangeContribution.amountAttoRep)
	const maxProfitContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome)
	const minimumAmount = remainingSelectedOutcomeCapacity !== undefined && remainingSelectedOutcomeCapacity > 0n ? effectiveReportingDetails?.startBondAttoRep : undefined
	const minimumReason = remainingSelectedOutcomeCapacity === 0n ? reportingCopy.selectedSideCapacityEmpty : minimumOutcomeChangeContribution.reason
	const takeLeadAmount = reportingStatus === 'active' && !takingLeadWouldFork ? minimumOutcomeChangeContribution.amountAttoRep : undefined
	let takeLeadReason = minimumOutcomeChangeContribution.reason
	if (takingLeadWouldFork) takeLeadReason = reportingCopy.takeLeadForkReason
	else if (reportingStatus === 'not-started' && selectedOutcome !== undefined) takeLeadReason = reportingCopy.takeLeadBeforeFirstReport
	const outcomePresets = [
		{ kind: 'min', amount: minimumAmount, reason: minimumAmount === undefined ? minimumReason : undefined },
		{ kind: 'takeLead', amount: takeLeadAmount, reason: takeLeadReason },
	] as const
	const presetBlocker = reportControlsLocked ? undefined : [...outcomePresets.map(preset => preset.reason), maxProfitContribution.reason].find(reason => reason !== undefined && !isRedundantPresetReason(reason))
	const maxContributionAmount = getReportingMaxContribution({ availableReportingRep, details: effectiveReportingDetails, forkConfirmed: forkConfirmation.confirmed, selectedOutcome, usesWalletFunding: true })
	const presetReasons = [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason, maxContributionAmount.reason].filter((reason, index, reasons) => reason !== undefined && !isRedundantPresetReason(reason) && reason !== presetBlocker && reasons.indexOf(reason) === index)
	const reportGuardParameters = {
		actualDepositAmount: actualReportDepositAmount,
		accountAddress: accountState.address,
		walletDepositAmount,
		contributionPreviewReason: reportContributionPreview?.reason,
		isOnActiveAppChain,
		remainingSelectedOutcomeCapacity,
		reportAmount: reportingForm.reportAmount,
		reportingStatus,
		selectedOutcome,
		selectedAmount,
		viewerWalletRepAllowanceAttoRep: effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep,
		viewerWalletRepBalanceAttoRep: effectiveReportingDetails?.viewerWalletRepBalanceAttoRep,
	}
	const forkConfirmationReason = reportTriggersFork && !forkConfirmation.confirmed ? reportingCopy.forkTriggerConfirmationRequired : undefined
	const reportPrerequisiteReason = getReportingReportGuardMessage(reportGuardParameters)
	// The fork confirmation and the REP approval are independent steps, so when both are missing the reason names both instead of hiding the confirmation behind the approval.
	const reportReadinessReason = forkConfirmationReason !== undefined && reportPrerequisiteReason === reportingCopy.reportingRepApprovalRequired ? reportingCopy.forkTriggerConfirmationAndApprovalRequired : (reportPrerequisiteReason ?? forkConfirmationReason)
	const reportGuardMessage = fullReportingLoadingReason ?? reportActionGuardMessage ?? reportControlsLockedReason ?? getReportingSubmissionTimingGuard(activeReportingDetails) ?? reportReadinessReason
	const visiblePresetReasons = presetReasons.filter(reason => reason !== reportingCopy.poolHeldVaultRepBackingEmpty || reportGuardMessage !== reportingCopy.noVaultRepSelectWallet)
	const reportingApprovalGuardMessage = getReportingReportGuardMessage({ ...reportGuardParameters, requireAllowance: false })
	const reportingApprovalSatisfied = walletDepositAmount !== undefined && effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep !== undefined && effectiveReportingDetails.viewerWalletRepAllowanceAttoRep >= walletDepositAmount
	// The approval shares the report's network, lifecycle, and amount checks, but not the allowance it raises.
	const reportingApprovalGuard = !isOnActiveAppChain ? getWrongNetworkReason() : (reportControlsLockedReason ?? getReportingSubmissionTimingGuard(activeReportingDetails) ?? reportingApprovalGuardMessage)

	const reportButtonGuardMessage = fullReportingLoadingReason ?? (reportActionGuardMessage === undefined ? reportGuardMessage : reportingCopy.currentOraclePriceRequired)
	const reportActionDisabledReason = !isOnActiveAppChain ? getWrongNetworkReason() : reportButtonGuardMessage
	// The wallet blocks reporting when it is on another network, or when no earlier reason precedes the wallet-first report guard.
	const reportWalletBlocker = !isOnActiveAppChain || pickFirstReason(fullReportingLoadingReason, reportActionGuardMessage, reportControlsLockedReason) === undefined ? walletBlocker : undefined
	const hasPositiveReportAmount = selectedAmount !== undefined && selectedAmount > 0n
	const reportActionAvailability = withWalletBlocker(
		{ disabled: !isOnActiveAppChain || !reportOutcomeEnabled || !hasPositiveReportAmount || reportButtonGuardMessage !== undefined, loading: fullReportingLoadingReason !== undefined && reportActionDisabledReason === fullReportingLoadingReason, reason: reportActionDisabledReason },
		reportWalletBlocker,
	)
	const withdrawGuardMessage =
		withdrawControlsLockedReason ??
		getReportingWithdrawGuardMessage({
			accountAddress: accountState.address,
			isOnActiveAppChain,
			reportingStatus,
		})
	const displayedWithdrawGuardMessage = loadingReportingDetails ? reportingCopy.loadingReportingDetails : withdrawGuardMessage
	const reportOutcomeSelectionMessage = reportingStatus !== 'missing' && selectedOutcome === undefined && !reportControlsLocked && reportActionDisabledReason === reportingCopy.reportOutcomeSelectionRequired ? SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE : undefined
	const showForkWorkflowAction = reportingStageKey === 'forkTriggered' && forkAlreadyTriggered && onOpenForkWorkflow !== undefined
	const showTriggerZoltarForkAction = reportingStageKey === 'forkTriggered' && activeReportingDetails?.hasReachedNonDecision === true && !forkAlreadyTriggered && onTriggerZoltarFork !== undefined
	// Zoltar rejects a fork until the parent fork response period ends; equal timestamps are allowed.
	const parentForkResponseReason =
		activeReportingDetails !== undefined && effectiveCurrentTimestamp !== undefined && effectiveCurrentTimestamp < activeReportingDetails.earliestForkTime
			? zoltarCopy.formatParentForkResponseActiveReason(formatTimestamp(activeReportingDetails.earliestForkTime), formatRelativeTimestamp(activeReportingDetails.earliestForkTime, effectiveCurrentTimestamp))
			: undefined
	const forkUnavailableReason = activeReportingDetails?.canTriggerOwnFork === false ? reportingCopy.inheritedOutcomeCannotFork : parentForkResponseReason
	const resolvedTriggerZoltarForkAvailability = triggerZoltarForkAvailability?.disabled === true || forkUnavailableReason === undefined ? (triggerZoltarForkAvailability ?? { disabled: false, reason: undefined }) : { disabled: true, reason: forkUnavailableReason }
	const forkTriggeredActions =
		reportingStageKey !== 'forkTriggered' || (!showForkWorkflowAction && !showTriggerZoltarForkAction) ? undefined : (
			<ForkTriggeredActions
				actionDataNotice={oldActionData}
				approval={showTriggerZoltarForkAction ? triggerZoltarForkApproval : undefined}
				forkButton={
					showTriggerZoltarForkAction ? (
						<TransactionActionButton
							idleLabel={resolvedTriggerZoltarForkAvailability.loading === true ? reportingCopy.checkingFork : reportingCopy.triggerZoltarFork}
							pendingLabel={reportingCopy.triggeringZoltarFork}
							onClick={onTriggerZoltarFork}
							pending={triggerZoltarForkPending}
							availability={resolvedTriggerZoltarForkAvailability}
						/>
					) : undefined
				}
				forkPending={triggerZoltarForkPending}
				onOpenForkWorkflow={showForkWorkflowAction ? onOpenForkWorkflow : undefined}
				questionLedgerAddress={activeReportingDetails?.questionLedgerAddress}
			/>
		)
	const sharedReportSettlementDisabledReason = reportActionDisabledReason !== undefined && reportActionDisabledReason === displayedWithdrawGuardMessage ? reportActionDisabledReason : undefined
	const standaloneReportDisabledReason = reportOutcomeSelectionMessage === undefined && sharedReportSettlementDisabledReason === undefined ? reportActionDisabledReason : undefined
	const localReportDisabledReasonElementId = standaloneReportDisabledReason !== undefined || reportOutcomeSelectionMessage !== undefined ? reportDisabledReasonId : undefined
	const effectiveReportDisabledReasonElementId = sharedReportSettlementDisabledReason !== undefined ? settlementDisabledReasonId : localReportDisabledReasonElementId
	const reportActionButton = (
		<TransactionActionButton
			idleLabel={reportButtonLabel}
			pendingLabel={reportingCopy.reportingAmount(selectedOutcomeLabel, reportDisplayAmount)}
			onClick={onReportOutcome}
			pending={reportingActiveAction === 'reportOutcome'}
			actionButtonRef={reportActionButtonRef}
			availability={reportActionAvailability}
			disabledReasonElementId={effectiveReportDisabledReasonElementId}
			showDisabledReason={false}
		/>
	)
	const depositPreview = (
		<ReportingDepositPreview
			details={effectiveReportingDetails}
			outcome={selectedOutcome}
			outcomeLabel={selectedOutcomeLabel}
			amount={selectedAmount}
			forkConfirmation={{ confirmed: forkConfirmation.confirmed, disabled: reportControlsLocked || reportingActiveAction !== undefined, onChange: forkConfirmation.setConfirmed }}
		/>
	)
	return (
		<>
			{reportingReady !== false && activeReportingDetails?.settlementState === 'resolved' && (
				<ReportingSettlementSection
					actionDataNotice={oldActionData}
					details={activeReportingDetails}
					displayedWithdrawGuardMessage={displayedWithdrawGuardMessage}
					isOnActiveAppChain={isOnActiveAppChain}
					loadingReportingDetails={loadingReportingDetails}
					onWithdrawEscalation={onWithdrawEscalation}
					reportingActiveAction={reportingActiveAction}
					settlementDisabledReasonId={settlementDisabledReasonId}
					settlementWalletBlocker={withdrawControlsLockedReason === undefined ? walletBlocker : undefined}
					sharedReportSettlementDisabledReason={sharedReportSettlementDisabledReason}
					withdrawControlsLocked={withdrawControlsLocked}
					withdrawEscalationEnabled={withdrawEscalationEnabled}
					withdrawGuardMessage={withdrawGuardMessage}
				/>
			)}
			{reportingReady !== false && !finalized && reportingStageKey !== 'forkTriggered' ? (
				<SectionBlock className='reporting-outcome-section' title={reportingCopy.reportAnOutcome} description={oldActionData}>
					{oracleBlocker ??
						(reportActionGuardMessage === undefined ? undefined : (
							<WarningSurface ariaLive='polite' role='status' surface='flat' variant='compact'>
								<p>{reportActionGuardMessage}</p>
								{onOpenPriceOracle === undefined ? undefined : (
									<div className='actions'>
										<button className='secondary' type='button' onClick={onOpenPriceOracle}>
											{reportingCopy.managePoolPrice}
										</button>
									</div>
								)}
							</WarningSurface>
						))}
					<div className='statoblast-report-draft'>
						<div className='statoblast-report-inputs'>
							<ReportingOutcomePicker sides={outcomeSides} details={effectiveReportingDetails} selectedOutcome={selectedOutcome} leadingOutcome={leadingOutcome} disabled={reportControlsLocked} onSelect={outcome => onReportingFormChange({ selectedOutcome: outcome })} />
							<AmountField
								disabled={reportControlsLocked}
								id='reporting-contribution-amount'
								label={reportingCopy.reportAmountFieldLabel}
								fillMax={{ amount: maxContributionAmount.amountAttoRep, unavailableReason: reportControlsLocked ? reportControlsLockedReason : maxContributionAmount.reason, showUnavailableReason: false }}
								onChange={reportAmount => onReportingFormChange({ reportAmount })}
								placeholder={reportingCopy.reportAmountPlaceholder}
								unit={commonCopy.rep}
								value={reportingForm.reportAmount}
							/>

							{maxContributionAmount.stopsBelowFork === true && maxContributionAmount.amountAttoRep !== undefined && !reportTriggersFork ? <UserMessage className='detail' detail={reportingCopy.maxBelowForkHint(<RepAmount rounding='down' value={maxContributionAmount.amountAttoRep} />)} /> : undefined}
							<div className='actions'>
								{outcomePresets.map(({ kind, amount, reason }) => (
									<button
										key={kind}
										className='secondary'
										type='button'
										onClick={() => {
											if (amount !== undefined) onReportingFormChange({ reportAmount: formatCurrencyInputBalance(amount) })
										}}
										disabled={reportControlsLocked || amount === undefined}
										aria-describedby={presetBlocker !== undefined && reason === presetBlocker ? presetBlockerId : undefined}
										title={reportControlsLocked ? reportControlsLockedReason : reason}
									>
										{reportingCopy.minimumPreset(kind, amount === undefined ? undefined : <RepAmount rounding='up' value={amount} />)}
									</button>
								))}
								<button
									className='secondary'
									type='button'
									onClick={() => {
										if (maxProfitContribution.amountAttoRep === undefined) return
										onReportingFormChange({ reportAmount: formatCurrencyInputBalance(maxProfitContribution.amountAttoRep) })
									}}
									disabled={reportControlsLocked || maxProfitContribution.amountAttoRep === undefined}
									aria-describedby={presetBlocker !== undefined && maxProfitContribution.reason === presetBlocker ? presetBlockerId : undefined}
									title={reportControlsLocked ? reportControlsLockedReason : maxProfitContribution.reason}
								>
									{reportingCopy.rewardPreset(maxProfitContribution.amountAttoRep === undefined ? undefined : <RepAmount value={maxProfitContribution.amountAttoRep} />)}
								</button>
							</div>
							{presetBlocker === undefined ? undefined : <UserMessage id={presetBlockerId} className='detail' detail={presetBlocker} />}

							{actualReportDepositAmount === undefined || selectedAmount === undefined || actualReportDepositAmount === selectedAmount ? undefined : (
								<UserMessage
									className='detail'
									detail={
										<>
											{reportingCopy.currentEscalationDisputeStakeLead}
											<CurrencyValue value={actualReportDepositAmount} suffix={commonCopy.rep} />
											{reportingCopy.formatAcceptedAmountTail(reportContributionPreview?.tieAdjusted === true)}
										</>
									}
								/>
							)}
							{visiblePresetReasons.length === 0 ? undefined : <UserMessage className='detail' detail={visiblePresetReasons.join(' ')} />}
							<UserMessage
								className='detail'
								detail={
									<>
										{reportingCopy.paidFromWallet} · {reportingCopy.availableBalance(formatKnownAmount(availableReportingRep))}
									</>
								}
							/>
						</div>
						{depositPreview}
					</div>
					<div className='reporting-shared-action-region'>
						<TokenApprovalControl
							// Both actions share one row under a reserved message slot, so neither moves as the approval changes.
							renderActions={({ button, notice, noticeId }) => (
								<>
									<div className='tx-action-feedback reporting-approval-notice' aria-live='polite' aria-atomic='true'>
										{notice === undefined || (notice === reportingApprovalGuard && effectiveReportDisabledReasonElementId !== undefined) ? undefined : <UserMessage id={noticeId} placement='field' detail={notice} />}
									</div>
									<div className='actions reporting-wallet-actions'>
										{button}
										{reportActionButton}
									</div>
								</>
							)}
							// An allowance that already covers the report keeps the approval in place, disabled as done.
							completedLabel={reportingApprovalSatisfied ? commonCopy.approvalSatisfied : undefined}
							showRequirementNotice={false}
							actionLabel={reportingCopy.reportingApprovalAction}
							allowanceError={undefined}
							allowanceLoading={accountState.address !== undefined && effectiveReportingDetails !== undefined && effectiveReportingDetails.viewerWalletRepAllowanceAttoRep === undefined}
							approvedAmount={effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep}
							disabled={reportControlsLocked}
							guardMessage={reportingApprovalGuard}
							// While a reason blocks both actions, the report's copy of it serves the whole region.
							guardMessageElementId={reportingApprovalGuard === undefined ? undefined : effectiveReportDisabledReasonElementId}
							onApprove={onApproveReportingRep}
							pending={reportingActiveAction === 'approveReportingRep'}
							pendingLabel={commonCopy.approvingRep}
							requiredAmount={walletDepositAmount}
							resetKey={`${effectiveReportingDetails?.questionLedgerAddress ?? ''}:${selectedOutcome ?? ''}`}
							tokenSymbol={commonCopy.rep}
							tokenUnits={18}
						/>
						<WalletActionFixReason actionButtonRef={reportActionButtonRef} availability={reportActionAvailability} id={settlementDisabledReasonId} visible={sharedReportSettlementDisabledReason !== undefined}>
							<UserMessage className='detail disabled-reason' id={settlementDisabledReasonId} loading={loadingReportingDetails} detail={sharedReportSettlementDisabledReason} />
						</WalletActionFixReason>
						<WalletActionFixReason actionButtonRef={reportActionButtonRef} availability={reportActionAvailability} id={reportDisabledReasonId} visible={standaloneReportDisabledReason !== undefined}>
							<UserMessage className='detail disabled-reason' id={reportDisabledReasonId} loading={reportActionAvailability.loading === true} detail={standaloneReportDisabledReason} />
						</WalletActionFixReason>
						{reportOutcomeSelectionMessage === undefined ? undefined : <UserMessage id={reportDisabledReasonId} className='detail disabled-reason' detail={reportOutcomeSelectionMessage} />}
					</div>
				</SectionBlock>
			) : undefined}

			{forkTriggeredActions}

			<RetryableNotice disabled={loadingReportingDetails} message={reportingError} onRetry={onLoadReporting} retryLabel={loadingReportingDetails ? <LoadingText>{reportingCopy.loadingEscalation}</LoadingText> : reportingCopy.retryReporting} />
		</>
	)
}
