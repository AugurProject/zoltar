import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { formatAmountDisplay, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import * as claimsCopy from '../../../copy/reportingClaims.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WalletActionFixReason } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { getEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import type { ReportingSectionProps } from '../../oracleTypes.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ActiveReportingDetails } from '../../../types/contracts.js'
import type { WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'

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
}: {
	actionButtonRef: RefObject<HTMLButtonElement>
	details: ActiveReportingDetails
	isOnActiveAppChain: boolean
	loadingReportingDetails: boolean
	onWithdraw: (outcome: ReportingOutcomeKey, depositIndexes: bigint[]) => void
	settlementActionDisabledReasonId: string
	withdrawActionPending: boolean
	withdrawControlsLocked: boolean
	withdrawEscalationEnabled: boolean
	withdrawGuardMessage: string | undefined
}) {
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
	details,
	displayedWithdrawGuardMessage,
	isOnActiveAppChain,
	loadingReportingDetails,
	onWithdrawEscalation,
	reportingActiveAction,
	settlementDisabledReasonId,
	settlementWalletBlocker,
	sharedReportSettlementDisabledReason,
	withdrawControlsLocked,
	withdrawEscalationEnabled,
	withdrawGuardMessage,
}: {
	actionDataNotice?: string | undefined
	details: ActiveReportingDetails
	displayedWithdrawGuardMessage: string | undefined
	isOnActiveAppChain: boolean
	loadingReportingDetails: boolean
	onWithdrawEscalation: ReportingSectionProps['onWithdrawEscalation']
	reportingActiveAction: ReportingSectionProps['reportingActiveAction']
	settlementDisabledReasonId: string
	settlementWalletBlocker: WalletActionBlocker | undefined
	sharedReportSettlementDisabledReason: string | undefined
	withdrawControlsLocked: boolean
	withdrawEscalationEnabled: boolean
	withdrawGuardMessage: string | undefined
}) {
	const firstClaimActionButtonRef = useRef<HTMLButtonElement>(null)
	const winner = details.sides.find(side => side.key === details.questionOutcome)
	const hasLocalClaimRecords = details.sides.some(side => (side === winner ? side.userDeposits : side.deposits).length > 0)
	const hasImportedForkedDeposits = details.sides.some(side => side.importedUserDeposits.length > 0)
	const hasClaimAction = (winner?.userDeposits.length ?? 0) > 0
	return (
		<SectionBlock className='reporting-settlement-section' title={claimsCopy.claimYourRep} description={hasClaimAction ? actionDataNotice : undefined}>
			<WalletActionFixReason
				actionButtonRef={firstClaimActionButtonRef}
				availability={{ disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawGuardMessage !== undefined, reason: displayedWithdrawGuardMessage, walletBlocker: settlementWalletBlocker }}
				id={settlementDisabledReasonId}
				visible={hasClaimAction && displayedWithdrawGuardMessage !== undefined && displayedWithdrawGuardMessage !== sharedReportSettlementDisabledReason}
			>
				<UserMessage className='detail' id={settlementDisabledReasonId} loading={loadingReportingDetails} detail={displayedWithdrawGuardMessage} />
			</WalletActionFixReason>
			{hasImportedForkedDeposits ? <UserMessage className='detail' detail={<>{reportingCopy.forkCarriedSettlementRedirectDetail}</>} /> : undefined}
			{!loadingReportingDetails && !hasLocalClaimRecords ? <UserMessage className='detail' detail={<>{reportingCopy.walletUnsettledDepositsEmpty}</>} /> : undefined}
			<ReportingClaimTable
				key={`${details.escalationGameAddress}:${details.universeId}:${details.questionOutcome}:${winner?.userDeposits[0]?.depositor ?? ''}`}
				actionButtonRef={firstClaimActionButtonRef}
				details={details}
				isOnActiveAppChain={isOnActiveAppChain}
				loadingReportingDetails={loadingReportingDetails}
				onWithdraw={onWithdrawEscalation}
				settlementActionDisabledReasonId={settlementDisabledReasonId}
				withdrawActionPending={reportingActiveAction === 'withdrawEscalation'}
				withdrawControlsLocked={withdrawControlsLocked}
				withdrawEscalationEnabled={withdrawEscalationEnabled}
				withdrawGuardMessage={withdrawGuardMessage}
			/>
		</SectionBlock>
	)
}
