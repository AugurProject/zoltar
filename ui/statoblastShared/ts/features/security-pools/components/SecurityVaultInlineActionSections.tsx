import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import type { ComponentChildren } from 'preact'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { SecurityVaultDetails } from '../../../types/contracts.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { VaultRepExitMode } from '../lib/securityVaultAvailability.js'
import { RepPriceStatusLabel } from './RepPriceStatusLabel.js'

type SecurityVaultInlineActionSectionsProps = {
	adjustmentForm: ComponentChildren
	canClaimFees: boolean
	claimingFees: boolean
	currentSelectedVaultDetails: SecurityVaultDetails | undefined
	depositAmountField: ComponentChildren
	depositApprovalControl: ComponentChildren
	depositRepActionLabel: string
	onRedeemFees: () => void
	oraclePriceValidUntilTimestamp: bigint | undefined
	repExitActionButton: ComponentChildren
	repExitActionLabel: string
	/** Redeemable REP when redeeming, otherwise the most REP that can be withdrawn. */
	repExitAmount: bigint | undefined
	repExitAmountLabel: string
	/** The amount, timeout, and oracle price fields the REP exit needs. */
	repExitFields: ComponentChildren
	repExitMode: VaultRepExitMode
	repTokenSymbol: string
	securityVaultError: string | undefined
	/** Marks the withdrawable amount as an estimate from the UI price rather than the oracle price. */
	showRepPriceEstimate: boolean
	walletRepBalanceError: string | undefined
}

/** The vault page's inline actions, one section each, used when actions are not launched in dialogs. */
export function SecurityVaultInlineActionSections({
	adjustmentForm,
	canClaimFees,
	claimingFees,
	currentSelectedVaultDetails,
	depositAmountField,
	depositApprovalControl,
	depositRepActionLabel,
	onRedeemFees,
	oraclePriceValidUntilTimestamp,
	repExitActionButton,
	repExitActionLabel,
	repExitAmount,
	repExitAmountLabel,
	repExitFields,
	repExitMode,
	repTokenSymbol,
	securityVaultError,
	showRepPriceEstimate,
	walletRepBalanceError,
}: SecurityVaultInlineActionSectionsProps) {
	const disputeStakedAttoRep = currentSelectedVaultDetails?.disputeStakedAttoRep
	return (
		<>
			<SectionBlock title={securityPoolCopy.setVaultUnderwritingLimit} variant='embedded'>
				{adjustmentForm}
			</SectionBlock>
			<SectionBlock title={securityPoolCopy.claimFeesTitle} variant='embedded'>
				{currentSelectedVaultDetails === undefined ? (
					<UserMessage className='detail' detail={securityPoolCopy.selectedVaultDetailsUnavailable} />
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={securityPoolCopy.claimableFees}>
							<CurrencyValue exactWhenRoundedToZero value={currentSelectedVaultDetails.claimableFeesAttoEth} suffix={commonCopy.eth} />
						</MetricField>
					</div>
				)}
				<div className='actions'>
					<TransactionActionButton idleLabel={securityPoolCopy.claimFees} pendingLabel={securityPoolCopy.claimingFees} onClick={onRedeemFees} pending={claimingFees} availability={{ disabled: !canClaimFees, reason: undefined }} />
				</div>
			</SectionBlock>

			<SectionBlock title={depositRepActionLabel} variant='embedded'>
				{depositAmountField}
				{depositApprovalControl}
			</SectionBlock>

			<SectionBlock title={repExitActionLabel} variant='embedded'>
				{repExitAmount === undefined ? (
					<UserMessage className='detail' detail={securityPoolCopy.selectedVaultDetailsUnavailable} />
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={repExitAmountLabel}>
							<CurrencyValue value={repExitAmount} suffix={repTokenSymbol} />
							{showRepPriceEstimate ? <RepPriceStatusLabel /> : undefined}
						</MetricField>
						{repExitMode === 'redeem' ? (
							<MetricField className='entity-metric' label={commonCopy.disputeStakedAttoRep}>
								<CurrencyValue value={disputeStakedAttoRep} suffix={repTokenSymbol} />
							</MetricField>
						) : undefined}
						{repExitMode === 'withdraw' && oraclePriceValidUntilTimestamp !== undefined ? (
							<MetricField className='entity-metric' label={securityPoolCopy.priceValidUntil}>
								<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
							</MetricField>
						) : undefined}
					</div>
				)}
				{repExitFields}
				<div className='actions'>{repExitActionButton}</div>
				{repExitMode === 'redeem' && disputeStakedAttoRep !== undefined && disputeStakedAttoRep > 0n ? <UserMessage className='detail' detail={securityPoolCopy.escalationWithdrawalRequiredDetail} /> : undefined}
			</SectionBlock>

			<ErrorNotice message={securityVaultError} />
			<ErrorNotice message={walletRepBalanceError} />
		</>
	)
}
