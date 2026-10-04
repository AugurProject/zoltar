import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { getViewerPositions } from '../lib/reportingViewerStatus.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import * as escalationCopy from '../../../copy/reportingEscalation.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WalletActionFixReason } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { useRef } from 'preact/hooks'
import type { RefObject } from 'preact'
import { getEscalationDepositClaimAmount, isPoolQuestionFinalized } from '../lib/reportingDomain.js'
import type { ReportingSectionProps } from '../../oracleTypes.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ActiveReportingDetails, EscalationSide, ReportingDetails } from '../../../types/contracts.js'
import type { WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'

function getWithdrawDepositClaimLabel(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey) {
	if (details === undefined || details.status !== 'active') return undefined
	if (!isPoolQuestionFinalized(details)) return undefined
	return details.questionOutcome === selectedOutcome ? reportingCopy.winningPayout : reportingCopy.losingDepositSettlement
}

type ReportingSettlementSideProps = {
	/** Set on the first side's settle-all action, which regains focus after the shared wallet fix unblocks it. */
	actionButtonRef: RefObject<HTMLButtonElement> | undefined
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
	actionButtonRef,
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
									{escalationCopy.initiallyDepositedLead}
									<CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
								</>,
								claimAmount === undefined ? (
									reportingCopy.worthAfterFinalizationPendingFinalization
								) : (
									<>
										{escalationCopy.worthNowLead}
										<CurrencyValue value={claimAmount} suffix={commonCopy.rep} />
									</>
								),
							],
							secondaryDetails: [
								`${reportingCopy.currentClaimType} ${claimLabel ?? reportingCopy.pendingFinalization}`,
								<>
									{escalationCopy.entryDepthLead}
									<CurrencyValue value={deposit.cumulativeAmountAttoRep} suffix={commonCopy.rep} />
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
					actionButtonRef={actionButtonRef}
					onClick={() => onWithdraw(side.key, allWithdrawDepositIndexes)}
					pending={isPendingSide}
					disabled={otherSidePending}
					disabledReasonElementId={withdrawAllUsesSharedReason ? settlementActionDisabledReasonId : undefined}
					tone={winning ? 'primary' : 'secondary'}
					availability={{ disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawGuardMessage !== undefined, loading: loadingReportingDetails, reason: withdrawGuardMessage }}
					showDisabledReason={!withdrawAllUsesSharedReason}
				/>
			</div>
			{winning || claimLabel === undefined ? undefined : <UserMessage className='detail' detail={reportingCopy.clearLosingDepositsDetail} />}
		</SectionBlock>
	)
}

export function ReportingSettlementSection({
	showPositions = true,
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
	settlementWalletBlocker,
	sharedReportSettlementDisabledReason,
	withdrawControlsLocked,
	withdrawEscalationEnabled,
	withdrawGuardMessage,
}: {
	showPositions?: boolean
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
	/** The wallet prerequisite, when it is the first reason settlement is blocked. */
	settlementWalletBlocker: WalletActionBlocker | undefined
	sharedReportSettlementDisabledReason: string | undefined
	withdrawControlsLocked: boolean
	withdrawEscalationEnabled: boolean
	withdrawGuardMessage: string | undefined
}) {
	const withdrawActionPending = reportingActiveAction === 'withdrawEscalation'
	const firstSettleActionButtonRef = useRef<HTMLButtonElement>(null)
	const withdrawableSides = (activeReportingDetails?.sides.filter(side => side.userDeposits.length > 0) ?? []).sort((left, right) => Number(right.key === effectiveReportingDetails?.questionOutcome) - Number(left.key === effectiveReportingDetails?.questionOutcome))
	if (!isPoolQuestionFinalized(effectiveReportingDetails) && !activeReportingDetails?.sides.some(side => side.userDeposits.length > 0 || side.importedUserDeposits.length > 0)) return undefined
	if (!isPoolQuestionFinalized(effectiveReportingDetails) && !showPositions)
		return (
			<>
				{settlementContextMessage === undefined ? undefined : <UserMessage className='detail' detail={<>{settlementContextMessage}</>} />}
				{activeReportingDetails?.hasReachedNonDecision && displayedWithdrawGuardMessage !== sharedReportSettlementDisabledReason ? <UserMessage className='detail' detail={<>{displayedWithdrawGuardMessage}</>} /> : undefined}
			</>
		)
	if (!isPoolQuestionFinalized(effectiveReportingDetails))
		return (
			<SectionBlock className='reporting-settlement-section' title={reportingCopy.yourPositions} variant='embedded'>
				{settlementContextMessage === undefined ? undefined : <UserMessage className='detail' detail={<>{settlementContextMessage}</>} />}
				{activeReportingDetails?.hasReachedNonDecision && displayedWithdrawGuardMessage !== sharedReportSettlementDisabledReason ? <UserMessage className='detail' detail={<>{displayedWithdrawGuardMessage}</>} /> : undefined}

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
		<SectionBlock className='reporting-settlement-section' title={transactionCopy.settleEscalationDeposits} variant='embedded'>
			<WalletActionFixReason
				actionButtonRef={firstSettleActionButtonRef}
				availability={{ disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawGuardMessage !== undefined, reason: displayedWithdrawGuardMessage, walletBlocker: settlementWalletBlocker }}
				id={settlementDisabledReasonId}
				visible={displayedWithdrawGuardMessage !== undefined && displayedWithdrawGuardMessage !== sharedReportSettlementDisabledReason}
			>
				<UserMessage className='detail' id={settlementDisabledReasonId} loading={loadingReportingDetails} detail={displayedWithdrawGuardMessage} />
			</WalletActionFixReason>
			{settlementContextMessage === undefined || settlementContextMessage === withdrawGuardMessage ? undefined : <UserMessage className='detail' detail={<>{settlementContextMessage}</>} />}
			{hasImportedForkedDeposits ? <UserMessage className='detail' detail={<>{reportingCopy.forkCarriedSettlementRedirectDetail}</>} /> : undefined}
			{shouldShowWithdrawEmptyState && !migrationSettlement ? <UserMessage className='detail' detail={<>{reportingCopy.walletUnsettledDepositsEmpty}</>} /> : undefined}
			{migrationSettlement
				? undefined
				: withdrawableSides.map((side, index) => (
						<ReportingSettlementSide
							key={side.key}
							actionButtonRef={index === 0 ? firstSettleActionButtonRef : undefined}
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
