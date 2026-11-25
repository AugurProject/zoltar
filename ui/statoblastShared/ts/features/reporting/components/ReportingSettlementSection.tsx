import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { getViewerPositions } from '../lib/reportingViewerStatus.js'
import { renderRepAmount } from './RepAmount.js'
import { formatAmountDisplay, formatCurrencyBalance, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import * as claimsCopy from '../../../copy/reportingClaims.js'
import * as escalationCopy from '../../../copy/reportingEscalation.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WalletActionFixReason } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { useRef, useState } from 'preact/hooks'
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

function ReportingClaimTable({
	actionButtonRef,
	details,
	isOnActiveAppChain,
	loadingReportingDetails,
	onWithdraw,
	settlementActionDisabledReasonId,
	withdrawActionPending,
	withdrawControlsLocked,
	withdrawEscalationEnabled,
	withdrawGuardMessage,
}: Pick<ReportingSettlementSideProps, 'actionButtonRef' | 'isOnActiveAppChain' | 'loadingReportingDetails' | 'onWithdraw' | 'settlementActionDisabledReasonId' | 'withdrawActionPending' | 'withdrawControlsLocked' | 'withdrawEscalationEnabled' | 'withdrawGuardMessage'> & { details: ActiveReportingDetails }) {
	const [unselected, setUnselected] = useState<ReadonlySet<bigint>>(() => new Set())
	const winner = details.sides.find(side => side.key === details.questionOutcome)
	const winning = winner?.userDeposits.map(deposit => ({ deposit, payout: getEscalationDepositClaimAmount(details, winner.key, deposit) })) ?? []
	const losing = details.sides.filter(side => side.key !== details.questionOutcome).flatMap(side => side.deposits.map(deposit => ({ deposit, side })))
	const selected = winning.filter(({ deposit }) => !unselected.has(deposit.depositIndex))
	const selectedAmount = selected.reduce((sum, { payout }) => sum + (payout ?? 0n), 0n)
	const amount = formatValueWithUnit(formatAmountDisplay(selectedAmount), commonCopy.rep)
	const toggleDeposit = (index: bigint, checked: boolean) => {
		setUnselected(previous => {
			const next = new Set(previous)
			if (checked) next.delete(index)
			else next.add(index)
			return next
		})
	}
	const reason = withdrawGuardMessage ?? (selected.length === 0 ? claimsCopy.selectDepositToClaim : undefined)
	if (winning.length === 0 && losing.length === 0) return undefined
	return (
		<>
			<table className='statoblast-claim-table' aria-label={claimsCopy.claimYourRep}>
				<thead>
					<tr>
						<th scope='col'>
							<span className='visually-hidden'>{claimsCopy.selectDeposits}</span>
						</th>
						<th scope='col'>{claimsCopy.deposit}</th>
						<th scope='col'>{claimsCopy.deposited}</th>
						<th scope='col'>{claimsCopy.youReceive}</th>
					</tr>
				</thead>
				<tbody>
					{winner === undefined
						? undefined
						: winning.map(({ deposit, payout }) => (
								<tr key={`${winner.key}:${deposit.depositIndex}`} data-selected={!unselected.has(deposit.depositIndex) || undefined}>
									<td>
										<input type='checkbox' aria-label={claimsCopy.depositCheckboxLabel(deposit.depositIndex, winner.label)} checked={!unselected.has(deposit.depositIndex)} disabled={withdrawControlsLocked || withdrawActionPending} onChange={event => toggleDeposit(deposit.depositIndex, event.currentTarget.checked)} />
									</td>
									<th scope='row'>{claimsCopy.depositLabel(deposit.depositIndex, winner.label)}</th>
									<td>
										<CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
									</td>
									<td className='statoblast-claim-winning-value'>
										<CurrencyValue value={payout} suffix={commonCopy.rep} />
									</td>
								</tr>
							))}
					{losing.map(({ deposit, side }) => (
						<tr key={`${side.key}:${deposit.depositIndex}`}>
							<td />
							<th scope='row'>{claimsCopy.depositLabel(deposit.depositIndex, side.label)}</th>
							<td>
								<CurrencyValue value={deposit.originalAttoRep ?? (deposit.amountAttoRep > 0n ? deposit.amountAttoRep : undefined)} suffix={commonCopy.rep} />
							</td>
							<td>
								<CurrencyValue value={0n} suffix={commonCopy.rep} />
								<small>{claimsCopy.lostNoActionNeeded}</small>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{winner !== undefined && winning.length > 0 && (
				<div className='actions statoblast-claim-actions'>
					<TransactionActionButton
						actionButtonRef={actionButtonRef}
						idleLabel={claimsCopy.claimRep(amount)}
						pendingLabel={claimsCopy.claimingRep(amount)}
						onClick={() =>
							onWithdraw(
								winner.key,
								selected.map(({ deposit }) => deposit.depositIndex),
							)
						}
						availability={{ disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || reason !== undefined, loading: loadingReportingDetails, reason }}
						pending={withdrawActionPending}
						disabledReasonElementId={withdrawGuardMessage === undefined ? undefined : settlementActionDisabledReasonId}
						showDisabledReason={withdrawGuardMessage === undefined}
					/>
				</div>
			)}
		</>
	)
}

export function ReportingSettlementSection({
	actionDataNotice,
	showPositions = true,
	designedOverview = false,
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
	actionDataNotice?: string | undefined
	showPositions?: boolean
	designedOverview?: boolean
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
					: getViewerPositions(activeReportingDetails, renderRepAmount).map(position => (
							<p key={position.side.key} className='reporting-position escalation-side-value'>
								<span>
									{position.side.label} · {position.positionStatus}
								</span>
								<CurrencyValue value={position.stake} suffix={commonCopy.rep} />
							</p>
						))}
			</SectionBlock>
		)
	const designedClaimDetails = designedOverview && activeReportingDetails?.settlementState === 'resolved' ? activeReportingDetails : undefined
	const hasLocalClaimRecords = designedClaimDetails?.sides.some(side => (side.key === designedClaimDetails.questionOutcome ? side.userDeposits : side.deposits).length > 0) ?? withdrawableSides.length > 0
	const shouldShowWithdrawEmptyState = !loadingReportingDetails && !reportingStatusMissing && !hasLocalClaimRecords
	const hasImportedForkedDeposits = activeReportingDetails?.sides.some(side => side.importedUserDeposits.length > 0) ?? false
	const migrationSettlement = activeReportingDetails?.settlementState === 'migration-required'
	const hasSettlementAction = designedClaimDetails === undefined ? withdrawableSides.length > 0 && !migrationSettlement : designedClaimDetails.sides.some(side => side.key === designedClaimDetails.questionOutcome && side.userDeposits.length > 0)
	return (
		<SectionBlock className='reporting-settlement-section' title={designedClaimDetails === undefined ? transactionCopy.settleEscalationDeposits : claimsCopy.claimYourRep} description={hasSettlementAction ? actionDataNotice : undefined} variant={designedClaimDetails === undefined ? 'embedded' : 'default'}>
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
			{!migrationSettlement && designedClaimDetails !== undefined && (
				<ReportingClaimTable
					key={`${designedClaimDetails.escalationGameAddress}:${designedClaimDetails.universeId}:${designedClaimDetails.questionOutcome}:${designedClaimDetails.sides.find(side => side.key === designedClaimDetails.questionOutcome)?.userDeposits[0]?.depositor ?? ''}`}
					actionButtonRef={firstSettleActionButtonRef}
					details={designedClaimDetails}
					isOnActiveAppChain={isOnActiveAppChain}
					loadingReportingDetails={loadingReportingDetails}
					onWithdraw={onWithdrawEscalation}
					settlementActionDisabledReasonId={settlementActionDisabledReasonId}
					withdrawActionPending={withdrawActionPending}
					withdrawControlsLocked={withdrawControlsLocked}
					withdrawEscalationEnabled={withdrawEscalationEnabled}
					withdrawGuardMessage={withdrawGuardMessage}
				/>
			)}
			{!migrationSettlement &&
				designedClaimDetails === undefined &&
				withdrawableSides.map((side, index) => (
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
