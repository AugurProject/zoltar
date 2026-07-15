import { useEffect, useRef, useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { Badge } from './Badge.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { RequirementsChecklist } from './RequirementsChecklist.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { WarningSurface } from './WarningSurface.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { formatCurrencyBalance, formatCurrencyInputBalance, formatDuration } from '../lib/formatters.js'
import { balanceShortage } from '../lib/inputs.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import { tryParseBigIntInput, tryParseRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { resolveOracleOperationEthFunding } from '../lib/oracleRequestEth.js'
import { getWalletMainnetGuardState } from '../lib/actionGuards.js'
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import {
	UI_STRING_A_VALID_ORACLE_PRICE_IS_AVAILABLE,
	UI_STRING_A_VALID_ORACLE_PRICE_WAS_ALREADY_AVAILABLE_SO_THE_NEW_BOND_ALLOWANCE_EXECUTED_IMMEDIATELY_AND_NO_STAGED_OPERATION_WAS_CREATED,
	UI_STRING_A_VALID_ORACLE_PRICE_WAS_ALREADY_AVAILABLE_SO_THE_WITHDRAWAL_EXECUTED_IMMEDIATELY_AND_NO_STAGED_OPERATION_WAS_CREATED,
	UI_STRING_ADD_REP_TO_THE_SELECTED_VAULT,
	UI_STRING_AMOUNT,
	UI_STRING_APPROVING_REP,
	UI_STRING_BOND_ALLOWANCE_EXECUTED,
	UI_STRING_BOND_ALLOWANCE_FAILED,
	UI_STRING_BOND_ALLOWANCE_QUEUED,
	UI_STRING_BOND_ALLOWANCE_SUBMITTED,
	UI_STRING_CANCEL,
	UI_STRING_CLAIM_FEES,
	UI_STRING_CLAIMABLE_FEES,
	UI_STRING_CLAIMABLE_FEES_ARE_AVAILABLE,
	UI_STRING_CLAIMING_FEES,
	UI_STRING_CONFIRM_THE_CLAIMABLE_FEE_BALANCE_BEFORE_SUBMITTING_THE_FEE_REDEMPTION_FOR_THIS_VAULT,
	UI_STRING_CURRENT_BOND_ALLOWANCE,
	UI_STRING_CURRENT_SECURITY_BOND_ALLOWANCE,
	UI_STRING_DEPOSIT_REP,
	UI_STRING_DEPOSITING_REP,
	UI_STRING_DEPOSITING_REP_SECURITY_VAULT_SECTION_DEPOSIT_REP_PENDING_LABEL,
	UI_STRING_ENTER_WHOLE_MINUTES_QUEUED_SELF_SERVICE_OPERATIONS_MUST_STAY_EXECUTABLE_FOR_AT_LEAST_1_MINUTE_AFTER_THE_ORACLE_SETTLEMENT_WINDOW_COMPLETES,
	UI_STRING_ESCROWED_REP,
	UI_STRING_ETH,
	UI_STRING_EXECUTED,
	UI_STRING_FAILED,
	UI_STRING_FIRST_DEPOSIT_MEETS_THE_VAULT_MINIMUM,
	UI_STRING_HEX_VALUE_PLACEHOLDER,
	UI_STRING_IN_THE_FIRST_DEPOSIT,
	UI_STRING_LOADING_VAULT,
	UI_STRING_MANUAL_EXECUTION_TIMEOUT,
	UI_STRING_MANUAL_EXECUTION_TIMEOUT_IS_AT_LEAST_1_MINUTE,
	UI_STRING_MANUAL_QUEUED_OPERATION,
	UI_STRING_MAX,
	UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER,
	UI_STRING_MINUTES,
	UI_STRING_NEW_VAULTS_REQUIRE_AT_LEAST,
	UI_STRING_NO_REP_REMAINS_LOCKED_IN_THE_ESCALATION_GAME,
	UI_STRING_NONE_SELECTED,
	UI_STRING_NOT_FOUND,
	UI_STRING_ORACLE_EXECUTION_CAN_BE_FUNDED_UNTIL_A_FRESH_PRICE_ARRIVES,
	UI_STRING_OWNED,
	UI_STRING_PRICE_VALID_UNTIL,
	UI_STRING_QUEUE_A_NEW_BOND_ALLOWANCE_USING_THE_LATEST_VALID_ORACLE_PRICE_FOR_THE_SELECTED_VAULT,
	UI_STRING_QUEUE_A_NEW_SECURITY_BOND_ALLOWANCE_USING_THE_CURRENT_ORACLE_PRICE_CONTEXT,
	UI_STRING_QUEUE_A_REP_WITHDRAWAL_AFTER_REVIEWING_THE_CURRENT_VAULT_COLLATERAL_AND_ORACLE_STATUS,
	UI_STRING_QUEUE_A_REP_WITHDRAWAL_NOW_OR_LET_IT_EXECUTE_IMMEDIATELY_WHEN_A_VALID_ORACLE_PRICE_IS_ALREADY_AVAILABLE,
	UI_STRING_QUEUEING_ALLOWANCE_UPDATE,
	UI_STRING_QUEUEING_REP_WITHDRAWAL,
	UI_STRING_READ_ONLY_SECURITY_VAULT_SECTION_READ_ONLY_BADGE_LABEL,
	UI_STRING_REDEEM_REP,
	UI_STRING_REDEEM_THE_REMAINING_REP_COLLATERAL_FROM_THIS_ENDED_POOL_AFTER_ESCALATION_DEPOSITS_ARE_SETTLED,
	UI_STRING_REDEEMABLE_REP,
	UI_STRING_REDEEMING_REP,
	UI_STRING_REFRESH,
	UI_STRING_REFRESHING,
	UI_STRING_REFRESHING_BOND_ALLOWANCE_STATE,
	UI_STRING_REFRESHING_THE_ORACLE_MANAGER_TO_DETERMINE_WHETHER_THE_BOND_ALLOWANCE_WAS_QUEUED_OR_EXECUTED_IMMEDIATELY,
	UI_STRING_REFRESHING_THE_ORACLE_MANAGER_TO_DETERMINE_WHETHER_THE_WITHDRAWAL_WAS_QUEUED_OR_EXECUTED_IMMEDIATELY,
	UI_STRING_REFRESHING_WITHDRAWAL_STATE,
	UI_STRING_REFRESHING_WITHOUT_ELLIPSIS,
	UI_STRING_REP,
	UI_STRING_REP_AVAILABLE_TO_QUEUE,
	UI_STRING_REP_COLLATERAL,
	UI_STRING_REP_COLLATERAL_AMOUNT,
	UI_STRING_REP_WITHDRAW_AMOUNT,
	UI_STRING_REP_WITHDRAWAL_EXECUTED,
	UI_STRING_REP_WITHDRAWAL_FAILED,
	UI_STRING_REP_WITHDRAWAL_QUEUED,
	UI_STRING_REP_WITHDRAWAL_SUBMITTED,
	UI_STRING_REVIEW_CLAIMABLE_FEES_AND_CONFIRM_THE_FEE_REDEMPTION_FOR_THE_SELECTED_VAULT,
	UI_STRING_SECURITY_BOND_ALLOWANCE_AMOUNT,
	UI_STRING_SECURITY_POOL_ADDRESS,
	UI_STRING_SECURITY_VAULT,
	UI_STRING_SELECTED_VAULT,
	UI_STRING_SELECTED_VAULT_ADDRESS,
	UI_STRING_SELECTED_VAULT_DETAILS_ARE_UNAVAILABLE,
	UI_STRING_SELECTED_VAULT_IS_OWNED_BY_THE_CONNECTED_ACCOUNT,
	UI_STRING_SET_BOND_ALLOWANCE,
	UI_STRING_SET_SECURITY_BOND_ALLOWANCE,
	UI_STRING_STAGED_OPERATION,
	UI_STRING_STAGED_OPERATION_RETRY,
	UI_STRING_THE_ORACLE_MANAGER_ATTEMPTED_THE_ALLOWANCE_UPDATE_IMMEDIATELY_BUT_THE_SECURITY_POOL_REJECTED_IT,
	UI_STRING_THE_ORACLE_MANAGER_ATTEMPTED_THE_WITHDRAWAL_IMMEDIATELY_BUT_THE_SECURITY_POOL_REJECTED_IT,
	UI_STRING_THE_SECURITY_POOL_REJECTED_THE_ACTION,
	UI_STRING_THE_VAULT_HAS_REDEEMABLE_REP,
	UI_STRING_THE_VAULT_STILL_HOLDS_REP_COLLATERAL_TO_QUEUE,
	UI_STRING_THIS_VAULT_DOES_NOT_EXIST,
	UI_STRING_THIS_VAULT_DOES_NOT_EXIST_DEPOSIT_REP_TO_CREATE_IT,
	UI_STRING_TRANSACTION_STATE_UNAVAILABLE,
	UI_STRING_TRY_ANOTHER_POOL_ADDRESS,
	UI_STRING_UNAVAILABLE,
	UI_STRING_VAULT,
	UI_STRING_VAULT_ACTIONS,
	UI_STRING_VAULT_LOOKUP,
	UI_STRING_VAULT_MISSING,
	UI_STRING_VAULT_SUMMARY,
	UI_STRING_VIEW_IN_STAGED_OPERATIONS,
	UI_STRING_WALLET_REP,
	UI_STRING_WALLET_REP_BALANCE_COVERS_THE_DEPOSIT_AMOUNT,
	UI_STRING_WITHDRAW_ESCALATION_DEPOSITS,
	UI_STRING_WITHDRAW_REP,
	UI_STRING_WITHDRAWABLE_REP,
	UI_TEMPLATE_ALLOWANCE_CHECKLIST_LABEL,
	UI_TEMPLATE_FIRST_DEPOSIT_MINIMUM_CHECKLIST_DETAIL,
	UI_TEMPLATE_INSUFFICIENT_REP_BALANCE_DETAIL,
	UI_TEMPLATE_MANUAL_EXECUTION_TIMEOUT_RESOLVED_DETAIL,
	UI_TEMPLATE_REP_BALANCE_SHORTAGE_DETAIL,
	UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON,
} from '../lib/uiStrings.js'
import { getVaultDepositGuardMessage, getVaultRedeemRepGuardMessage, getVaultSetSecurityBondAllowanceGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'
import { deriveTokenApprovalRequirement } from '../lib/tokenApproval.js'
import {
	DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES,
	doesSecurityVaultExistOnchain,
	doesLoadedSecurityVaultMatchSelection,
	getSecurityVaultMaxBondAllowanceAmount,
	getStagedOperationTimeoutSeconds,
	getSecurityVaultWithdrawableRepAmount,
	getSelectedVaultAddress,
	hasValidSecurityVaultOraclePrice,
	isSecurityVaultDepositBelowMinimum,
	isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper,
	MIN_SECURITY_BOND_ALLOWANCE,
	MIN_SECURITY_VAULT_REP_DEPOSIT,
} from '../lib/securityVault.js'
import type { StagedOracleOperation } from '../types/contracts.js'
import type { ReadinessAction, SecurityVaultSectionProps } from '../types/components.js'
type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl' | 'selectedPoolSecurityMultiplier'> & {
	securityBondAllowance: bigint
	securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>
	selectedVaultIsOwnedByAccount: boolean
	variant?: 'embedded' | 'record'
}
type VaultActionModal = 'claim-fees' | 'deposit-rep' | 'set-bond-allowance' | 'withdraw-rep' | undefined
type QueuedVaultOperationStatus = 'executed' | 'failed' | 'manual-queued' | 'missing' | 'queued' | 'refreshing' | undefined
type QueuedVaultOperationView = {
	amount: bigint | undefined
	isPendingSlot: boolean
	operationId: bigint
}
function getVaultLauncherWalletReason(action: 'claim-fees' | 'deposit-rep' | 'rep-exit' | 'set-bond-allowance', repExitMode: 'redeem' | 'withdraw') {
	if (action === 'claim-fees') return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('claim-fees', 'connect-wallet')
	if (action === 'deposit-rep') return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('deposit-rep', 'connect-wallet')
	if (action === 'rep-exit') return repExitMode === 'redeem' ? UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('rep-exit-redeem', 'connect-wallet') : UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('rep-exit-withdraw', 'connect-wallet')
	return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('set-bond-allowance', 'connect-wallet')
}
export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityVaultDetails, selectedPoolSecurityMultiplier, selectedVaultIsOwnedByAccount, variant = 'record' }: SelectedVaultSummarySectionProps) {
	const collateralizationPercent = getVaultCollateralizationPercent(securityVaultDetails.repDepositShare, securityBondAllowance, repPerEthPrice)
	const collateralizationTarget = selectedPoolSecurityMultiplier === undefined ? undefined : selectedPoolSecurityMultiplier * 100n * 10n ** 18n

	const summaryTitle = <span>{UI_STRING_VAULT_SUMMARY}</span>

	const embeddedContent = (
		<div className='security-pool-selected-vault-summary security-pool-browse-vault-list'>
			<div className='security-pool-browse-vault-row'>
				<div className='security-pool-browse-vault-row-top security-pool-browse-vault-row-top-compact'>
					<div className='security-pool-browse-vault-row-title'>
						<CollateralizationCircle className='security-pool-browse-vault-row-collateralization' collateralizationPercent={collateralizationPercent} size='small' targetCollateralizationPercent={collateralizationTarget} />
						<div className='security-pool-browse-vault-row-id'>
							<strong>
								<AddressValue address={securityVaultDetails.vaultAddress} />
							</strong>
						</div>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{UI_STRING_CURRENT_SECURITY_BOND_ALLOWANCE}</span>
						<strong>
							<CurrencyValue value={securityBondAllowance} suffix={UI_STRING_ETH} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{UI_STRING_REP_COLLATERAL}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.repDepositShare} suffix={UI_STRING_REP} />
						</strong>
					</div>
				</div>
			</div>
		</div>
	)
	const gridContent = (
		<VaultMetricGrid
			layout='grid'
			escalationEscrowedRep={securityVaultDetails.escalationEscrowedRep}
			repDepositShare={securityVaultDetails.repDepositShare}
			repPerEthPrice={repPerEthPrice}
			repPerEthSource={repPerEthSource}
			repPerEthSourceUrl={repPerEthSourceUrl}
			selectedPoolSecurityMultiplier={selectedPoolSecurityMultiplier}
			securityBondAllowance={securityBondAllowance}
			unpaidEthFees={securityVaultDetails.unpaidEthFees}
		/>
	)
	if (variant === 'embedded')
		return (
			<SectionBlock density='compact' headingLevel={4} title={summaryTitle} variant='embedded'>
				{embeddedContent}
			</SectionBlock>
		)
	return (
		<EntityCard badge={<Badge tone={selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}>{selectedVaultIsOwnedByAccount ? UI_STRING_OWNED : UI_STRING_READ_ONLY_SECURITY_VAULT_SECTION_READ_ONLY_BADGE_LABEL}</Badge>} title={UI_STRING_SELECTED_VAULT} variant='record'>
			{gridContent}
		</EntityCard>
	)
}
export function getQueuedVaultOperation({ pendingOperation, selectedVaultAddress, securityVaultResult }: { pendingOperation: StagedOracleOperation | undefined; selectedVaultAddress: string; securityVaultResult: SecurityVaultSectionProps['securityVaultResult'] }) {
	if (pendingOperation !== undefined && sameAddress(pendingOperation.targetVault, selectedVaultAddress)) {
		if (securityVaultResult?.action === 'queueWithdrawRep' && pendingOperation.operation === 'withdrawRep') return { amount: pendingOperation.amount, isPendingSlot: true, operationId: pendingOperation.operationId } satisfies QueuedVaultOperationView
		if (securityVaultResult?.action === 'queueSetSecurityBondAllowance' && pendingOperation.operation === 'setSecurityBondsAllowance') return { amount: pendingOperation.amount, isPendingSlot: true, operationId: pendingOperation.operationId } satisfies QueuedVaultOperationView
	}
	if (securityVaultResult?.queuedOperation === undefined) return undefined
	if (securityVaultResult.action === 'queueWithdrawRep' && securityVaultResult.queuedOperation.operation === 'withdrawRep') return { amount: undefined, isPendingSlot: securityVaultResult.queuedOperation.isPendingSlot, operationId: securityVaultResult.queuedOperation.operationId } satisfies QueuedVaultOperationView
	if (securityVaultResult.action === 'queueSetSecurityBondAllowance' && securityVaultResult.queuedOperation.operation === 'setSecurityBondsAllowance')
		return { amount: undefined, isPendingSlot: securityVaultResult.queuedOperation.isPendingSlot, operationId: securityVaultResult.queuedOperation.operationId } satisfies QueuedVaultOperationView
	return undefined
}
function getQueuedVaultOperationStatus({
	currentPoolOracleManagerDetails,
	loadingSecurityVault,
	queuedVaultOperation,
	securityVaultResult,
}: {
	currentPoolOracleManagerDetails: SecurityVaultSectionProps['oracleManagerDetails']
	loadingSecurityVault: boolean
	queuedVaultOperation: ReturnType<typeof getQueuedVaultOperation>
	securityVaultResult: SecurityVaultSectionProps['securityVaultResult']
}) {
	if (securityVaultResult?.action !== 'queueWithdrawRep' && securityVaultResult?.action !== 'queueSetSecurityBondAllowance') return undefined
	if (securityVaultResult.stagedExecution !== undefined) return securityVaultResult.stagedExecution.success ? 'executed' : 'failed'
	if (queuedVaultOperation !== undefined) return queuedVaultOperation.isPendingSlot ? 'queued' : 'manual-queued'
	if (loadingSecurityVault || currentPoolOracleManagerDetails === undefined) return 'refreshing'
	if (currentPoolOracleManagerDetails.isPriceValid) return 'executed'
	return 'missing'
}
function VaultQueuedOperationStatusCard({
	executedTitle,
	failedTitle,
	missingTitle,
	missingDescription,
	queuedTitle,
	queuedVaultOperation,
	manualQueuedDescription,
	refreshingTitle,
	refreshingDescription,
	status,
	successDescription,
	errorMessage,
	onViewStagedOperations,
}: {
	errorMessage: string | undefined
	executedTitle: string
	failedTitle: string
	missingDescription: string
	missingTitle: string
	onViewStagedOperations: (() => void) | undefined
	queuedTitle: string
	queuedVaultOperation: ReturnType<typeof getQueuedVaultOperation>
	manualQueuedDescription: string
	refreshingDescription: string
	refreshingTitle: string
	status: QueuedVaultOperationStatus
	successDescription: string
}) {
	if (status === undefined) return undefined
	if (status === 'queued' || status === 'manual-queued')
		return (
			<WarningSurface as='section' variant='compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{queuedTitle}</h4>
					</div>
				</div>
				<MetricGrid>
					<MetricField label={UI_STRING_STAGED_OPERATION}>{queuedVaultOperation === undefined ? UI_STRING_REFRESHING : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
					{queuedVaultOperation?.amount === undefined ? null : (
						<MetricField label={UI_STRING_AMOUNT}>
							<CurrencyValue value={queuedVaultOperation.amount} suffix={UI_STRING_REP} />
						</MetricField>
					)}
				</MetricGrid>
				{status === 'manual-queued' ? <p className='detail'>{manualQueuedDescription}</p> : null}
				{onViewStagedOperations === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={onViewStagedOperations}>
							{UI_STRING_VIEW_IN_STAGED_OPERATIONS}
						</button>
					</div>
				)}
			</WarningSurface>
		)
	if (status === 'failed')
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{failedTitle}</h4>
					</div>
					<Badge tone='blocked'>{UI_STRING_FAILED}</Badge>
				</div>
				<p className='detail'>{errorMessage ?? UI_STRING_THE_SECURITY_POOL_REJECTED_THE_ACTION}</p>
				<p className='detail'>{UI_STRING_STAGED_OPERATION_RETRY}</p>
			</section>
		)
	if (status === 'executed')
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{executedTitle}</h4>
					</div>
					<Badge tone='ok'>{UI_STRING_EXECUTED}</Badge>
				</div>
				<p className='detail'>{successDescription}</p>
			</section>
		)
	if (status === 'missing')
		return (
			<WarningSurface as='section' variant='compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{missingTitle}</h4>
					</div>
				</div>
				<p className='detail'>{missingDescription}</p>
			</WarningSurface>
		)
	return (
		<section className='entity-card compact'>
			<div className='entity-card-header'>
				<div>
					<h4>{refreshingTitle}</h4>
				</div>
				<Badge tone='muted'>{UI_STRING_REFRESHING_WITHOUT_ELLIPSIS}</Badge>
			</div>
			<p className='detail'>{refreshingDescription}</p>
		</section>
	)
}
export function SecurityVaultSection({
	accountState,
	compactLayout = false,
	autoLoadVault = false,
	extraReadinessActions = [],
	loadingSecurityVault,
	modalFirst = false,
	onApproveRep,
	onDepositRep,
	onLoadSecurityVault,
	onRedeemFees,
	onRedeemRep,
	onSetSecurityBondAllowance,
	onSecurityVaultFormChange,
	oracleManagerDetails,
	onViewStagedOperations,
	onWithdrawRep,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityVaultDetails,
	securityVaultError,
	securityVaultForm,
	securityVaultMissing,
	securityVaultActiveAction,
	securityVaultRepApproval,
	securityVaultRepBalance,
	securityVaultResult,
	selectedPoolSecurityMultiplier,
	selectedPoolTotalRepDeposit,
	selectedPoolTotalSecurityBondAllowance,
	showHeader = true,
	showLookupSection = true,
	showSecurityPoolAddressInput = true,
	showSummarySection = true,
	poolState,
}: SecurityVaultSectionProps) {
	const [vaultActionModal, setVaultActionModal] = useState<VaultActionModal>(undefined)
	const isMainnet = isMainnetChain(accountState?.chainId)
	const normalizedSecurityVaultForm = {
		depositAmount: securityVaultForm.depositAmount ?? '0',
		repWithdrawAmount: securityVaultForm.repWithdrawAmount ?? '0',
		securityBondAllowanceAmount: securityVaultForm.securityBondAllowanceAmount ?? '0',
		securityPoolAddress: securityVaultForm.securityPoolAddress ?? '',
		selectedVaultAddress: securityVaultForm.selectedVaultAddress ?? '',
		stagedOperationTimeoutMinutes: securityVaultForm.stagedOperationTimeoutMinutes ?? DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString(),
	}
	const selectedVaultAddress = getSelectedVaultAddress(normalizedSecurityVaultForm.selectedVaultAddress, accountState.address)
	const currentSelectedVaultDetails = doesLoadedSecurityVaultMatchSelection({
		accountAddress: accountState.address,
		securityPoolAddress: normalizedSecurityVaultForm.securityPoolAddress,
		securityVaultDetails,
		selectedVaultAddress: normalizedSecurityVaultForm.selectedVaultAddress,
	})
		? securityVaultDetails
		: undefined
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultAddress, accountState.address)
	const depositAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.depositAmount)
	const securityBondAllowanceAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.securityBondAllowanceAmount)
	const withdrawAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.repWithdrawAmount)
	const stagedOperationTimeoutMinutes = tryParseBigIntInput(normalizedSecurityVaultForm.stagedOperationTimeoutMinutes)
	const stagedOperationTimeoutSeconds = getStagedOperationTimeoutSeconds(stagedOperationTimeoutMinutes)
	const securityBondAllowance = currentSelectedVaultDetails?.securityBondAllowance ?? 0n
	const vaultExistsOnchain = doesSecurityVaultExistOnchain(currentSelectedVaultDetails)
	const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(currentSelectedVaultDetails?.managerAddress, oracleManagerDetails)
	const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? oracleManagerDetails?.priceValidUntilTimestamp : undefined
	const approvalRequirement = deriveTokenApprovalRequirement(depositAmount, securityVaultRepApproval.value)
	const repBalanceGap = balanceShortage(depositAmount, securityVaultRepBalance)
	const withdrawableRepAmount = getSecurityVaultWithdrawableRepAmount({
		repDepositShare: currentSelectedVaultDetails?.repDepositShare,
		repPerEthPrice: hasValidOraclePrice ? oracleManagerDetails?.lastPrice : undefined,
		securityBondAllowance: currentSelectedVaultDetails?.securityBondAllowance,
		totalRepDeposit: selectedPoolTotalRepDeposit,
		totalSecurityBondAllowance: selectedPoolTotalSecurityBondAllowance,
	})
	const queuedWithdrawRepLimit = hasValidOraclePrice ? withdrawableRepAmount : currentSelectedVaultDetails?.repDepositShare
	const maxSecurityBondAllowanceAmount = getSecurityVaultMaxBondAllowanceAmount({
		currentSecurityBondAllowance: currentSelectedVaultDetails?.securityBondAllowance,
		repDepositShare: currentSelectedVaultDetails?.repDepositShare,
		repPerEthPrice: hasValidOraclePrice ? oracleManagerDetails?.lastPrice : undefined,
		totalRepDeposit: selectedPoolTotalRepDeposit,
		totalSecurityBondAllowance: selectedPoolTotalSecurityBondAllowance,
	})
	const hasValidSecurityBondAllowanceAmount = securityBondAllowanceAmount !== undefined && securityBondAllowanceAmount >= 0n && (securityBondAllowanceAmount === 0n || securityBondAllowanceAmount >= MIN_SECURITY_BOND_ALLOWANCE)
	const isDepositBelowMinimum = isSecurityVaultDepositBelowMinimum(currentSelectedVaultDetails?.repDepositShare, depositAmount)
	const hasClaimableFees = currentSelectedVaultDetails !== undefined && currentSelectedVaultDetails.unpaidEthFees > 0n
	const hasSufficientDepositAllowance = selectedVaultIsOwnedByAccount && depositAmount !== undefined && depositAmount > 0n && approvalRequirement.hasSufficientApproval
	const hasInsufficientRepBalance = repBalanceGap !== undefined && repBalanceGap > 0n
	const hasPositiveDepositAmount = depositAmount !== undefined && depositAmount > 0n
	const hasPositiveWithdrawAmount = withdrawAmount !== undefined && withdrawAmount > 0n
	const redeemableRepAmount = currentSelectedVaultDetails?.repDepositShare
	const hasWithdrawableRep = queuedWithdrawRepLimit !== undefined && queuedWithdrawRepLimit > 0n
	const depositRepEnabled = poolState?.actions.depositRep.enabled ?? true
	const queueWithdrawRepEnabled = poolState?.actions.queueWithdrawRep.enabled ?? true
	const redeemRepEnabled = poolState?.actions.redeemRep.enabled === true
	const approveRepEnabled = poolState?.actions.approveRep.enabled ?? true
	const bondAllowanceEnabled = poolState?.actions.queueSetSecurityBondAllowance.enabled ?? true
	const claimFeesEnabled = poolState?.actions.redeemFees.enabled ?? true
	const poolCollateralActionsEnabled = depositRepEnabled
	const effectiveRepExitMode = redeemRepEnabled ? 'redeem' : 'withdraw'
	const repExitEnabled = effectiveRepExitMode === 'redeem' ? redeemRepEnabled : queueWithdrawRepEnabled
	const repExitActionLabel = effectiveRepExitMode === 'redeem' ? UI_STRING_REDEEM_REP : UI_STRING_WITHDRAW_REP
	const repExitAmountLabel = (() => {
		if (effectiveRepExitMode === 'redeem') return UI_STRING_REDEEMABLE_REP
		if (hasValidOraclePrice) return UI_STRING_WITHDRAWABLE_REP
		return UI_STRING_REP_AVAILABLE_TO_QUEUE
	})()
	const setSecurityBondAllowanceFunding = resolveOracleOperationEthFunding({
		managerDetails: oracleManagerDetails,
	})
	const setSecurityBondAllowanceGuardMessage = getVaultSetSecurityBondAllowanceGuardMessage({
		bufferRequiredEthCost: setSecurityBondAllowanceFunding?.includeBuffer === true,
		maxSecurityBondAllowanceAmount: hasValidOraclePrice ? maxSecurityBondAllowanceAmount : undefined,
		requiredEthCost: setSecurityBondAllowanceFunding?.ethCost,
		securityBondAllowanceAmount,
		stagedOperationTimeoutMinutes,
		walletEthBalance: accountState.ethBalance,
	})
	const depositGuardMessage = getVaultDepositGuardMessage({
		approvalSatisfied: hasSufficientDepositAllowance,
		depositAmount,
		isDepositBelowMinimum,
		repBalanceGap: hasInsufficientRepBalance ? repBalanceGap : undefined,
	})
	const withdrawRepFunding = resolveOracleOperationEthFunding({
		managerDetails: oracleManagerDetails,
	})
	const withdrawRepGuardMessage = getVaultWithdrawGuardMessage({
		bufferRequiredEthCost: withdrawRepFunding?.includeBuffer === true,
		requiredEthCost: withdrawRepFunding?.ethCost,
		stagedOperationTimeoutMinutes,
		withdrawAmount,
		withdrawableRepAmount: queuedWithdrawRepLimit,
		walletEthBalance: accountState.ethBalance,
	})
	const redeemRepGuardMessage = getVaultRedeemRepGuardMessage({
		escalationEscrowedRep: currentSelectedVaultDetails?.escalationEscrowedRep,
		redeemableRepAmount,
	})
	const repExitGuardMessage = effectiveRepExitMode === 'redeem' ? redeemRepGuardMessage : withdrawRepGuardMessage
	const hasConnectedWallet = accountState.address !== undefined
	const canUseOwnedVaultActions = selectedVaultIsOwnedByAccount && hasConnectedWallet
	const hasLoadedSelectedVaultDetails = currentSelectedVaultDetails !== undefined
	const canUseLoadedVaultActions = canUseOwnedVaultActions && hasLoadedSelectedVaultDetails && isMainnet
	const showMissingVaultNotice = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain
	const autoLoadKey = `${normalizeAddress(selectedVaultAddress) ?? ''}:${normalizeAddress(normalizedSecurityVaultForm.securityPoolAddress) ?? ''}`
	const hasLoadedCurrentVault = currentSelectedVaultDetails !== undefined && sameAddress(currentSelectedVaultDetails.vaultAddress, selectedVaultAddress) && sameAddress(currentSelectedVaultDetails.securityPoolAddress, normalizedSecurityVaultForm.securityPoolAddress)
	const lastAutoLoadKey = useRef<string | undefined>(undefined)
	const queuedVaultOperation = getQueuedVaultOperation({
		pendingOperation: oracleManagerDetails?.pendingOperation,
		selectedVaultAddress: selectedVaultAddress ?? '',
		securityVaultResult,
	})
	const queuedVaultOperationStatus = getQueuedVaultOperationStatus({
		currentPoolOracleManagerDetails: oracleManagerDetails,
		loadingSecurityVault,
		queuedVaultOperation,
		securityVaultResult,
	})
	const stagedOperationTimeoutHelpText =
		stagedOperationTimeoutSeconds === undefined ? UI_STRING_ENTER_WHOLE_MINUTES_QUEUED_SELF_SERVICE_OPERATIONS_MUST_STAY_EXECUTABLE_FOR_AT_LEAST_1_MINUTE_AFTER_THE_ORACLE_SETTLEMENT_WINDOW_COMPLETES : UI_TEMPLATE_MANUAL_EXECUTION_TIMEOUT_RESOLVED_DETAIL(formatDuration(stagedOperationTimeoutSeconds))
	const renderStagedOperationTimeoutField = () => (
		<>
			<label className='field'>
				<span>{UI_STRING_MANUAL_EXECUTION_TIMEOUT}</span>
				<div className='field-inline'>
					<FormInput
						className='field-inline-input'
						inputMode='numeric'
						min='1'
						pattern='[0-9]*'
						step='1'
						value={normalizedSecurityVaultForm.stagedOperationTimeoutMinutes}
						onInput={event => onSecurityVaultFormChange({ stagedOperationTimeoutMinutes: event.currentTarget.value })}
						disabled={!poolCollateralActionsEnabled}
					/>
					<span className='field-inline-action'>{UI_STRING_MINUTES}</span>
				</div>
			</label>
			<p className='detail'>{stagedOperationTimeoutHelpText}</p>
		</>
	)
	const vaultLoadNotice = (() => {
		if (loadingSecurityVault)
			return (
				<p className='detail'>
					<LoadingText>{UI_STRING_LOADING_VAULT}</LoadingText>
				</p>
			)
		if (securityVaultMissing) return <StateHint presentation={{ key: 'not_found', badgeLabel: UI_STRING_NOT_FOUND, badgeTone: 'blocked', detail: UI_STRING_TRY_ANOTHER_POOL_ADDRESS }} />

		return undefined
	})()
	const loadedVaultMissingBlocker = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain ? UI_STRING_THIS_VAULT_DOES_NOT_EXIST : undefined
	const getVaultLauncherBlocker = (action: 'claim-fees' | 'deposit-rep' | 'rep-exit' | 'set-bond-allowance') => {
		const walletGuardState = getWalletMainnetGuardState({
			accountAddress: accountState.address,
			isMainnet,
			walletRequiredReason: getVaultLauncherWalletReason(action, effectiveRepExitMode),
		})
		if (walletGuardState.blocked) return walletGuardState.reason
		if (!selectedVaultIsOwnedByAccount) {
			if (action === 'claim-fees') return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('claim-fees', 'select-own-vault')
			if (action === 'deposit-rep') return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('deposit-rep', 'select-own-vault')
			if (action === 'rep-exit') return effectiveRepExitMode === 'redeem' ? UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('rep-exit-redeem', 'select-own-vault') : UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('rep-exit-withdraw', 'select-own-vault')
			return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('set-bond-allowance', 'select-own-vault')
		}
		if (!hasLoadedSelectedVaultDetails) {
			if (action === 'claim-fees') return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('claim-fees', 'refresh-vault')
			if (action === 'deposit-rep') return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('deposit-rep', 'refresh-vault')
			if (action === 'rep-exit') return effectiveRepExitMode === 'redeem' ? UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('rep-exit-redeem', 'refresh-vault') : UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('rep-exit-withdraw', 'refresh-vault')
			return UI_TEMPLATE_VAULT_LAUNCHER_BLOCKER_REASON('set-bond-allowance', 'refresh-vault')
		}
		if (action === 'deposit-rep') return undefined
		return loadedVaultMissingBlocker
	}
	const depositLauncherBlocker = getVaultLauncherBlocker('deposit-rep')
	const repExitLauncherBlocker = getVaultLauncherBlocker('rep-exit')
	const bondAllowanceLauncherBlocker = getVaultLauncherBlocker('set-bond-allowance')
	const claimFeesLauncherBlocker = getVaultLauncherBlocker('claim-fees')
	useEffect(() => {
		if (!autoLoadVault) return
		if (normalizedSecurityVaultForm.securityPoolAddress.trim() === '') return
		if (selectedVaultAddress === undefined || selectedVaultAddress === '') return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastAutoLoadKey.current === autoLoadKey) return
		lastAutoLoadKey.current = autoLoadKey
		void onLoadSecurityVault()
	}, [autoLoadKey, autoLoadVault, hasLoadedCurrentVault, loadingSecurityVault, normalizedSecurityVaultForm.securityPoolAddress, onLoadSecurityVault, selectedVaultAddress])
	const vaultReadinessActions = getSecurityPoolVaultReadinessActions([
		{
			actionLabel: UI_STRING_DEPOSIT_REP,
			description: UI_STRING_ADD_REP_TO_THE_SELECTED_VAULT,
			key: 'deposit-rep',
			...(depositRepEnabled && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('deposit-rep') } : {}),
			readiness: depositRepEnabled && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(depositLauncherBlocker === undefined ? {} : { blocker: depositLauncherBlocker }),
			title: UI_STRING_DEPOSIT_REP,
		},
		{
			actionLabel: repExitActionLabel,
			description: effectiveRepExitMode === 'redeem' ? UI_STRING_REDEEM_THE_REMAINING_REP_COLLATERAL_FROM_THIS_ENDED_POOL_AFTER_ESCALATION_DEPOSITS_ARE_SETTLED : UI_STRING_QUEUE_A_REP_WITHDRAWAL_NOW_OR_LET_IT_EXECUTE_IMMEDIATELY_WHEN_A_VALID_ORACLE_PRICE_IS_ALREADY_AVAILABLE,
			key: 'rep-exit',
			...(repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('withdraw-rep') } : {}),
			readiness: repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(repExitLauncherBlocker === undefined ? {} : { blocker: repExitLauncherBlocker }),
			title: repExitActionLabel,
		},
		{
			actionLabel: UI_STRING_SET_BOND_ALLOWANCE,
			description: UI_STRING_QUEUE_A_NEW_SECURITY_BOND_ALLOWANCE_USING_THE_CURRENT_ORACLE_PRICE_CONTEXT,
			key: 'set-bond-allowance',
			...(bondAllowanceEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('set-bond-allowance') } : {}),
			readiness: bondAllowanceEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(bondAllowanceLauncherBlocker === undefined ? {} : { blocker: bondAllowanceLauncherBlocker }),
			title: UI_STRING_SET_SECURITY_BOND_ALLOWANCE,
		},
		{
			actionLabel: UI_STRING_CLAIM_FEES,
			description: UI_STRING_REVIEW_CLAIMABLE_FEES_AND_CONFIRM_THE_FEE_REDEMPTION_FOR_THE_SELECTED_VAULT,
			key: 'claim-fees',
			...(claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('claim-fees') } : {}),
			readiness: claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(claimFeesLauncherBlocker === undefined ? {} : { blocker: claimFeesLauncherBlocker }),
			title: UI_STRING_CLAIM_FEES,
		},
		...extraReadinessActions,
	] satisfies ReadinessAction[])
	const actionSections = modalFirst ? (
		<>
			<SectionBlock title={UI_STRING_VAULT_ACTIONS}>
				{showMissingVaultNotice ? <StateHint presentation={{ key: 'not_found', badgeLabel: UI_STRING_VAULT_MISSING, badgeTone: 'muted', detail: UI_STRING_THIS_VAULT_DOES_NOT_EXIST_DEPOSIT_REP_TO_CREATE_IT }} /> : undefined}
				<div className='vault-action-launcher-grid'>
					{vaultReadinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<ErrorNotice message={securityVaultError} />
			<OperationModal isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title={UI_STRING_DEPOSIT_REP}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{UI_STRING_SELECTED_VAULT_DETAILS_ARE_UNAVAILABLE}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{vaultExistsOnchain ? (
							<SelectedVaultSummarySection
								repPerEthPrice={repPerEthPrice}
								repPerEthSource={repPerEthSource}
								repPerEthSourceUrl={repPerEthSourceUrl}
								securityBondAllowance={currentSelectedVaultDetails.securityBondAllowance}
								securityVaultDetails={currentSelectedVaultDetails}
								selectedPoolSecurityMultiplier={selectedPoolSecurityMultiplier}
								selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
								variant='embedded'
							/>
						) : (
							<StateHint presentation={{ key: 'not_found', badgeLabel: UI_STRING_VAULT_MISSING, badgeTone: 'muted', detail: UI_STRING_THIS_VAULT_DOES_NOT_EXIST_DEPOSIT_REP_TO_CREATE_IT }} />
						)}
						<label className='field'>
							<span>{UI_STRING_REP_COLLATERAL_AMOUNT}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button
									className='quiet field-inline-action'
									type='button'
									onClick={() => {
										if (securityVaultRepBalance === undefined) return
										onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(securityVaultRepBalance) })
									}}
									disabled={securityVaultRepBalance === undefined || !poolCollateralActionsEnabled}
								>
									{UI_STRING_MAX}
								</button>
							</div>
						</label>
						<MetricGrid>
							<MetricField label={UI_STRING_WALLET_REP}>
								<CurrencyValue value={securityVaultRepBalance} suffix={UI_STRING_REP} />
							</MetricField>
						</MetricGrid>
						<TokenApprovalControl
							actionLabel={UI_STRING_DEPOSITING_REP}
							allowanceError={securityVaultRepApproval.error}
							allowanceLoading={securityVaultRepApproval.loading}
							approvedAmount={securityVaultRepApproval.value}
							guardMessage={undefined}
							onApprove={amount => onApproveRep(amount)}
							pending={securityVaultActiveAction === 'approveRep'}
							pendingLabel={UI_STRING_APPROVING_REP}
							requiredAmount={depositAmount}
							resetKey={`${currentSelectedVaultDetails.repToken}:${currentSelectedVaultDetails.securityPoolAddress}:${depositAmount?.toString() ?? ''}`}
							tokenSymbol='REP'
							tokenUnits={18}
							disabled={!approveRepEnabled || !canUseLoadedVaultActions}
						/>
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: UI_STRING_SELECTED_VAULT_IS_OWNED_BY_THE_CONNECTED_ACCOUNT, resolved: selectedVaultIsOwnedByAccount },
								{
									key: 'balance',
									label: UI_STRING_WALLET_REP_BALANCE_COVERS_THE_DEPOSIT_AMOUNT,
									resolved: repBalanceGap === undefined || repBalanceGap <= 0n,
									...(repBalanceGap !== undefined && repBalanceGap > 0n ? { detail: UI_TEMPLATE_REP_BALANCE_SHORTAGE_DETAIL(formatCurrencyBalance(repBalanceGap)) } : {}),
								},
								{ key: 'minimum', label: UI_STRING_FIRST_DEPOSIT_MEETS_THE_VAULT_MINIMUM, resolved: !isDepositBelowMinimum, ...(isDepositBelowMinimum ? { detail: UI_TEMPLATE_FIRST_DEPOSIT_MINIMUM_CHECKLIST_DETAIL(formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)) } : {}) },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{UI_STRING_CANCEL}
							</button>
							<TransactionActionButton
								idleLabel={UI_STRING_DEPOSIT_REP}
								pendingLabel={UI_STRING_DEPOSITING_REP_SECURITY_VAULT_SECTION_DEPOSIT_REP_PENDING_LABEL}
								onClick={onDepositRep}
								pending={securityVaultActiveAction === 'depositRep'}
								availability={{ disabled: !depositRepEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal
				isOpen={vaultActionModal === 'withdraw-rep'}
				onClose={() => setVaultActionModal(undefined)}
				title={repExitActionLabel}
				description={effectiveRepExitMode === 'redeem' ? UI_STRING_REDEEM_THE_REMAINING_REP_COLLATERAL_FROM_THIS_ENDED_POOL_AFTER_ESCALATION_DEPOSITS_ARE_SETTLED : UI_STRING_QUEUE_A_REP_WITHDRAWAL_AFTER_REVIEWING_THE_CURRENT_VAULT_COLLATERAL_AND_ORACLE_STATUS}
			>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{UI_STRING_SELECTED_VAULT_DETAILS_ARE_UNAVAILABLE}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{effectiveRepExitMode === 'redeem' ? null : (
							<VaultQueuedOperationStatusCard
								errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? UI_STRING_THE_ORACLE_MANAGER_ATTEMPTED_THE_WITHDRAWAL_IMMEDIATELY_BUT_THE_SECURITY_POOL_REJECTED_IT}
								executedTitle={UI_STRING_REP_WITHDRAWAL_EXECUTED}
								failedTitle={UI_STRING_REP_WITHDRAWAL_FAILED}
								manualQueuedDescription={UI_STRING_MANUAL_QUEUED_OPERATION}
								missingDescription={UI_STRING_TRANSACTION_STATE_UNAVAILABLE}
								missingTitle={UI_STRING_REP_WITHDRAWAL_SUBMITTED}
								onViewStagedOperations={onViewStagedOperations}
								queuedTitle={UI_STRING_REP_WITHDRAWAL_QUEUED}
								queuedVaultOperation={queuedVaultOperation}
								refreshingDescription={UI_STRING_REFRESHING_THE_ORACLE_MANAGER_TO_DETERMINE_WHETHER_THE_WITHDRAWAL_WAS_QUEUED_OR_EXECUTED_IMMEDIATELY}
								refreshingTitle={UI_STRING_REFRESHING_WITHDRAWAL_STATE}
								status={securityVaultResult?.action === 'queueWithdrawRep' ? queuedVaultOperationStatus : undefined}
								successDescription={UI_STRING_A_VALID_ORACLE_PRICE_WAS_ALREADY_AVAILABLE_SO_THE_WITHDRAWAL_EXECUTED_IMMEDIATELY_AND_NO_STAGED_OPERATION_WAS_CREATED}
							/>
						)}
						<SelectedVaultSummarySection
							repPerEthPrice={repPerEthPrice}
							repPerEthSource={repPerEthSource}
							repPerEthSourceUrl={repPerEthSourceUrl}
							securityBondAllowance={currentSelectedVaultDetails.securityBondAllowance}
							securityVaultDetails={currentSelectedVaultDetails}
							selectedPoolSecurityMultiplier={selectedPoolSecurityMultiplier}
							selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
							variant='embedded'
						/>
						<MetricGrid>
							<MetricField label={repExitAmountLabel}>
								{(() => {
									if (effectiveRepExitMode === 'redeem') {
										if (redeemableRepAmount === undefined) return '—'

										return <CurrencyValue value={redeemableRepAmount} suffix={UI_STRING_REP} />
									}
									if (queuedWithdrawRepLimit === undefined) return '—'

									return <CurrencyValue value={queuedWithdrawRepLimit} suffix={UI_STRING_REP} />
								})()}
							</MetricField>
							{effectiveRepExitMode === 'redeem' ? (
								<MetricField label={UI_STRING_ESCROWED_REP}>
									<CurrencyValue value={currentSelectedVaultDetails.escalationEscrowedRep} suffix={UI_STRING_REP} />
								</MetricField>
							) : (
								<MetricField label={UI_STRING_PRICE_VALID_UNTIL}>{oraclePriceValidUntilTimestamp === undefined ? UI_STRING_UNAVAILABLE : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
							)}
						</MetricGrid>
						{effectiveRepExitMode === 'redeem' ? null : (
							<label className='field'>
								<span>{UI_STRING_REP_WITHDRAW_AMOUNT}</span>
								<div className='field-inline'>
									<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
									<button
										className='quiet field-inline-action'
										type='button'
										onClick={() => {
											if (queuedWithdrawRepLimit === undefined) return
											onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(queuedWithdrawRepLimit) })
										}}
										disabled={queuedWithdrawRepLimit === undefined || !poolCollateralActionsEnabled}
									>
										{UI_STRING_MAX}
									</button>
								</div>
							</label>
						)}
						{effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField()}
						<RequirementsChecklist
							items={
								effectiveRepExitMode === 'redeem'
									? [
											{ key: 'owned', label: UI_STRING_SELECTED_VAULT_IS_OWNED_BY_THE_CONNECTED_ACCOUNT, resolved: selectedVaultIsOwnedByAccount },
											{
												key: 'locked',
												label: UI_STRING_NO_REP_REMAINS_LOCKED_IN_THE_ESCALATION_GAME,
												resolved: currentSelectedVaultDetails.escalationEscrowedRep === 0n,
												...(currentSelectedVaultDetails.escalationEscrowedRep > 0n ? { detail: UI_STRING_WITHDRAW_ESCALATION_DEPOSITS } : {}),
											},
											{ key: 'redeemable', label: UI_STRING_THE_VAULT_HAS_REDEEMABLE_REP, resolved: redeemableRepAmount !== undefined && redeemableRepAmount > 0n },
										]
									: [
											{ key: 'owned', label: UI_STRING_SELECTED_VAULT_IS_OWNED_BY_THE_CONNECTED_ACCOUNT, resolved: selectedVaultIsOwnedByAccount },
											{
												key: 'oracle',
												label: hasValidOraclePrice ? UI_STRING_A_VALID_ORACLE_PRICE_IS_AVAILABLE : UI_STRING_ORACLE_EXECUTION_CAN_BE_FUNDED_UNTIL_A_FRESH_PRICE_ARRIVES,
												resolved: hasValidOraclePrice || withdrawRepFunding !== undefined,
											},
											{
												key: 'withdrawable',
												label: hasValidOraclePrice ? UI_STRING_WITHDRAWABLE_REP : UI_STRING_THE_VAULT_STILL_HOLDS_REP_COLLATERAL_TO_QUEUE,
												resolved: queuedWithdrawRepLimit !== undefined && queuedWithdrawRepLimit > 0n,
											},
											{ key: 'timeout', label: UI_STRING_MANUAL_EXECUTION_TIMEOUT_IS_AT_LEAST_1_MINUTE, resolved: stagedOperationTimeoutSeconds !== undefined },
										]
							}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{UI_STRING_CANCEL}
							</button>
							<TransactionActionButton
								idleLabel={repExitActionLabel}
								pendingLabel={effectiveRepExitMode === 'redeem' ? UI_STRING_REDEEMING_REP : UI_STRING_QUEUEING_REP_WITHDRAWAL}
								onClick={effectiveRepExitMode === 'redeem' ? onRedeemRep : onWithdrawRep}
								pending={effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRep' : securityVaultActiveAction === 'queueWithdrawRep'}
								tone='secondary'
								availability={{
									disabled: !repExitEnabled || !canUseLoadedVaultActions || (effectiveRepExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
									reason: canUseLoadedVaultActions ? repExitGuardMessage : undefined,
								}}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'set-bond-allowance'} onClose={() => setVaultActionModal(undefined)} title={UI_STRING_SET_BOND_ALLOWANCE} description={UI_STRING_QUEUE_A_NEW_BOND_ALLOWANCE_USING_THE_LATEST_VALID_ORACLE_PRICE_FOR_THE_SELECTED_VAULT}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{UI_STRING_SELECTED_VAULT_DETAILS_ARE_UNAVAILABLE}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						<VaultQueuedOperationStatusCard
							errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? UI_STRING_THE_ORACLE_MANAGER_ATTEMPTED_THE_ALLOWANCE_UPDATE_IMMEDIATELY_BUT_THE_SECURITY_POOL_REJECTED_IT}
							executedTitle={UI_STRING_BOND_ALLOWANCE_EXECUTED}
							failedTitle={UI_STRING_BOND_ALLOWANCE_FAILED}
							manualQueuedDescription={UI_STRING_MANUAL_QUEUED_OPERATION}
							missingDescription={UI_STRING_TRANSACTION_STATE_UNAVAILABLE}
							missingTitle={UI_STRING_BOND_ALLOWANCE_SUBMITTED}
							onViewStagedOperations={onViewStagedOperations}
							queuedTitle={UI_STRING_BOND_ALLOWANCE_QUEUED}
							queuedVaultOperation={queuedVaultOperation}
							refreshingDescription={UI_STRING_REFRESHING_THE_ORACLE_MANAGER_TO_DETERMINE_WHETHER_THE_BOND_ALLOWANCE_WAS_QUEUED_OR_EXECUTED_IMMEDIATELY}
							refreshingTitle={UI_STRING_REFRESHING_BOND_ALLOWANCE_STATE}
							status={securityVaultResult?.action === 'queueSetSecurityBondAllowance' ? queuedVaultOperationStatus : undefined}
							successDescription={UI_STRING_A_VALID_ORACLE_PRICE_WAS_ALREADY_AVAILABLE_SO_THE_NEW_BOND_ALLOWANCE_EXECUTED_IMMEDIATELY_AND_NO_STAGED_OPERATION_WAS_CREATED}
						/>
						<MetricGrid>
							<MetricField label={UI_STRING_CURRENT_BOND_ALLOWANCE}>
								<CurrencyValue value={currentSelectedVaultDetails.securityBondAllowance} suffix={UI_STRING_ETH} />
							</MetricField>
							<MetricField label={UI_STRING_PRICE_VALID_UNTIL}>{oraclePriceValidUntilTimestamp === undefined ? UI_STRING_UNAVAILABLE : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</MetricGrid>
						<label className='field'>
							<span>{UI_STRING_SECURITY_BOND_ALLOWANCE_AMOUNT}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n || !poolCollateralActionsEnabled}>
									{UI_STRING_MAX}
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: UI_STRING_SELECTED_VAULT_IS_OWNED_BY_THE_CONNECTED_ACCOUNT, resolved: selectedVaultIsOwnedByAccount },
								{ key: 'oracle', label: UI_STRING_A_VALID_ORACLE_PRICE_IS_AVAILABLE, resolved: hasValidOraclePrice },
								{ key: 'allowance', label: UI_TEMPLATE_ALLOWANCE_CHECKLIST_LABEL(formatCurrencyBalance(MIN_SECURITY_BOND_ALLOWANCE)), resolved: hasValidSecurityBondAllowanceAmount },
								{ key: 'timeout', label: UI_STRING_MANUAL_EXECUTION_TIMEOUT_IS_AT_LEAST_1_MINUTE, resolved: stagedOperationTimeoutSeconds !== undefined },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{UI_STRING_CANCEL}
							</button>
							<TransactionActionButton
								idleLabel={UI_STRING_SET_SECURITY_BOND_ALLOWANCE}
								pendingLabel={UI_STRING_QUEUEING_ALLOWANCE_UPDATE}
								onClick={onSetSecurityBondAllowance}
								pending={securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: !bondAllowanceEnabled || !canUseLoadedVaultActions || setSecurityBondAllowanceGuardMessage !== undefined, reason: canUseLoadedVaultActions ? setSecurityBondAllowanceGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'claim-fees'} onClose={() => setVaultActionModal(undefined)} title={UI_STRING_CLAIM_FEES} description={UI_STRING_CONFIRM_THE_CLAIMABLE_FEE_BALANCE_BEFORE_SUBMITTING_THE_FEE_REDEMPTION_FOR_THIS_VAULT}>
				<MetricGrid>
					<MetricField label={UI_STRING_CLAIMABLE_FEES}>{currentSelectedVaultDetails === undefined ? UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER : <CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix={UI_STRING_ETH} />}</MetricField>
					<MetricField label={UI_STRING_VAULT}>{selectedVaultAddress === undefined ? UI_STRING_NONE_SELECTED : <AddressValue address={selectedVaultAddress} />}</MetricField>
				</MetricGrid>
				<RequirementsChecklist
					items={[
						{ key: 'owned', label: UI_STRING_SELECTED_VAULT_IS_OWNED_BY_THE_CONNECTED_ACCOUNT, resolved: selectedVaultIsOwnedByAccount },
						{ key: 'fees', label: UI_STRING_CLAIMABLE_FEES_ARE_AVAILABLE, resolved: hasClaimableFees },
					]}
				/>
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
						{UI_STRING_CANCEL}
					</button>
					<TransactionActionButton idleLabel={UI_STRING_CLAIM_FEES} pendingLabel={UI_STRING_CLAIMING_FEES} onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: undefined }} />
				</div>
			</OperationModal>
		</>
	) : (
		<>
			<SectionBlock title={UI_STRING_CLAIM_FEES}>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{UI_STRING_SELECTED_VAULT_DETAILS_ARE_UNAVAILABLE}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={UI_STRING_CLAIMABLE_FEES}>
							<CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix={UI_STRING_ETH} />
						</MetricField>
					</div>
				)}
				<div className='actions'>
					<TransactionActionButton idleLabel={UI_STRING_CLAIM_FEES} pendingLabel={UI_STRING_CLAIMING_FEES} onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: undefined }} />
				</div>
			</SectionBlock>

			<SectionBlock title={UI_STRING_DEPOSIT_REP}>
				<label className='field'>
					<span>{UI_STRING_REP_COLLATERAL_AMOUNT}</span>
					<div className='field-inline'>
						<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
						<button
							className='quiet field-inline-action'
							type='button'
							onClick={() => {
								if (securityVaultRepBalance === undefined) return
								onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(securityVaultRepBalance) })
							}}
							disabled={securityVaultRepBalance === undefined || !poolCollateralActionsEnabled}
						>
							{UI_STRING_MAX}
						</button>
					</div>
				</label>
				<TokenApprovalControl
					actionLabel={UI_STRING_DEPOSITING_REP}
					allowanceError={securityVaultRepApproval.error}
					allowanceLoading={securityVaultRepApproval.loading}
					approvedAmount={securityVaultRepApproval.value}
					guardMessage={undefined}
					onApprove={amount => onApproveRep(amount)}
					pending={securityVaultActiveAction === 'approveRep'}
					pendingLabel={UI_STRING_APPROVING_REP}
					requiredAmount={depositAmount}
					resetKey={`${currentSelectedVaultDetails?.repToken ?? ''}:${currentSelectedVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`}
					tokenSymbol='REP'
					tokenUnits={18}
					disabled={!approveRepEnabled || !canUseLoadedVaultActions}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={UI_STRING_DEPOSIT_REP}
						pendingLabel={UI_STRING_DEPOSITING_REP_SECURITY_VAULT_SECTION_DEPOSIT_REP_PENDING_LABEL}
						onClick={onDepositRep}
						pending={securityVaultActiveAction === 'depositRep'}
						availability={{ disabled: !depositRepEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositGuardMessage : undefined }}
					/>
				</div>
				{(() => {
					if (repBalanceGap !== undefined && repBalanceGap > 0n) return <ErrorNotice message={UI_TEMPLATE_INSUFFICIENT_REP_BALANCE_DETAIL(formatCurrencyBalance(repBalanceGap))} />
					if (isDepositBelowMinimum)
						return (
							<p className='detail'>
								{UI_STRING_NEW_VAULTS_REQUIRE_AT_LEAST} <CurrencyValue value={MIN_SECURITY_VAULT_REP_DEPOSIT} suffix={UI_STRING_REP} copyable={false} /> {UI_STRING_IN_THE_FIRST_DEPOSIT}
							</p>
						)

					return undefined
				})()}
			</SectionBlock>

			<SectionBlock title={UI_STRING_SET_SECURITY_BOND_ALLOWANCE}>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{UI_STRING_SELECTED_VAULT_DETAILS_ARE_UNAVAILABLE}</p>
				) : (
					<>
						<div className='entity-metric-grid'>
							<MetricField className='entity-metric' label={UI_STRING_CURRENT_SECURITY_BOND_ALLOWANCE}>
								<CurrencyValue value={securityBondAllowance} suffix={UI_STRING_ETH} />
							</MetricField>
							{oraclePriceValidUntilTimestamp === undefined ? undefined : (
								<MetricField className='entity-metric' label={UI_STRING_PRICE_VALID_UNTIL}>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)}
						</div>
						<label className='field'>
							<span>{UI_STRING_SECURITY_BOND_ALLOWANCE_AMOUNT}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n || !poolCollateralActionsEnabled}>
									{UI_STRING_MAX}
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={UI_STRING_SET_SECURITY_BOND_ALLOWANCE}
								pendingLabel={UI_STRING_QUEUEING_ALLOWANCE_UPDATE}
								onClick={onSetSecurityBondAllowance}
								pending={securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: !bondAllowanceEnabled || !canUseLoadedVaultActions || setSecurityBondAllowanceGuardMessage !== undefined, reason: canUseLoadedVaultActions ? setSecurityBondAllowanceGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</SectionBlock>

			<SectionBlock title={repExitActionLabel}>
				{(effectiveRepExitMode === 'redeem' ? redeemableRepAmount : queuedWithdrawRepLimit) === undefined ? (
					<p className='detail'>{UI_STRING_SELECTED_VAULT_DETAILS_ARE_UNAVAILABLE}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={repExitAmountLabel}>
							<CurrencyValue value={effectiveRepExitMode === 'redeem' ? redeemableRepAmount : queuedWithdrawRepLimit} suffix={UI_STRING_REP} />
						</MetricField>
						{(() => {
							if (effectiveRepExitMode === 'redeem')
								return (
									<MetricField className='entity-metric' label={UI_STRING_ESCROWED_REP}>
										<CurrencyValue value={currentSelectedVaultDetails?.escalationEscrowedRep} suffix={UI_STRING_REP} />
									</MetricField>
								)
							if (oraclePriceValidUntilTimestamp === undefined) return undefined

							return (
								<MetricField className='entity-metric' label={UI_STRING_PRICE_VALID_UNTIL}>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)
						})()}
					</div>
				)}
				{effectiveRepExitMode === 'redeem' ? null : (
					<label className='field'>
						<span>{UI_STRING_REP_WITHDRAW_AMOUNT}</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
							<button
								className='quiet field-inline-action'
								type='button'
								onClick={() => {
									if (queuedWithdrawRepLimit === undefined) return
									onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(queuedWithdrawRepLimit) })
								}}
								disabled={queuedWithdrawRepLimit === undefined || !poolCollateralActionsEnabled}
							>
								{UI_STRING_MAX}
							</button>
						</div>
					</label>
				)}
				{effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField()}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={repExitActionLabel}
						pendingLabel={effectiveRepExitMode === 'redeem' ? UI_STRING_REDEEMING_REP : UI_STRING_QUEUEING_REP_WITHDRAWAL}
						onClick={effectiveRepExitMode === 'redeem' ? onRedeemRep : onWithdrawRep}
						pending={effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRep' : securityVaultActiveAction === 'queueWithdrawRep'}
						tone='secondary'
						availability={{
							disabled: !repExitEnabled || !canUseLoadedVaultActions || (effectiveRepExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
							reason: canUseLoadedVaultActions ? repExitGuardMessage : undefined,
						}}
					/>
				</div>
				{effectiveRepExitMode === 'redeem' && currentSelectedVaultDetails?.escalationEscrowedRep !== undefined && currentSelectedVaultDetails.escalationEscrowedRep > 0n ? <p className='detail'>{UI_STRING_WITHDRAW_ESCALATION_DEPOSITS}</p> : undefined}
			</SectionBlock>

			<ErrorNotice message={securityVaultError} />
		</>
	)
	const sections = (
		<>
			{showLookupSection ? (
				<SectionBlock title={UI_STRING_VAULT_LOOKUP}>
					{vaultLoadNotice}
					<LookupFieldRow
						label={UI_STRING_SELECTED_VAULT_ADDRESS}
						value={normalizedSecurityVaultForm.selectedVaultAddress}
						onInput={selectedVaultAddressInput => onSecurityVaultFormChange({ selectedVaultAddress: selectedVaultAddressInput })}
						placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER}
						action={
							<button className='secondary' onClick={() => onLoadSecurityVault()} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? <LoadingText>{UI_STRING_REFRESHING}</LoadingText> : UI_STRING_REFRESH}
							</button>
						}
					/>
					{showSecurityPoolAddressInput ? (
						<label className='field'>
							<span>{UI_STRING_SECURITY_POOL_ADDRESS}</span>
							<FormInput value={normalizedSecurityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER} />
						</label>
					) : undefined}
				</SectionBlock>
			) : undefined}

			{showSummarySection && currentSelectedVaultDetails !== undefined && vaultExistsOnchain ? (
				<SelectedVaultSummarySection
					repPerEthPrice={repPerEthPrice}
					repPerEthSource={repPerEthSource}
					repPerEthSourceUrl={repPerEthSourceUrl}
					securityBondAllowance={securityBondAllowance}
					securityVaultDetails={currentSelectedVaultDetails}
					selectedPoolSecurityMultiplier={selectedPoolSecurityMultiplier}
					selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
				/>
			) : undefined}

			{actionSections}
		</>
	)
	if (compactLayout) return sections
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRING_SECURITY_VAULT}>
			{sections}
		</RouteWorkflowPanel>
	)
}
