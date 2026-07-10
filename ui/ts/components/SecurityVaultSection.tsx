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
import { UI_STRINGS } from '../lib/uiStrings.js'
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
	if (action === 'claim-fees') return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('claim-fees', 'connect-wallet')
	if (action === 'deposit-rep') return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('deposit-rep', 'connect-wallet')
	if (action === 'rep-exit') return repExitMode === 'redeem' ? UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('rep-exit-redeem', 'connect-wallet') : UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('rep-exit-withdraw', 'connect-wallet')
	return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('set-bond-allowance', 'connect-wallet')
}
export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityVaultDetails, selectedPoolSecurityMultiplier, selectedVaultIsOwnedByAccount, variant = 'record' }: SelectedVaultSummarySectionProps) {
	const collateralizationPercent = getVaultCollateralizationPercent(securityVaultDetails.repDepositShare, securityBondAllowance, repPerEthPrice)
	const collateralizationTarget = selectedPoolSecurityMultiplier === undefined ? undefined : selectedPoolSecurityMultiplier * 100n * 10n ** 18n

	const summaryTitle = <span>{UI_STRINGS.securityVaultSection.vaultSummaryTitle}</span>

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
						<span>{UI_STRINGS.securityVaultSection.currentSecurityBondAllowanceLabel}</span>
						<strong>
							<CurrencyValue value={securityBondAllowance} suffix={UI_STRINGS.common.ethSuffix} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{UI_STRINGS.securityVaultSection.repCollateralLabel}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.repDepositShare} suffix={UI_STRINGS.common.repLabel} />
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
		<EntityCard badge={<Badge tone={selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}>{selectedVaultIsOwnedByAccount ? UI_STRINGS.securityVaultSection.ownedBadgeLabel : UI_STRINGS.securityVaultSection.readOnlyBadgeLabel}</Badge>} title={UI_STRINGS.securityVaultSection.selectedVaultTitle} variant='record'>
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
					<MetricField label={UI_STRINGS.securityVaultSection.stagedOperationLabel}>{queuedVaultOperation === undefined ? UI_STRINGS.securityVaultSection.refreshButtonPendingLabel : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
					{queuedVaultOperation?.amount === undefined ? null : (
						<MetricField label={UI_STRINGS.securityVaultSection.repAmountLabel}>
							<CurrencyValue value={queuedVaultOperation.amount} suffix={UI_STRINGS.common.repLabel} />
						</MetricField>
					)}
				</MetricGrid>
				{status === 'manual-queued' ? <p className='detail'>{manualQueuedDescription}</p> : null}
				{onViewStagedOperations === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={onViewStagedOperations}>
							{UI_STRINGS.securityVaultSection.viewInStagedOperationsLabel}
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
					<Badge tone='blocked'>{UI_STRINGS.common.failedBadgeLabel}</Badge>
				</div>
				<p className='detail'>{errorMessage ?? UI_STRINGS.securityVaultSection.securityPoolRejectedActionDetail}</p>
				<p className='detail'>{UI_STRINGS.securityVaultSection.stagedOperationRetryDetail}</p>
			</section>
		)
	if (status === 'executed')
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{executedTitle}</h4>
					</div>
					<Badge tone='ok'>{UI_STRINGS.securityVaultSection.operationExecutedBadgeLabel}</Badge>
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
				<Badge tone='muted'>{UI_STRINGS.securityVaultSection.refreshingBadgeLabel}</Badge>
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
	const repExitActionLabel = effectiveRepExitMode === 'redeem' ? UI_STRINGS.securityVaultSection.redeemRepIdleLabel : UI_STRINGS.securityVaultSection.withdrawRepIdleLabel
	const repExitAmountLabel = (() => {
		if (effectiveRepExitMode === 'redeem') return UI_STRINGS.securityVaultSection.redeemableRepLabel
		if (hasValidOraclePrice) return UI_STRINGS.securityVaultSection.withdrawableRepLabel
		return UI_STRINGS.securityVaultSection.repAvailableToQueueLabel
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
	const stagedOperationTimeoutHelpText = stagedOperationTimeoutSeconds === undefined ? UI_STRINGS.securityVaultSection.manualExecutionTimeoutInvalidDetail : UI_STRINGS.securityVaultSection.manualExecutionTimeoutResolvedDetail(formatDuration(stagedOperationTimeoutSeconds))
	const renderStagedOperationTimeoutField = () => (
		<>
			<label className='field'>
				<span>{UI_STRINGS.securityVaultSection.manualExecutionTimeoutLabel}</span>
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
					<span className='field-inline-action'>{UI_STRINGS.common.minutesLabel}</span>
				</div>
			</label>
			<p className='detail'>{stagedOperationTimeoutHelpText}</p>
		</>
	)
	const vaultLoadNotice = (() => {
		if (loadingSecurityVault)
			return (
				<p className='detail'>
					<LoadingText>{UI_STRINGS.securityVaultSection.loadingVaultDetail}</LoadingText>
				</p>
			)
		if (securityVaultMissing) return <StateHint presentation={{ key: 'not_found', badgeLabel: UI_STRINGS.common.notFoundBadgeLabel, badgeTone: 'blocked', detail: UI_STRINGS.securityVaultSection.tryAnotherPoolAddressDetail }} />

		return undefined
	})()
	const loadedVaultMissingBlocker = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain ? UI_STRINGS.securityVaultSection.missingVaultBlockerDetail : undefined
	const getVaultLauncherBlocker = (action: 'claim-fees' | 'deposit-rep' | 'rep-exit' | 'set-bond-allowance') => {
		const walletGuardState = getWalletMainnetGuardState({
			accountAddress: accountState.address,
			isMainnet,
			walletRequiredReason: getVaultLauncherWalletReason(action, effectiveRepExitMode),
		})
		if (walletGuardState.blocked) return walletGuardState.reason
		if (!selectedVaultIsOwnedByAccount) {
			if (action === 'claim-fees') return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('claim-fees', 'select-own-vault')
			if (action === 'deposit-rep') return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('deposit-rep', 'select-own-vault')
			if (action === 'rep-exit') return effectiveRepExitMode === 'redeem' ? UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('rep-exit-redeem', 'select-own-vault') : UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('rep-exit-withdraw', 'select-own-vault')
			return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('set-bond-allowance', 'select-own-vault')
		}
		if (!hasLoadedSelectedVaultDetails) {
			if (action === 'claim-fees') return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('claim-fees', 'refresh-vault')
			if (action === 'deposit-rep') return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('deposit-rep', 'refresh-vault')
			if (action === 'rep-exit') return effectiveRepExitMode === 'redeem' ? UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('rep-exit-redeem', 'refresh-vault') : UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('rep-exit-withdraw', 'refresh-vault')
			return UI_STRINGS.securityVaultSection.vaultLauncherBlockerReason('set-bond-allowance', 'refresh-vault')
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
			actionLabel: UI_STRINGS.securityVaultSection.depositRepIdleLabel,
			description: UI_STRINGS.securityVaultSection.depositRepActionDescription,
			key: 'deposit-rep',
			...(depositRepEnabled && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('deposit-rep') } : {}),
			readiness: depositRepEnabled && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(depositLauncherBlocker === undefined ? {} : { blocker: depositLauncherBlocker }),
			title: UI_STRINGS.securityVaultSection.depositRepTitle,
		},
		{
			actionLabel: repExitActionLabel,
			description: effectiveRepExitMode === 'redeem' ? UI_STRINGS.securityVaultSection.repExitRedeemDescription : UI_STRINGS.securityVaultSection.repWithdrawQueueDescription,
			key: 'rep-exit',
			...(repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('withdraw-rep') } : {}),
			readiness: repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(repExitLauncherBlocker === undefined ? {} : { blocker: repExitLauncherBlocker }),
			title: repExitActionLabel,
		},
		{
			actionLabel: UI_STRINGS.securityVaultSection.setBondAllowanceIdleLabel,
			description: UI_STRINGS.securityVaultSection.setBondAllowanceActionDescription,
			key: 'set-bond-allowance',
			...(bondAllowanceEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('set-bond-allowance') } : {}),
			readiness: bondAllowanceEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(bondAllowanceLauncherBlocker === undefined ? {} : { blocker: bondAllowanceLauncherBlocker }),
			title: UI_STRINGS.securityVaultSection.setSecurityBondAllowanceTitle,
		},
		{
			actionLabel: UI_STRINGS.securityVaultSection.claimFeesIdleLabel,
			description: UI_STRINGS.securityVaultSection.claimFeesActionDescription,
			key: 'claim-fees',
			...(claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('claim-fees') } : {}),
			readiness: claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(claimFeesLauncherBlocker === undefined ? {} : { blocker: claimFeesLauncherBlocker }),
			title: UI_STRINGS.securityVaultSection.claimFeesTitle,
		},
		...extraReadinessActions,
	] satisfies ReadinessAction[])
	const actionSections = modalFirst ? (
		<>
			<SectionBlock title={UI_STRINGS.securityVaultSection.vaultActionsTitle}>
				{showMissingVaultNotice ? <StateHint presentation={{ key: 'not_found', badgeLabel: UI_STRINGS.securityVaultSection.vaultMissingBadgeLabel, badgeTone: 'muted', detail: UI_STRINGS.securityVaultSection.createVaultByDepositingRepDetail }} /> : undefined}
				<div className='vault-action-launcher-grid'>
					{vaultReadinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<ErrorNotice message={securityVaultError} />
			<OperationModal isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title={UI_STRINGS.securityVaultSection.depositRepTitle}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{UI_STRINGS.securityVaultSection.selectedVaultDetailsUnavailableDetail}</p> : null}
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
							<StateHint presentation={{ key: 'not_found', badgeLabel: UI_STRINGS.securityVaultSection.vaultMissingBadgeLabel, badgeTone: 'muted', detail: UI_STRINGS.securityVaultSection.createVaultByDepositingRepDetail }} />
						)}
						<label className='field'>
							<span>{UI_STRINGS.securityVaultSection.depositRepAmountLabel}</span>
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
									{UI_STRINGS.common.maxLabel}
								</button>
							</div>
						</label>
						<MetricGrid>
							<MetricField label={UI_STRINGS.securityVaultSection.walletRepLabel}>
								<CurrencyValue value={securityVaultRepBalance} suffix={UI_STRINGS.common.repLabel} />
							</MetricField>
						</MetricGrid>
						<TokenApprovalControl
							actionLabel={UI_STRINGS.securityVaultSection.approveRepActionLabel}
							allowanceError={securityVaultRepApproval.error}
							allowanceLoading={securityVaultRepApproval.loading}
							approvedAmount={securityVaultRepApproval.value}
							guardMessage={undefined}
							onApprove={amount => onApproveRep(amount)}
							pending={securityVaultActiveAction === 'approveRep'}
							pendingLabel={UI_STRINGS.securityVaultSection.approvingRepPendingLabel}
							requiredAmount={depositAmount}
							resetKey={`${currentSelectedVaultDetails.repToken}:${currentSelectedVaultDetails.securityPoolAddress}:${depositAmount?.toString() ?? ''}`}
							tokenSymbol='REP'
							tokenUnits={18}
							disabled={!approveRepEnabled || !canUseLoadedVaultActions}
						/>
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: UI_STRINGS.securityVaultSection.ownedChecklistLabel, resolved: selectedVaultIsOwnedByAccount },
								{
									key: 'balance',
									label: UI_STRINGS.securityVaultSection.repBalanceChecklistLabel,
									resolved: repBalanceGap === undefined || repBalanceGap <= 0n,
									...(repBalanceGap !== undefined && repBalanceGap > 0n ? { detail: UI_STRINGS.securityVaultSection.repBalanceShortageDetail(formatCurrencyBalance(repBalanceGap)) } : {}),
								},
								{ key: 'minimum', label: UI_STRINGS.securityVaultSection.firstDepositMinimumChecklistLabel, resolved: !isDepositBelowMinimum, ...(isDepositBelowMinimum ? { detail: UI_STRINGS.securityVaultSection.firstDepositMinimumChecklistDetail(formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)) } : {}) },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{UI_STRINGS.common.cancelLabel}
							</button>
							<TransactionActionButton
								idleLabel={UI_STRINGS.securityVaultSection.depositRepIdleLabel}
								pendingLabel={UI_STRINGS.securityVaultSection.depositRepPendingLabel}
								onClick={onDepositRep}
								pending={securityVaultActiveAction === 'depositRep'}
								availability={{ disabled: !depositRepEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'withdraw-rep'} onClose={() => setVaultActionModal(undefined)} title={repExitActionLabel} description={effectiveRepExitMode === 'redeem' ? UI_STRINGS.securityVaultSection.repExitRedeemDescription : UI_STRINGS.securityVaultSection.repExitWithdrawDescription}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{UI_STRINGS.securityVaultSection.selectedVaultDetailsUnavailableDetail}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{effectiveRepExitMode === 'redeem' ? null : (
							<VaultQueuedOperationStatusCard
								errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? UI_STRINGS.securityVaultSection.repWithdrawalRejectedDetail}
								executedTitle={UI_STRINGS.securityVaultSection.repWithdrawalExecutedTitle}
								failedTitle={UI_STRINGS.securityVaultSection.repWithdrawalFailedTitle}
								manualQueuedDescription={UI_STRINGS.securityVaultSection.oracleManagerAutoExecuteQueueFullDetail}
								missingDescription={UI_STRINGS.securityVaultSection.operationStatusUnavailableDetail}
								missingTitle={UI_STRINGS.securityVaultSection.repWithdrawalSubmittedTitle}
								onViewStagedOperations={onViewStagedOperations}
								queuedTitle={UI_STRINGS.securityVaultSection.repWithdrawalQueuedTitle}
								queuedVaultOperation={queuedVaultOperation}
								refreshingDescription={UI_STRINGS.securityVaultSection.refreshingWithdrawalStateDetail}
								refreshingTitle={UI_STRINGS.securityVaultSection.refreshingWithdrawalStateTitle}
								status={securityVaultResult?.action === 'queueWithdrawRep' ? queuedVaultOperationStatus : undefined}
								successDescription={UI_STRINGS.securityVaultSection.successfulImmediateWithdrawalDetail}
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

										return <CurrencyValue value={redeemableRepAmount} suffix={UI_STRINGS.common.repLabel} />
									}
									if (queuedWithdrawRepLimit === undefined) return '—'

									return <CurrencyValue value={queuedWithdrawRepLimit} suffix={UI_STRINGS.common.repLabel} />
								})()}
							</MetricField>
							{effectiveRepExitMode === 'redeem' ? (
								<MetricField label={UI_STRINGS.securityVaultSection.escalationEscrowedRepLabel}>
									<CurrencyValue value={currentSelectedVaultDetails.escalationEscrowedRep} suffix={UI_STRINGS.common.repLabel} />
								</MetricField>
							) : (
								<MetricField label={UI_STRINGS.securityVaultSection.priceValidUntilLabel}>{oraclePriceValidUntilTimestamp === undefined ? UI_STRINGS.common.unavailableLabel : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
							)}
						</MetricGrid>
						{effectiveRepExitMode === 'redeem' ? null : (
							<label className='field'>
								<span>{UI_STRINGS.securityVaultSection.repWithdrawAmountLabel}</span>
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
										{UI_STRINGS.common.maxLabel}
									</button>
								</div>
							</label>
						)}
						{effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField()}
						<RequirementsChecklist
							items={
								effectiveRepExitMode === 'redeem'
									? [
											{ key: 'owned', label: UI_STRINGS.securityVaultSection.ownedChecklistLabel, resolved: selectedVaultIsOwnedByAccount },
											{
												key: 'locked',
												label: UI_STRINGS.securityVaultSection.noRepLockedChecklistLabel,
												resolved: currentSelectedVaultDetails.escalationEscrowedRep === 0n,
												...(currentSelectedVaultDetails.escalationEscrowedRep > 0n ? { detail: UI_STRINGS.securityVaultSection.noRepLockedChecklistDetail } : {}),
											},
											{ key: 'redeemable', label: UI_STRINGS.securityVaultSection.redeemableRepChecklistLabel, resolved: redeemableRepAmount !== undefined && redeemableRepAmount > 0n },
										]
									: [
											{ key: 'owned', label: UI_STRINGS.securityVaultSection.ownedChecklistLabel, resolved: selectedVaultIsOwnedByAccount },
											{
												key: 'oracle',
												label: hasValidOraclePrice ? UI_STRINGS.securityVaultSection.validOraclePriceChecklistLabel : UI_STRINGS.securityVaultSection.oracleExecutionFundingChecklistLabel,
												resolved: hasValidOraclePrice || withdrawRepFunding !== undefined,
											},
											{
												key: 'withdrawable',
												label: hasValidOraclePrice ? UI_STRINGS.securityVaultSection.withdrawableRepLabel : UI_STRINGS.securityVaultSection.withdrawFundingChecklistLabel,
												resolved: queuedWithdrawRepLimit !== undefined && queuedWithdrawRepLimit > 0n,
											},
											{ key: 'timeout', label: UI_STRINGS.securityVaultSection.timeoutChecklistLabel, resolved: stagedOperationTimeoutSeconds !== undefined },
										]
							}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{UI_STRINGS.common.cancelLabel}
							</button>
							<TransactionActionButton
								idleLabel={repExitActionLabel}
								pendingLabel={effectiveRepExitMode === 'redeem' ? UI_STRINGS.securityVaultSection.redeemRepPendingLabel : UI_STRINGS.securityVaultSection.withdrawRepPendingLabel}
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

			<OperationModal isOpen={vaultActionModal === 'set-bond-allowance'} onClose={() => setVaultActionModal(undefined)} title={UI_STRINGS.securityVaultSection.setBondAllowanceModalTitle} description={UI_STRINGS.securityVaultSection.setSecurityBondAllowanceModalDescription}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{UI_STRINGS.securityVaultSection.selectedVaultDetailsUnavailableDetail}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						<VaultQueuedOperationStatusCard
							errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? UI_STRINGS.securityVaultSection.bondAllowanceRejectedDetail}
							executedTitle={UI_STRINGS.securityVaultSection.bondAllowanceExecutedTitle}
							failedTitle={UI_STRINGS.securityVaultSection.bondAllowanceFailedTitle}
							manualQueuedDescription={UI_STRINGS.securityVaultSection.oracleManagerAutoExecuteQueueFullDetail}
							missingDescription={UI_STRINGS.securityVaultSection.operationStatusUnavailableDetail}
							missingTitle={UI_STRINGS.securityVaultSection.bondAllowanceSubmittedTitle}
							onViewStagedOperations={onViewStagedOperations}
							queuedTitle={UI_STRINGS.securityVaultSection.bondAllowanceQueuedTitle}
							queuedVaultOperation={queuedVaultOperation}
							refreshingDescription={UI_STRINGS.securityVaultSection.refreshingBondAllowanceStateDetail}
							refreshingTitle={UI_STRINGS.securityVaultSection.refreshingBondAllowanceStateTitle}
							status={securityVaultResult?.action === 'queueSetSecurityBondAllowance' ? queuedVaultOperationStatus : undefined}
							successDescription={UI_STRINGS.securityVaultSection.successfulImmediateBondAllowanceDetail}
						/>
						<MetricGrid>
							<MetricField label={UI_STRINGS.securityVaultSection.currentBondAllowanceLabel}>
								<CurrencyValue value={currentSelectedVaultDetails.securityBondAllowance} suffix={UI_STRINGS.common.ethSuffix} />
							</MetricField>
							<MetricField label={UI_STRINGS.securityVaultSection.priceValidUntilLabel}>{oraclePriceValidUntilTimestamp === undefined ? UI_STRINGS.common.unavailableLabel : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</MetricGrid>
						<label className='field'>
							<span>{UI_STRINGS.securityVaultSection.securityBondAllowanceAmountLabel}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n || !poolCollateralActionsEnabled}>
									{UI_STRINGS.common.maxLabel}
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: UI_STRINGS.securityVaultSection.ownedChecklistLabel, resolved: selectedVaultIsOwnedByAccount },
								{ key: 'oracle', label: UI_STRINGS.securityVaultSection.validOraclePriceChecklistLabel, resolved: hasValidOraclePrice },
								{ key: 'allowance', label: UI_STRINGS.securityVaultSection.allowanceChecklistLabel(formatCurrencyBalance(MIN_SECURITY_BOND_ALLOWANCE)), resolved: hasValidSecurityBondAllowanceAmount },
								{ key: 'timeout', label: UI_STRINGS.securityVaultSection.timeoutChecklistLabel, resolved: stagedOperationTimeoutSeconds !== undefined },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{UI_STRINGS.common.cancelLabel}
							</button>
							<TransactionActionButton
								idleLabel={UI_STRINGS.securityVaultSection.setSecurityBondAllowanceIdleLabel}
								pendingLabel={UI_STRINGS.securityVaultSection.setSecurityBondAllowancePendingLabel}
								onClick={onSetSecurityBondAllowance}
								pending={securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: !bondAllowanceEnabled || !canUseLoadedVaultActions || setSecurityBondAllowanceGuardMessage !== undefined, reason: canUseLoadedVaultActions ? setSecurityBondAllowanceGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'claim-fees'} onClose={() => setVaultActionModal(undefined)} title={UI_STRINGS.securityVaultSection.claimFeesTitle} description={UI_STRINGS.securityVaultSection.claimFeesModalDescription}>
				<MetricGrid>
					<MetricField label={UI_STRINGS.securityVaultSection.claimFeesAmountLabel}>{currentSelectedVaultDetails === undefined ? UI_STRINGS.common.metricUnavailablePlaceholder : <CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix={UI_STRINGS.common.ethSuffix} />}</MetricField>
					<MetricField label={UI_STRINGS.securityVaultSection.vaultLabel}>{selectedVaultAddress === undefined ? UI_STRINGS.common.noneSelectedLabel : <AddressValue address={selectedVaultAddress} />}</MetricField>
				</MetricGrid>
				<RequirementsChecklist
					items={[
						{ key: 'owned', label: UI_STRINGS.securityVaultSection.ownedChecklistLabel, resolved: selectedVaultIsOwnedByAccount },
						{ key: 'fees', label: UI_STRINGS.securityVaultSection.hasClaimableFeesChecklistLabel, resolved: hasClaimableFees },
					]}
				/>
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
						{UI_STRINGS.common.cancelLabel}
					</button>
					<TransactionActionButton
						idleLabel={UI_STRINGS.securityVaultSection.claimFeesIdleLabel}
						pendingLabel={UI_STRINGS.securityVaultSection.claimFeesPendingLabel}
						onClick={onRedeemFees}
						pending={securityVaultActiveAction === 'redeemFees'}
						availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: undefined }}
					/>
				</div>
			</OperationModal>
		</>
	) : (
		<>
			<SectionBlock title={UI_STRINGS.securityVaultSection.claimFeesTitle}>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{UI_STRINGS.securityVaultSection.selectedVaultDetailsUnavailableDetail}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={UI_STRINGS.securityVaultSection.claimFeesAmountLabel}>
							<CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix={UI_STRINGS.common.ethSuffix} />
						</MetricField>
					</div>
				)}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={UI_STRINGS.securityVaultSection.claimFeesIdleLabel}
						pendingLabel={UI_STRINGS.securityVaultSection.claimFeesPendingLabel}
						onClick={onRedeemFees}
						pending={securityVaultActiveAction === 'redeemFees'}
						availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: undefined }}
					/>
				</div>
			</SectionBlock>

			<SectionBlock title={UI_STRINGS.securityVaultSection.depositRepTitle}>
				<label className='field'>
					<span>{UI_STRINGS.securityVaultSection.depositRepAmountLabel}</span>
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
							{UI_STRINGS.common.maxLabel}
						</button>
					</div>
				</label>
				<TokenApprovalControl
					actionLabel={UI_STRINGS.securityVaultSection.approveRepActionLabel}
					allowanceError={securityVaultRepApproval.error}
					allowanceLoading={securityVaultRepApproval.loading}
					approvedAmount={securityVaultRepApproval.value}
					guardMessage={undefined}
					onApprove={amount => onApproveRep(amount)}
					pending={securityVaultActiveAction === 'approveRep'}
					pendingLabel={UI_STRINGS.securityVaultSection.approvingRepPendingLabel}
					requiredAmount={depositAmount}
					resetKey={`${currentSelectedVaultDetails?.repToken ?? ''}:${currentSelectedVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`}
					tokenSymbol='REP'
					tokenUnits={18}
					disabled={!approveRepEnabled || !canUseLoadedVaultActions}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={UI_STRINGS.securityVaultSection.depositRepIdleLabel}
						pendingLabel={UI_STRINGS.securityVaultSection.depositRepPendingLabel}
						onClick={onDepositRep}
						pending={securityVaultActiveAction === 'depositRep'}
						availability={{ disabled: !depositRepEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositGuardMessage : undefined }}
					/>
				</div>
				{(() => {
					if (repBalanceGap !== undefined && repBalanceGap > 0n) return <ErrorNotice message={UI_STRINGS.securityVaultSection.insufficientRepBalanceDetail(formatCurrencyBalance(repBalanceGap))} />
					if (isDepositBelowMinimum)
						return (
							<p className='detail'>
								{UI_STRINGS.securityVaultSection.firstDepositMinimumDetailPrefix} <CurrencyValue value={MIN_SECURITY_VAULT_REP_DEPOSIT} suffix={UI_STRINGS.common.repLabel} copyable={false} /> {UI_STRINGS.securityVaultSection.firstDepositMinimumInlineDetailSuffix}
							</p>
						)

					return undefined
				})()}
			</SectionBlock>

			<SectionBlock title={UI_STRINGS.securityVaultSection.setSecurityBondAllowanceTitle}>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{UI_STRINGS.securityVaultSection.selectedVaultDetailsUnavailableDetail}</p>
				) : (
					<>
						<div className='entity-metric-grid'>
							<MetricField className='entity-metric' label={UI_STRINGS.securityVaultSection.currentSecurityBondAllowanceLabel}>
								<CurrencyValue value={securityBondAllowance} suffix={UI_STRINGS.common.ethSuffix} />
							</MetricField>
							{oraclePriceValidUntilTimestamp === undefined ? undefined : (
								<MetricField className='entity-metric' label={UI_STRINGS.securityVaultSection.priceValidUntilLabel}>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)}
						</div>
						<label className='field'>
							<span>{UI_STRINGS.securityVaultSection.securityBondAllowanceAmountLabel}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n || !poolCollateralActionsEnabled}>
									{UI_STRINGS.common.maxLabel}
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={UI_STRINGS.securityVaultSection.setSecurityBondAllowanceIdleLabel}
								pendingLabel={UI_STRINGS.securityVaultSection.setSecurityBondAllowancePendingLabel}
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
					<p className='detail'>{UI_STRINGS.securityVaultSection.selectedVaultDetailsUnavailableDetail}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={repExitAmountLabel}>
							<CurrencyValue value={effectiveRepExitMode === 'redeem' ? redeemableRepAmount : queuedWithdrawRepLimit} suffix={UI_STRINGS.common.repLabel} />
						</MetricField>
						{(() => {
							if (effectiveRepExitMode === 'redeem')
								return (
									<MetricField className='entity-metric' label={UI_STRINGS.securityVaultSection.escalationEscrowedRepLabel}>
										<CurrencyValue value={currentSelectedVaultDetails?.escalationEscrowedRep} suffix={UI_STRINGS.common.repLabel} />
									</MetricField>
								)
							if (oraclePriceValidUntilTimestamp === undefined) return undefined

							return (
								<MetricField className='entity-metric' label={UI_STRINGS.securityVaultSection.priceValidUntilLabel}>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)
						})()}
					</div>
				)}
				{effectiveRepExitMode === 'redeem' ? null : (
					<label className='field'>
						<span>{UI_STRINGS.securityVaultSection.repWithdrawAmountLabel}</span>
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
								{UI_STRINGS.common.maxLabel}
							</button>
						</div>
					</label>
				)}
				{effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField()}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={repExitActionLabel}
						pendingLabel={effectiveRepExitMode === 'redeem' ? UI_STRINGS.securityVaultSection.redeemRepPendingLabel : UI_STRINGS.securityVaultSection.withdrawRepPendingLabel}
						onClick={effectiveRepExitMode === 'redeem' ? onRedeemRep : onWithdrawRep}
						pending={effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRep' : securityVaultActiveAction === 'queueWithdrawRep'}
						tone='secondary'
						availability={{
							disabled: !repExitEnabled || !canUseLoadedVaultActions || (effectiveRepExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
							reason: canUseLoadedVaultActions ? repExitGuardMessage : undefined,
						}}
					/>
				</div>
				{effectiveRepExitMode === 'redeem' && currentSelectedVaultDetails?.escalationEscrowedRep !== undefined && currentSelectedVaultDetails.escalationEscrowedRep > 0n ? <p className='detail'>{UI_STRINGS.securityVaultSection.withdrawEscalationDepositsDetail}</p> : undefined}
			</SectionBlock>

			<ErrorNotice message={securityVaultError} />
		</>
	)
	const sections = (
		<>
			{showLookupSection ? (
				<SectionBlock title={UI_STRINGS.securityVaultSection.vaultLookupTitle}>
					{vaultLoadNotice}
					<LookupFieldRow
						label={UI_STRINGS.securityVaultSection.selectedVaultAddressLabel}
						value={normalizedSecurityVaultForm.selectedVaultAddress}
						onInput={selectedVaultAddressInput => onSecurityVaultFormChange({ selectedVaultAddress: selectedVaultAddressInput })}
						placeholder={UI_STRINGS.securityVaultSection.vaultLookupPlaceholder}
						action={
							<button className='secondary' onClick={() => onLoadSecurityVault()} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? <LoadingText>{UI_STRINGS.securityVaultSection.refreshButtonPendingLabel}</LoadingText> : UI_STRINGS.securityVaultSection.refreshButtonIdleLabel}
							</button>
						}
					/>
					{showSecurityPoolAddressInput ? (
						<label className='field'>
							<span>{UI_STRINGS.securityVaultSection.securityPoolAddressLabel}</span>
							<FormInput value={normalizedSecurityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder={UI_STRINGS.securityVaultSection.securityPoolAddressPlaceholder} />
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
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRINGS.securityVaultSection.securityVaultTitle}>
			{sections}
		</RouteWorkflowPanel>
	)
}
