import { getViewerPositions } from '../lib/reportingViewerStatus.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { LoadingAwareText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { getEscalationDepositClaimAmount, isPoolQuestionFinalized } from '../lib/reportingDomain.js'
import type { ReportingSectionProps } from '../../oracleTypes.js'
import type { ActiveReportingDetails, EscalationSide, ReportingDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

function getWithdrawDepositClaimLabel(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey) {
	if (details === undefined || details.status !== 'active') return undefined
	if (!isPoolQuestionFinalized(details)) return undefined
	return details.questionOutcome === selectedOutcome ? reportingCopy.winningPayout : reportingCopy.losingDepositSettlement
}

type ReportingSettlementSideProps = {
	effectiveReportingDetails: ReportingDetails | undefined
	isOnActiveAppChain: boolean
	isPendingSide: boolean
	loadingReportingDetails: boolean
	onReportingFormChange: ReportingSectionProps['onReportingFormChange']
	onWithdraw: (outcome: ReportingOutcomeKey, depositIndexes: bigint[]) => void
	otherSidePending: boolean
	selectedWithdrawDepositIndexesByOutcome: ReportingSectionProps['reportingForm']['selectedWithdrawDepositIndexesByOutcome']
	settlementActionDisabledReasonId: string
	side: EscalationSide
	withdrawActionPending: boolean
	withdrawControlsLocked: boolean
	withdrawEscalationEnabled: boolean
	withdrawGuardMessage: string | undefined
}

function ReportingSettlementSide({
	effectiveReportingDetails,
	isOnActiveAppChain,
	isPendingSide,
	loadingReportingDetails,
	onReportingFormChange,
	onWithdraw,
	otherSidePending,
	selectedWithdrawDepositIndexesByOutcome,
	settlementActionDisabledReasonId,
	side,
	withdrawActionPending,
	withdrawControlsLocked,
	withdrawEscalationEnabled,
	withdrawGuardMessage,
}: ReportingSettlementSideProps) {
	const claimAmount = side.userDeposits.reduce((sum, deposit) => sum + (getEscalationDepositClaimAmount(effectiveReportingDetails, side.key, deposit) ?? 0n), 0n)
	const winning = effectiveReportingDetails?.questionOutcome === side.key
	const selectedWithdrawDepositIndexes = selectedWithdrawDepositIndexesByOutcome[side.key]
	const allWithdrawDepositIndexes = side.userDeposits.map(deposit => deposit.depositIndex)
	const claimLabel = getWithdrawDepositClaimLabel(effectiveReportingDetails, side.key)
	const withdrawSelectedGuardMessage = withdrawGuardMessage ?? (!withdrawEscalationEnabled || selectedWithdrawDepositIndexes.length > 0 ? undefined : reportingCopy.settlementSelectionRequired)
	const withdrawSelectedUsesSharedReason = withdrawGuardMessage !== undefined && withdrawSelectedGuardMessage === withdrawGuardMessage
	const withdrawAllUsesSharedReason = withdrawGuardMessage !== undefined

	return (
		<SectionBlock density='compact' headingLevel={4} title={side.label} variant='embedded'>
			<div className='field'>
				{side.userDeposits.length > 1 ? <span>{reportingCopy.chooseDepositsToSettle}</span> : undefined}
				<EscalationDepositSelectionList
					selectable={side.userDeposits.length > 1}
					disabled={withdrawControlsLocked || withdrawActionPending}
					items={side.userDeposits.map(deposit => {
						const claimAmount = getEscalationDepositClaimAmount(effectiveReportingDetails, side.key, deposit)
						return {
							deposit,
							details: [
								<>
									{reportingCopy.initiallyDeposited} <CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
								</>,
								claimAmount === undefined ? (
									reportingCopy.worthAfterFinalizationPendingFinalization
								) : (
									<>
										{reportingCopy.worthNow} <CurrencyValue value={claimAmount} suffix={commonCopy.rep} />
									</>
								),
							],
							secondaryDetails: [
								`${reportingCopy.currentClaimType} ${claimLabel ?? reportingCopy.pendingFinalization}`,
								<>
									{reportingCopy.entryDepth} <CurrencyValue value={deposit.cumulativeAmountAttoRep} suffix={commonCopy.rep} />
								</>,
							],
						}
					})}
					onSelectionChange={nextSelectedWithdrawDepositIndexes =>
						onReportingFormChange({
							selectedWithdrawDepositIndexesByOutcome: {
								...selectedWithdrawDepositIndexesByOutcome,
								[side.key]: nextSelectedWithdrawDepositIndexes,
							},
						})
					}
					selectedDepositIndexes={selectedWithdrawDepositIndexes}
				/>
			</div>

			<div className='actions'>
				{side.userDeposits.length > 1 ? (
					<TransactionActionButton
						idleLabel={commonCopy.launchAction(reportingCopy.formatSettleSelectedDepositsLabel(side.label))}
						pendingLabel={reportingCopy.formatSettlingDepositsPendingLabel(side.label)}
						onClick={() => onWithdraw(side.key, selectedWithdrawDepositIndexes)}
						pending={isPendingSide}
						disabled={otherSidePending}
						disabledReasonElementId={withdrawSelectedUsesSharedReason ? settlementActionDisabledReasonId : undefined}
						tone='secondary'
						availability={{ disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawSelectedGuardMessage !== undefined, loading: loadingReportingDetails, reason: withdrawSelectedGuardMessage }}
						showDisabledReason={!withdrawSelectedUsesSharedReason}
					/>
				) : undefined}
				<TransactionActionButton
					idleLabel={commonCopy.launchAction(winning ? reportingCopy.claimDeposits(side.label, formatCurrencyBalance(claimAmount)) : reportingCopy.clearDeposits(side.label))}
					pendingLabel={winning ? reportingCopy.claimingDeposits(side.label, formatCurrencyBalance(claimAmount)) : reportingCopy.clearingDeposits(side.label)}
					onClick={() => onWithdraw(side.key, allWithdrawDepositIndexes)}
					pending={isPendingSide}
					disabled={otherSidePending}
					disabledReasonElementId={withdrawAllUsesSharedReason ? settlementActionDisabledReasonId : undefined}
					tone={winning ? 'primary' : 'secondary'}
					availability={{ disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawGuardMessage !== undefined, loading: loadingReportingDetails, reason: withdrawGuardMessage }}
					showDisabledReason={!withdrawAllUsesSharedReason}
				/>
			</div>
		</SectionBlock>
	)
}

export function ReportingSettlementSection({
	activeReportingDetails,
	displayedWithdrawGuardMessage,
	effectiveReportingDetails,
	isOnActiveAppChain,
	loadingReportingDetails,
	onReportingFormChange,
	onWithdrawEscalation,
	pendingWithdrawOutcome,
	reportingActiveAction,
	reportingStatusMissing,
	selectedWithdrawDepositIndexesByOutcome,
	settlementActionDisabledReasonId,
	settlementContextMessage,
	settlementDisabledReasonId,
	sharedReportSettlementDisabledReason,
	withdrawControlsLocked,
	withdrawEscalationEnabled,
	withdrawGuardMessage,
}: {
	activeReportingDetails: ActiveReportingDetails | undefined
	displayedWithdrawGuardMessage: string | undefined
	effectiveReportingDetails: ReportingDetails | undefined
	isOnActiveAppChain: boolean
	loadingReportingDetails: boolean
	onReportingFormChange: ReportingSectionProps['onReportingFormChange']
	onWithdrawEscalation: ReportingSectionProps['onWithdrawEscalation']
	/** The side whose settlement is in flight; owned by the parent so it survives this section unmounting. */
	pendingWithdrawOutcome: ReportingOutcomeKey | undefined
	reportingActiveAction: ReportingSectionProps['reportingActiveAction']
	reportingStatusMissing: boolean
	selectedWithdrawDepositIndexesByOutcome: ReportingSectionProps['reportingForm']['selectedWithdrawDepositIndexesByOutcome']
	settlementActionDisabledReasonId: string
	settlementContextMessage: string | undefined
	settlementDisabledReasonId: string
	sharedReportSettlementDisabledReason: string | undefined
	withdrawControlsLocked: boolean
	withdrawEscalationEnabled: boolean
	withdrawGuardMessage: string | undefined
}) {
	const withdrawActionPending = reportingActiveAction === 'withdrawEscalation'
	const withdrawableSides = (activeReportingDetails?.sides.filter(side => side.userDeposits.length > 0) ?? []).sort((left, right) => Number(right.key === effectiveReportingDetails?.questionOutcome) - Number(left.key === effectiveReportingDetails?.questionOutcome))
	if (!isPoolQuestionFinalized(effectiveReportingDetails) && !activeReportingDetails?.sides.some(side => side.userDeposits.length > 0 || side.importedUserDeposits.length > 0)) return undefined
	if (!isPoolQuestionFinalized(effectiveReportingDetails))
		return (
			<SectionBlock className='reporting-settlement-section' title={reportingCopy.yourPositions} variant='embedded'>
				{settlementContextMessage === undefined ? undefined : <p className='detail'>{settlementContextMessage}</p>}
				{activeReportingDetails?.hasReachedNonDecision && displayedWithdrawGuardMessage !== sharedReportSettlementDisabledReason ? <p className='detail'>{displayedWithdrawGuardMessage}</p> : undefined}

				{activeReportingDetails === undefined
					? undefined
					: getViewerPositions(activeReportingDetails).map(position => (
							<p key={position.side.key} className='reporting-position escalation-side-value'>
								<span>
									{position.side.label} · {position.positionStatus}
								</span>
								<CurrencyValue value={position.stake} suffix={commonCopy.rep} />
							</p>
						))}
			</SectionBlock>
		)
	const shouldShowWithdrawEmptyState = !loadingReportingDetails && !reportingStatusMissing && withdrawableSides.length === 0
	const hasImportedForkedDeposits = activeReportingDetails?.sides.some(side => side.importedUserDeposits.length > 0) ?? false
	const migrationSettlement = activeReportingDetails?.settlementState === 'migration-required' || activeReportingDetails?.settlementState === 'migration-expired'
	return (
		<SectionBlock className='reporting-settlement-section' title={reportingCopy.settleEscalationDeposits} variant='embedded'>
			{displayedWithdrawGuardMessage === undefined || displayedWithdrawGuardMessage === sharedReportSettlementDisabledReason ? undefined : (
				<p className='detail' id={settlementDisabledReasonId}>
					<LoadingAwareText loading={loadingReportingDetails}>{displayedWithdrawGuardMessage}</LoadingAwareText>
				</p>
			)}
			{settlementContextMessage === undefined || settlementContextMessage === withdrawGuardMessage ? undefined : <p className='detail'>{settlementContextMessage}</p>}
			{hasImportedForkedDeposits ? <p className='detail'>{reportingCopy.forkCarriedSettlementRedirectDetail}</p> : undefined}
			{shouldShowWithdrawEmptyState && !migrationSettlement ? <p className='detail'>{reportingCopy.walletUnsettledDepositsEmpty}</p> : undefined}
			{migrationSettlement
				? undefined
				: withdrawableSides.map(side => (
						<ReportingSettlementSide
							key={side.key}
							effectiveReportingDetails={effectiveReportingDetails}
							isOnActiveAppChain={isOnActiveAppChain}
							isPendingSide={withdrawActionPending && pendingWithdrawOutcome === side.key}
							loadingReportingDetails={loadingReportingDetails}
							onReportingFormChange={onReportingFormChange}
							onWithdraw={onWithdrawEscalation}
							otherSidePending={withdrawActionPending && pendingWithdrawOutcome !== side.key}
							selectedWithdrawDepositIndexesByOutcome={selectedWithdrawDepositIndexesByOutcome}
							settlementActionDisabledReasonId={settlementActionDisabledReasonId}
							side={side}
							withdrawActionPending={withdrawActionPending}
							withdrawControlsLocked={withdrawControlsLocked}
							withdrawEscalationEnabled={withdrawEscalationEnabled}
							withdrawGuardMessage={withdrawGuardMessage}
						/>
					))}
		</SectionBlock>
	)
}
