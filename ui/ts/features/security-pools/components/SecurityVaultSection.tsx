import * as commonCopy from '../../../copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { AddressValue } from '../../../components/AddressValue.js'
import { ActionLauncherCard } from '../../../components/ActionLauncherCard.js'
import { Badge } from '../../../components/Badge.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { EntityCard } from '../../../components/EntityCard.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { LookupFieldRow } from '../../../components/LookupFieldRow.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { OperationModal } from '../../../components/OperationModal.js'
import { RouteWorkflowPanel } from '../../../components/RouteWorkflowPanel.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { StateHint } from '../../../components/StateHint.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { TokenApprovalControl } from '../../../components/TokenApprovalControl.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionNetworkValue } from '../../../components/TransactionNetworkValue.js'
import { TransactionUniverseValue } from '../../universes/components/TransactionUniverseValue.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { WarningSurface } from '../../../components/WarningSurface.js'
import { normalizeAddress, sameAddress } from '../../../lib/address.js'
import { formatCurrencyBalance, formatCurrencyInputBalance, formatDuration } from '../../../lib/formatters.js'
import { balanceShortage } from '../../../lib/inputs.js'
import { getVaultCollateralizationPercent } from '../../markets/lib/trading.js'
import { tryParseBigIntInput, tryParseRepAmountInput } from '../../markets/lib/marketForm.js'
import { isMainnetChain } from '../../../lib/network.js'
import { resolveOracleOperationEthFunding } from '../../open-oracle/lib/oracleRequestEth.js'
import { getWalletMainnetGuardState } from '../../../lib/actionGuards.js'
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import { getVaultLauncherOwnershipReason, getVaultLauncherWalletReason } from '../lib/securityPoolLabels.js'
import { getVaultDepositGuardMessage, getVaultRedeemRepGuardMessage, getVaultSetSecurityBondAllowanceGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'
import { deriveTokenApprovalRequirement } from '../../../lib/tokenApproval.js'
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
	MIN_SECURITY_VAULT_REP_DEPOSIT,
} from '../lib/securityVault.js'
import type { StagedOracleOperation } from '../../../types/contracts.js'
import type { ReadinessAction, SecurityVaultSectionProps } from '../../types.js'
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
export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityVaultDetails, selectedPoolSecurityMultiplier, selectedVaultIsOwnedByAccount, variant = 'record' }: SelectedVaultSummarySectionProps) {
	const collateralizationPercent = getVaultCollateralizationPercent(securityVaultDetails.repDepositShare, securityBondAllowance, repPerEthPrice)
	const collateralizationTarget = selectedPoolSecurityMultiplier === undefined ? undefined : selectedPoolSecurityMultiplier * 100n * 10n ** 18n

	const summaryTitle = <span>{securityPoolCopy.vaultSummary}</span>

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
						<span>{securityPoolCopy.currentSecurityBondAllowance}</span>
						<strong>
							<CurrencyValue value={securityBondAllowance} suffix={commonCopy.eth} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{commonCopy.repCollateral}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.repDepositShare} suffix={commonCopy.rep} />
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
		<EntityCard badge={<Badge tone={selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}>{selectedVaultIsOwnedByAccount ? securityPoolCopy.owned : securityPoolCopy.readOnlyBadgeLabel}</Badge>} title={securityPoolCopy.selectedVault} variant='record'>
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
					<MetricField label={commonCopy.stagedOperation}>{queuedVaultOperation === undefined ? securityPoolCopy.refreshing : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
					{queuedVaultOperation?.amount === undefined ? null : (
						<MetricField label={commonCopy.amount}>
							<CurrencyValue value={queuedVaultOperation.amount} suffix={commonCopy.rep} />
						</MetricField>
					)}
				</MetricGrid>
				{status === 'manual-queued' ? <p className='detail'>{manualQueuedDescription}</p> : null}
				{onViewStagedOperations === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={onViewStagedOperations}>
							{commonCopy.viewInStagedOperations}
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
					<Badge tone='blocked'>{commonCopy.failed}</Badge>
				</div>
				<p className='detail'>{errorMessage ?? securityPoolCopy.actionRejectedDetail}</p>
				<p className='detail'>{commonCopy.stagedOperationRetryDetail}</p>
			</section>
		)
	if (status === 'executed')
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{executedTitle}</h4>
					</div>
					<Badge tone='ok'>{commonCopy.executed}</Badge>
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
				<Badge tone='muted'>{commonCopy.refreshingWithoutEllipsis}</Badge>
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
	selectedMarketTitle,
	selectedPoolTotalRepDeposit,
	selectedPoolTotalSecurityBondAllowance,
	showHeader = true,
	showLookupSection = true,
	showSecurityPoolAddressInput = true,
	showSummarySection = true,
	poolState,
}: SecurityVaultSectionProps) {
	const [vaultActionModal, setVaultActionModal] = useState<VaultActionModal>(undefined)
	const refreshVaultActionsDescriptionId = useId()
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
	const vaultTransactionContext = [
		...(selectedMarketTitle === undefined ? [] : [{ label: commonCopy.question, value: selectedMarketTitle }]),
		{ label: commonCopy.securityPoolAddress, value: <AddressValue address={currentSelectedVaultDetails?.securityPoolAddress ?? normalizedSecurityVaultForm.securityPoolAddress} /> },
		...(currentSelectedVaultDetails?.universeId === undefined ? [] : [{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={currentSelectedVaultDetails.universeId} /> }]),
		{ label: securityPoolCopy.vault, value: <AddressValue address={selectedVaultAddress === '' ? undefined : selectedVaultAddress} /> },
		{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
	]
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
	const repExitActionLabel = effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemRep : securityPoolCopy.withdrawRep
	const repExitAmountLabel = (() => {
		if (effectiveRepExitMode === 'redeem') return securityPoolCopy.redeemableRep
		if (hasValidOraclePrice) return securityPoolCopy.withdrawableRep
		return securityPoolCopy.repAvailableToQueue
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
	const stagedOperationTimeoutHelpText = stagedOperationTimeoutSeconds === undefined ? securityPoolCopy.selfServiceExecutionTimeoutHelpText : securityPoolCopy.formatManualExecutionTimeoutResolvedDetail(formatDuration(stagedOperationTimeoutSeconds))
	const renderStagedOperationTimeoutField = () => (
		<>
			<label className='field'>
				<span>{commonCopy.manualExecutionTimeout}</span>
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
					<span className='field-inline-action'>{commonCopy.minutes}</span>
				</div>
			</label>
			<p className='detail'>{stagedOperationTimeoutHelpText}</p>
		</>
	)
	const vaultLoadNotice = (() => {
		if (loadingSecurityVault)
			return (
				<p className='detail'>
					<LoadingText>{securityPoolCopy.loadingVault}</LoadingText>
				</p>
			)
		if (securityVaultMissing) return <StateHint presentation={{ key: 'not_found', badgeLabel: commonCopy.notFound, badgeTone: 'blocked', detail: securityPoolCopy.invalidVaultAddressHint }} />

		return undefined
	})()
	const loadedVaultMissingBlocker = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain ? securityPoolCopy.missingVaultDetail : undefined
	const getVaultLauncherBlocker = (action: 'claim-fees' | 'deposit-rep' | 'rep-exit' | 'set-bond-allowance') => {
		const walletGuardState = getWalletMainnetGuardState({
			accountAddress: accountState.address,
			isMainnet,
			walletRequiredReason: getVaultLauncherWalletReason(action, effectiveRepExitMode),
		})
		if (walletGuardState.blocked) return walletGuardState.reason
		if (!selectedVaultIsOwnedByAccount) return getVaultLauncherOwnershipReason(action, effectiveRepExitMode)
		if (!hasLoadedSelectedVaultDetails) return securityPoolCopy.refreshVaultActionsDetail
		if (action === 'deposit-rep') return undefined
		return loadedVaultMissingBlocker
	}
	const depositLauncherBlocker = getVaultLauncherBlocker('deposit-rep')
	const repExitLauncherBlocker = getVaultLauncherBlocker('rep-exit')
	const bondAllowanceLauncherBlocker = getVaultLauncherBlocker('set-bond-allowance')
	const claimFeesLauncherBlocker = getVaultLauncherBlocker('claim-fees')
	const showSharedRefreshVaultBlocker = hasConnectedWallet && selectedVaultIsOwnedByAccount && !hasLoadedSelectedVaultDetails && isMainnet
	const visibleDepositLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : depositLauncherBlocker
	const visibleRepExitLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : repExitLauncherBlocker
	const visibleBondAllowanceLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : bondAllowanceLauncherBlocker
	const visibleClaimFeesLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : claimFeesLauncherBlocker
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
			actionLabel: securityPoolCopy.depositRep,
			key: 'deposit-rep',
			...(depositRepEnabled && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('deposit-rep') } : {}),
			readiness: depositRepEnabled && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(showSharedRefreshVaultBlocker ? { disabledReasonId: refreshVaultActionsDescriptionId } : {}),
			...(visibleDepositLauncherBlocker === undefined ? {} : { blocker: visibleDepositLauncherBlocker }),
			title: securityPoolCopy.depositRep,
		},
		{
			actionLabel: repExitActionLabel,
			description: effectiveRepExitMode === 'redeem' ? securityPoolCopy.repRedemptionDescription : securityPoolCopy.repWithdrawalDescription,
			key: 'rep-exit',
			...(repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('withdraw-rep') } : {}),
			readiness: repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(showSharedRefreshVaultBlocker ? { disabledReasonId: refreshVaultActionsDescriptionId } : {}),
			...(visibleRepExitLauncherBlocker === undefined ? {} : { blocker: visibleRepExitLauncherBlocker }),
			title: repExitActionLabel,
		},
		{
			actionLabel: securityPoolCopy.setBondAllowance,
			description: securityPoolCopy.bondAllowanceWorkflowDescription,
			key: 'set-bond-allowance',
			...(bondAllowanceEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('set-bond-allowance') } : {}),
			readiness: bondAllowanceEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(showSharedRefreshVaultBlocker ? { disabledReasonId: refreshVaultActionsDescriptionId } : {}),
			...(visibleBondAllowanceLauncherBlocker === undefined ? {} : { blocker: visibleBondAllowanceLauncherBlocker }),
			title: securityPoolCopy.setSecurityBondAllowance,
		},
		{
			actionLabel: securityPoolCopy.claimFees,
			key: 'claim-fees',
			...(claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('claim-fees') } : {}),
			readiness: claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(showSharedRefreshVaultBlocker ? { disabledReasonId: refreshVaultActionsDescriptionId } : {}),
			...(visibleClaimFeesLauncherBlocker === undefined ? {} : { blocker: visibleClaimFeesLauncherBlocker }),
			title: securityPoolCopy.claimFees,
		},
		...extraReadinessActions,
	] satisfies ReadinessAction[])
	const actionSections = modalFirst ? (
		<>
			<SectionBlock title={securityPoolCopy.vaultActions} variant='plain'>
				{showMissingVaultNotice ? <StateHint presentation={{ key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail }} /> : undefined}
				{showSharedRefreshVaultBlocker ? (
					<p className='detail' id={refreshVaultActionsDescriptionId}>
						{securityPoolCopy.refreshVaultActionsDetail}
					</p>
				) : undefined}
				<div className='vault-action-launcher-grid'>
					{vaultReadinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<ErrorNotice message={securityVaultError} />
			<OperationModal context={vaultTransactionContext} isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title={securityPoolCopy.depositRep}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p> : null}
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
							<StateHint presentation={{ key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail }} />
						)}
						<label className='field'>
							<span>{securityPoolCopy.repCollateralAmount}</span>
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
									{commonCopy.max}
								</button>
							</div>
						</label>
						<MetricGrid>
							<MetricField label={securityPoolCopy.walletRep}>
								<CurrencyValue value={securityVaultRepBalance} suffix={commonCopy.rep} />
							</MetricField>
						</MetricGrid>
						<TokenApprovalControl
							actionLabel={securityPoolCopy.depositingRep}
							allowanceError={securityVaultRepApproval.error}
							allowanceLoading={securityVaultRepApproval.loading}
							approvedAmount={securityVaultRepApproval.value}
							guardMessage={undefined}
							onApprove={amount => onApproveRep(amount)}
							pending={securityVaultActiveAction === 'approveRep'}
							pendingLabel={commonCopy.approvingRep}
							requiredAmount={depositAmount}
							resetKey={`${currentSelectedVaultDetails.repToken}:${currentSelectedVaultDetails.securityPoolAddress}:${depositAmount?.toString() ?? ''}`}
							tokenSymbol='REP'
							tokenUnits={18}
							disabled={!approveRepEnabled || !canUseLoadedVaultActions}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{commonCopy.cancel}
							</button>
							<TransactionActionButton
								idleLabel={securityPoolCopy.depositRep}
								pendingLabel={securityPoolCopy.depositRepPendingLabel}
								onClick={onDepositRep}
								pending={securityVaultActiveAction === 'depositRep'}
								availability={{ disabled: !depositRepEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal context={vaultTransactionContext} isOpen={vaultActionModal === 'withdraw-rep'} onClose={() => setVaultActionModal(undefined)} title={repExitActionLabel}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{effectiveRepExitMode === 'redeem' ? null : (
							<VaultQueuedOperationStatusCard
								errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? securityPoolCopy.immediateWithdrawalRejectedDetail}
								executedTitle={securityPoolCopy.repWithdrawalExecuted}
								failedTitle={securityPoolCopy.repWithdrawalFailed}
								manualQueuedDescription={commonCopy.manualQueuedOperationDetail}
								missingDescription={commonCopy.transactionStateUnavailableDetail}
								missingTitle={securityPoolCopy.repWithdrawalSubmitted}
								onViewStagedOperations={onViewStagedOperations}
								queuedTitle={securityPoolCopy.repWithdrawalQueued}
								queuedVaultOperation={queuedVaultOperation}
								refreshingDescription={securityPoolCopy.refreshingWithdrawalStatusDetail}
								refreshingTitle={securityPoolCopy.refreshingWithdrawalState}
								status={securityVaultResult?.action === 'queueWithdrawRep' ? queuedVaultOperationStatus : undefined}
								successDescription={securityPoolCopy.immediateWithdrawalSuccessDetail}
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

										return <CurrencyValue value={redeemableRepAmount} suffix={commonCopy.rep} />
									}
									if (queuedWithdrawRepLimit === undefined) return '—'

									return <CurrencyValue value={queuedWithdrawRepLimit} suffix={commonCopy.rep} />
								})()}
							</MetricField>
							{effectiveRepExitMode === 'redeem' ? (
								<MetricField label={commonCopy.escrowedRep}>
									<CurrencyValue value={currentSelectedVaultDetails.escalationEscrowedRep} suffix={commonCopy.rep} />
								</MetricField>
							) : (
								<MetricField label={securityPoolCopy.priceValidUntil}>{oraclePriceValidUntilTimestamp === undefined ? commonCopy.unavailable : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
							)}
						</MetricGrid>
						{effectiveRepExitMode === 'redeem' ? null : (
							<label className='field'>
								<span>{securityPoolCopy.repWithdrawAmount}</span>
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
										{commonCopy.max}
									</button>
								</div>
							</label>
						)}
						{effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField()}
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{commonCopy.cancel}
							</button>
							<TransactionActionButton
								idleLabel={repExitActionLabel}
								pendingLabel={effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemingRep : securityPoolCopy.queueingRepWithdrawal}
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

			<OperationModal context={vaultTransactionContext} isOpen={vaultActionModal === 'set-bond-allowance'} onClose={() => setVaultActionModal(undefined)} title={securityPoolCopy.setBondAllowance}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						<VaultQueuedOperationStatusCard
							errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? securityPoolCopy.immediateBondAllowanceFailureDetail}
							executedTitle={securityPoolCopy.bondAllowanceExecuted}
							failedTitle={securityPoolCopy.bondAllowanceFailed}
							manualQueuedDescription={commonCopy.manualQueuedOperationDetail}
							missingDescription={commonCopy.transactionStateUnavailableDetail}
							missingTitle={securityPoolCopy.bondAllowanceSubmitted}
							onViewStagedOperations={onViewStagedOperations}
							queuedTitle={securityPoolCopy.bondAllowanceQueued}
							queuedVaultOperation={queuedVaultOperation}
							refreshingDescription={securityPoolCopy.refreshingBondAllowanceStatusDetail}
							refreshingTitle={securityPoolCopy.refreshingBondAllowanceState}
							status={securityVaultResult?.action === 'queueSetSecurityBondAllowance' ? queuedVaultOperationStatus : undefined}
							successDescription={securityPoolCopy.immediateBondAllowanceSuccessDetail}
						/>
						<MetricGrid>
							<MetricField label={securityPoolCopy.currentBondAllowance}>
								<CurrencyValue value={currentSelectedVaultDetails.securityBondAllowance} suffix={commonCopy.eth} />
							</MetricField>
							<MetricField label={securityPoolCopy.priceValidUntil}>{oraclePriceValidUntilTimestamp === undefined ? commonCopy.unavailable : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</MetricGrid>
						<label className='field'>
							<span>{securityPoolCopy.securityBondAllowanceAmount}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n || !poolCollateralActionsEnabled}>
									{commonCopy.max}
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{commonCopy.cancel}
							</button>
							<TransactionActionButton
								idleLabel={securityPoolCopy.setSecurityBondAllowance}
								pendingLabel={securityPoolCopy.queueingAllowanceUpdate}
								onClick={onSetSecurityBondAllowance}
								pending={securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: !bondAllowanceEnabled || !canUseLoadedVaultActions || setSecurityBondAllowanceGuardMessage !== undefined, reason: canUseLoadedVaultActions ? setSecurityBondAllowanceGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal context={vaultTransactionContext} isOpen={vaultActionModal === 'claim-fees'} onClose={() => setVaultActionModal(undefined)} title={securityPoolCopy.claimFees}>
				<MetricGrid>
					<MetricField label={securityPoolCopy.claimableFees}>{currentSelectedVaultDetails === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix={commonCopy.eth} />}</MetricField>
					<MetricField label={securityPoolCopy.vault}>{selectedVaultAddress === undefined ? commonCopy.noneSelected : <AddressValue address={selectedVaultAddress} />}</MetricField>
				</MetricGrid>
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
						{commonCopy.cancel}
					</button>
					<TransactionActionButton
						idleLabel={securityPoolCopy.claimFees}
						pendingLabel={securityPoolCopy.claimingFees}
						onClick={onRedeemFees}
						pending={securityVaultActiveAction === 'redeemFees'}
						availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: canUseLoadedVaultActions && !hasClaimableFees ? securityPoolCopy.noClaimableFeesReason : claimFeesLauncherBlocker }}
					/>
				</div>
			</OperationModal>
		</>
	) : (
		<>
			<SectionBlock title={securityPoolCopy.claimFees}>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={securityPoolCopy.claimableFees}>
							<CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix={commonCopy.eth} />
						</MetricField>
					</div>
				)}
				<div className='actions'>
					<TransactionActionButton idleLabel={securityPoolCopy.claimFees} pendingLabel={securityPoolCopy.claimingFees} onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: undefined }} />
				</div>
			</SectionBlock>

			<SectionBlock title={securityPoolCopy.depositRep}>
				<label className='field'>
					<span>{securityPoolCopy.repCollateralAmount}</span>
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
							{commonCopy.max}
						</button>
					</div>
				</label>
				<TokenApprovalControl
					actionLabel={securityPoolCopy.depositingRep}
					allowanceError={securityVaultRepApproval.error}
					allowanceLoading={securityVaultRepApproval.loading}
					approvedAmount={securityVaultRepApproval.value}
					guardMessage={undefined}
					onApprove={amount => onApproveRep(amount)}
					pending={securityVaultActiveAction === 'approveRep'}
					pendingLabel={commonCopy.approvingRep}
					requiredAmount={depositAmount}
					resetKey={`${currentSelectedVaultDetails?.repToken ?? ''}:${currentSelectedVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`}
					tokenSymbol='REP'
					tokenUnits={18}
					disabled={!approveRepEnabled || !canUseLoadedVaultActions}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={securityPoolCopy.depositRep}
						pendingLabel={securityPoolCopy.depositRepPendingLabel}
						onClick={onDepositRep}
						pending={securityVaultActiveAction === 'depositRep'}
						availability={{ disabled: !depositRepEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositGuardMessage : undefined }}
					/>
				</div>
				{(() => {
					if (repBalanceGap !== undefined && repBalanceGap > 0n) return <ErrorNotice message={securityPoolCopy.formatInsufficientRepBalanceDetail(formatCurrencyBalance(repBalanceGap))} />
					if (isDepositBelowMinimum)
						return (
							<p className='detail'>
								{securityPoolCopy.newVaultsRequireAtLeast} <CurrencyValue value={MIN_SECURITY_VAULT_REP_DEPOSIT} suffix={commonCopy.rep} copyable={false} /> {securityPoolCopy.firstDepositTail}
							</p>
						)

					return undefined
				})()}
			</SectionBlock>

			<SectionBlock title={securityPoolCopy.setSecurityBondAllowance}>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p>
				) : (
					<>
						<div className='entity-metric-grid'>
							<MetricField className='entity-metric' label={securityPoolCopy.currentSecurityBondAllowance}>
								<CurrencyValue value={securityBondAllowance} suffix={commonCopy.eth} />
							</MetricField>
							{oraclePriceValidUntilTimestamp === undefined ? undefined : (
								<MetricField className='entity-metric' label={securityPoolCopy.priceValidUntil}>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)}
						</div>
						<label className='field'>
							<span>{securityPoolCopy.securityBondAllowanceAmount}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n || !poolCollateralActionsEnabled}>
									{commonCopy.max}
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={securityPoolCopy.setSecurityBondAllowance}
								pendingLabel={securityPoolCopy.queueingAllowanceUpdate}
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
					<p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={repExitAmountLabel}>
							<CurrencyValue value={effectiveRepExitMode === 'redeem' ? redeemableRepAmount : queuedWithdrawRepLimit} suffix={commonCopy.rep} />
						</MetricField>
						{(() => {
							if (effectiveRepExitMode === 'redeem')
								return (
									<MetricField className='entity-metric' label={commonCopy.escrowedRep}>
										<CurrencyValue value={currentSelectedVaultDetails?.escalationEscrowedRep} suffix={commonCopy.rep} />
									</MetricField>
								)
							if (oraclePriceValidUntilTimestamp === undefined) return undefined

							return (
								<MetricField className='entity-metric' label={securityPoolCopy.priceValidUntil}>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)
						})()}
					</div>
				)}
				{effectiveRepExitMode === 'redeem' ? null : (
					<label className='field'>
						<span>{securityPoolCopy.repWithdrawAmount}</span>
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
								{commonCopy.max}
							</button>
						</div>
					</label>
				)}
				{effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField()}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={repExitActionLabel}
						pendingLabel={effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemingRep : securityPoolCopy.queueingRepWithdrawal}
						onClick={effectiveRepExitMode === 'redeem' ? onRedeemRep : onWithdrawRep}
						pending={effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRep' : securityVaultActiveAction === 'queueWithdrawRep'}
						tone='secondary'
						availability={{
							disabled: !repExitEnabled || !canUseLoadedVaultActions || (effectiveRepExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
							reason: canUseLoadedVaultActions ? repExitGuardMessage : undefined,
						}}
					/>
				</div>
				{effectiveRepExitMode === 'redeem' && currentSelectedVaultDetails?.escalationEscrowedRep !== undefined && currentSelectedVaultDetails.escalationEscrowedRep > 0n ? <p className='detail'>{securityPoolCopy.escalationWithdrawalRequiredDetail}</p> : undefined}
			</SectionBlock>

			<ErrorNotice message={securityVaultError} />
		</>
	)
	const sections = (
		<>
			{showLookupSection ? (
				<SectionBlock title={securityPoolCopy.vaultLookup}>
					{vaultLoadNotice}
					<LookupFieldRow
						label={securityPoolCopy.selectedVaultAddress}
						value={normalizedSecurityVaultForm.selectedVaultAddress}
						onInput={selectedVaultAddressInput => onSecurityVaultFormChange({ selectedVaultAddress: selectedVaultAddressInput })}
						placeholder={commonCopy.hexValuePlaceholder}
						action={
							<button className='secondary' onClick={() => onLoadSecurityVault()} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? <LoadingText>{securityPoolCopy.refreshing}</LoadingText> : commonCopy.refresh}
							</button>
						}
					/>
					{showSecurityPoolAddressInput ? (
						<label className='field'>
							<span>{commonCopy.securityPoolAddress}</span>
							<FormInput value={normalizedSecurityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder={commonCopy.hexValuePlaceholder} />
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
		<RouteWorkflowPanel showHeader={showHeader} title={securityPoolCopy.securityVault}>
			{sections}
		</RouteWorkflowPanel>
	)
}
