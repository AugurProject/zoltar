import { CoverageOfferForm } from './CoverageOfferForm.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { VaultOperationTimeoutField } from './VaultOperationTimeoutField.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { balanceShortage } from '@zoltar/ui-core-shared/forms/inputs.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { tryParseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getOracleRequestEthGuardMessage, resolveOracleOperationEthFunding } from '../../open-oracle/lib/oracleRequestEth.js'
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import { isVaultHealthyAtFactor } from '../lib/liquidation.js'
import { getTargetHealthFactorGuardMessage, getVaultDepositGuardMessage, getVaultRedeemRepGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'
import {
	buildVaultReadinessActions,
	getMaximumWithdrawableAttoRep,
	getVaultActionDisabledReasonId,
	getVaultActionsLoadBlocker,
	getVaultDepositAmountNotice,
	getVaultLauncherBlocker,
	getVaultLifecycleBlocker,
	getVaultLookupActionLabel,
	getVaultRepExitActionLabel,
	getVaultRepExitAmountLabel,
	type VaultActionModal,
	type VaultLauncherBlockerContext,
} from '../lib/securityVaultAvailability.js'
import { deriveTokenApprovalRequirement } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import {
	DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES,
	doesSecurityVaultExistOnchain,
	doesLoadedSecurityVaultMatchSelection,
	getSecurityVaultWithdrawableRepAmount,
	getSelectedVaultOwner,
	hasValidSecurityVaultOraclePrice,
	isSecurityVaultDepositBelowMinimum,
	isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper,
	MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP,
} from '../lib/securityVault.js'
import type { SecurityVaultSectionProps } from '../../types.js'
import { DepositBackingFactorField, VaultBackingFactorForm, VaultBackingFactorModal } from './VaultBackingFactorForm.js'
import { SelectedVaultSummarySection } from './SelectedVaultSummarySection.js'
import { VaultQueuedOperationStatusCards } from './VaultQueuedOperationStatusCard.js'
import { VaultActionLaunchers, VaultDepositAmountField, VaultDepositApprovalControl, VaultRepExitActionButton, VaultRepWithdrawAmountField } from './SecurityVaultActionFields.js'

export function SecurityVaultSection({
	accountState,
	compactLayout = false,
	autoLoadVault = false,
	extraReadinessActions = [],
	loadingSecurityVault,
	modalFirst = false,
	onApproveRep,
	onAdjustVaultBackingFactor,
	onDepositRepToVault,
	onLoadSecurityVault,
	onRedeemFees,
	onRedeemRepFromVault,
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
	walletRepBalanceAttoRep,
	walletRepBalanceError,
	walletRepBalanceLoading = false,
	securityVaultResult,
	securityVaultQueuedOperations = [],
	selectedPoolStatoblastSecurityMultiplierBps,
	selectedMarketTitle,
	showHeader = true,
	showLookupSection = true,
	showSecurityPoolAddressInput = true,
	showSummarySection = true,
	poolState,
}: SecurityVaultSectionProps) {
	const currentTimestamp = useChainTimestamp()
	const [vaultActionModal, setVaultActionModal] = useState<VaultActionModal | undefined>(undefined)
	const closeVaultActionModal = () => setVaultActionModal(undefined)
	const refreshVaultActionsDescriptionId = useId()
	const vaultLifecycleBlockerId = useId()
	const isOnActiveAppChain = isActiveAppChain(accountState?.chainId)
	const normalizedSecurityVaultForm = {
		depositAmount: securityVaultForm.depositAmount ?? '0',
		repWithdrawAmount: securityVaultForm.repWithdrawAmount ?? '0',
		targetHealthFactor: securityVaultForm.targetHealthFactor ?? '0',
		securityPoolAddress: securityVaultForm.securityPoolAddress ?? '',
		selectedVaultOwner: securityVaultForm.selectedVaultOwner ?? '',
		stagedOperationTimeoutMinutes: securityVaultForm.stagedOperationTimeoutMinutes ?? DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString(),
	}
	const selectedVaultOwner = getSelectedVaultOwner(normalizedSecurityVaultForm.selectedVaultOwner, accountState.address)
	const currentSelectedVaultDetails = doesLoadedSecurityVaultMatchSelection({
		accountAddress: accountState.address,
		securityPoolAddress: normalizedSecurityVaultForm.securityPoolAddress,
		securityVaultDetails,
		selectedVaultOwner: normalizedSecurityVaultForm.selectedVaultOwner,
	})
		? securityVaultDetails
		: undefined
	const minimumBps = selectedPoolStatoblastSecurityMultiplierBps
	const depositTargetHealthFactor = currentSelectedVaultDetails?.targetBackingFactorBps ? formatCurrencyInputBalance(currentSelectedVaultDetails.targetBackingFactorBps, 4) : normalizedSecurityVaultForm.targetHealthFactor
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultOwner, accountState.address)
	const repTokenSymbol = currentSelectedVaultDetails?.repTokenSymbol ?? commonCopy.rep
	const depositRepActionLabel = securityPoolCopy.formatDepositRepToVault(repTokenSymbol)
	const vaultTransactionContext = [
		...(selectedMarketTitle === undefined ? [] : [{ label: commonCopy.question, value: selectedMarketTitle }]),
		{ label: commonCopy.securityPoolAddress, value: <AddressValue address={currentSelectedVaultDetails?.securityPoolAddress ?? normalizedSecurityVaultForm.securityPoolAddress} /> },
		{ label: securityPoolCopy.vault, value: <AddressValue address={selectedVaultOwner === '' ? undefined : selectedVaultOwner} /> },
	]
	const depositAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.depositAmount)
	const withdrawAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.repWithdrawAmount)
	const stagedOperationTimeoutMinutes = tryParseBigIntInput(normalizedSecurityVaultForm.stagedOperationTimeoutMinutes)
	const capacityOwnershipAttoRep = currentSelectedVaultDetails?.capacityOwnershipAttoRep ?? 0n
	const vaultExistsOnchain = doesSecurityVaultExistOnchain(currentSelectedVaultDetails)
	const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(currentSelectedVaultDetails?.managerAddress, oracleManagerDetails, currentTimestamp)
	const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? oracleManagerDetails?.priceValidUntilTimestamp : undefined
	const currentVaultIsHealthy =
		currentSelectedVaultDetails === undefined || currentSelectedVaultDetails.openInterestAttoEth === undefined || repPerEthPrice === undefined || selectedPoolStatoblastSecurityMultiplierBps === undefined
			? undefined
			: isVaultHealthyAtFactor({
					disputeStakedAttoRep: currentSelectedVaultDetails.disputeStakedAttoRep,
					healthFactorBps: 10_000n,
					openInterestAttoEth: currentSelectedVaultDetails.openInterestAttoEth,
					poolHeldVaultRepBackingAttoRep: currentSelectedVaultDetails.vaultAttoRepBacking,
					poolSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps,
					repPerEthPrice,
				})
	const approvalRequirement = deriveTokenApprovalRequirement(depositAmount, securityVaultRepApproval.value)
	const walletRepShortfallAttoRep = balanceShortage(depositAmount, walletRepBalanceAttoRep)
	const withdrawableRepAmountAttoRep = getSecurityVaultWithdrawableRepAmount({
		disputeStakedAttoRep: currentSelectedVaultDetails?.disputeStakedAttoRep,
		vaultAttoRepBacking: currentSelectedVaultDetails?.vaultAttoRepBacking,
		repPerEthPrice,
		openInterestAttoEth: currentSelectedVaultDetails?.openInterestAttoEth,
		statoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps,
	})
	const maximumWithdrawableAttoRep = getMaximumWithdrawableAttoRep({
		disputeStakedAttoRep: currentSelectedVaultDetails?.disputeStakedAttoRep,
		repPerEthPrice,
		vaultAttoRepBacking: currentSelectedVaultDetails?.vaultAttoRepBacking,
		withdrawableRepAmountAttoRep,
	})
	const minimumVaultRepDepositAttoRep = currentSelectedVaultDetails?.minimumVaultRepDepositAttoRep ?? MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP
	const isDepositBelowMinimum = isSecurityVaultDepositBelowMinimum(currentSelectedVaultDetails?.vaultAttoRepBacking, depositAmount, minimumVaultRepDepositAttoRep)
	const hasClaimableFees = currentSelectedVaultDetails !== undefined && currentSelectedVaultDetails.claimableFeesAttoEth > 0n
	const hasSufficientDepositAllowance = selectedVaultIsOwnedByAccount && depositAmount !== undefined && depositAmount > 0n && approvalRequirement.hasSufficientApproval
	const hasInsufficientRepBalance = walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n
	const hasPositiveDepositAmount = depositAmount !== undefined && depositAmount > 0n
	const hasPositiveWithdrawAmount = withdrawAmount !== undefined && withdrawAmount > 0n
	const redeemableRepAmountAttoRep = currentSelectedVaultDetails?.vaultAttoRepBacking
	const hasWithdrawableRep = maximumWithdrawableAttoRep !== undefined && maximumWithdrawableAttoRep > 0n
	const depositRepToVaultEnabled = poolState?.actions.depositRepToVault.enabled ?? true
	const queueWithdrawRepEnabled = poolState?.actions.queueWithdrawRep.enabled ?? true
	const redeemRepFromVaultEnabled = poolState?.actions.redeemRepFromVault.enabled === true
	const approveRepEnabled = poolState?.actions.approveRep.enabled ?? true
	const claimFeesEnabled = poolState?.actions.redeemFees.enabled ?? true
	const vaultLifecycleBlocker = getVaultLifecycleBlocker(poolState)
	const effectiveRepExitMode = redeemRepFromVaultEnabled ? 'redeem' : 'withdraw'
	const repExitEnabled = effectiveRepExitMode === 'redeem' ? redeemRepFromVaultEnabled : queueWithdrawRepEnabled
	const repExitActionLabel = getVaultRepExitActionLabel(effectiveRepExitMode, repTokenSymbol)
	const repExitAmountLabel = getVaultRepExitAmountLabel(effectiveRepExitMode, hasValidOraclePrice)
	const depositGuardMessage = getVaultDepositGuardMessage({
		approvalSatisfied: hasSufficientDepositAllowance,
		depositAmount,
		isDepositBelowMinimum,
		minimumVaultRepDepositAttoRep,
		targetHealthFactor: depositTargetHealthFactor,
		minimumBackingRatioBps: selectedPoolStatoblastSecurityMultiplierBps,
		walletRepShortfallAttoRep: hasInsufficientRepBalance ? walletRepShortfallAttoRep : undefined,
	})
	const targetHealthFactorGuardMessage = hasPositiveDepositAmount ? getTargetHealthFactorGuardMessage(depositTargetHealthFactor, selectedPoolStatoblastSecurityMultiplierBps) : undefined
	const depositActionGuardMessage = targetHealthFactorGuardMessage === undefined ? (depositGuardMessage ?? (!hasPositiveDepositAmount ? commonCopy.positiveAmountRequired : undefined)) : undefined
	const depositAmountNotice = getVaultDepositAmountNotice({ depositAmount, isDepositBelowMinimum, minimumVaultRepDepositAttoRep, walletRepShortfallAttoRep })
	const withdrawRepFunding = resolveOracleOperationEthFunding({
		managerDetails: oracleManagerDetails,
		priceUsable: hasValidOraclePrice,
	})
	const withdrawRepGuardMessage = getVaultWithdrawGuardMessage({
		bufferRequiredEthCost: withdrawRepFunding?.includeBuffer === true,
		disputeStakedAttoRep: currentSelectedVaultDetails?.disputeStakedAttoRep,
		requiredCostAttoEth: withdrawRepFunding?.costAttoEth,
		stagedOperationTimeoutMinutes,
		withdrawAmount,
		withdrawableRepAmountAttoRep: maximumWithdrawableAttoRep,
		walletBalanceAttoEth: accountState.ethBalanceAttoEth,
	})
	const redeemRepFromVaultGuardMessage = getVaultRedeemRepGuardMessage({
		disputeStakedAttoRep: currentSelectedVaultDetails?.disputeStakedAttoRep,
		redeemableRepAmountAttoRep,
	})
	const repExitGuardMessage = effectiveRepExitMode === 'redeem' ? redeemRepFromVaultGuardMessage : withdrawRepGuardMessage
	const hasConnectedWallet = accountState.address !== undefined
	const canUseOwnedVaultActions = selectedVaultIsOwnedByAccount && hasConnectedWallet
	const hasLoadedSelectedVaultDetails = currentSelectedVaultDetails !== undefined
	const canUseLoadedVaultActions = canUseOwnedVaultActions && hasLoadedSelectedVaultDetails && isOnActiveAppChain
	const showMissingVaultNotice = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain
	const autoLoadKey = `${normalizeAddress(selectedVaultOwner) ?? ''}:${normalizeAddress(normalizedSecurityVaultForm.securityPoolAddress) ?? ''}`
	const hasLoadedCurrentVault = currentSelectedVaultDetails !== undefined && sameAddress(currentSelectedVaultDetails.vaultAddress, selectedVaultOwner) && sameAddress(currentSelectedVaultDetails.securityPoolAddress, normalizedSecurityVaultForm.securityPoolAddress)
	const lastAutoLoadKey = useRef<string | undefined>(securityVaultError === undefined ? undefined : autoLoadKey)
	const operationResults = securityVaultResult === undefined || securityVaultQueuedOperations.some(result => result.hash === securityVaultResult.hash) ? securityVaultQueuedOperations : [...securityVaultQueuedOperations, securityVaultResult]
	const operationStatusProps = { results: operationResults, oracleManagerDetails, selectedVaultOwner: selectedVaultOwner ?? '', loadingSecurityVault, onViewStagedOperations }

	const stagedOperationTimeoutField = <VaultOperationTimeoutField value={normalizedSecurityVaultForm.stagedOperationTimeoutMinutes} disabled={!queueWithdrawRepEnabled} onChange={stagedOperationTimeoutMinutes => onSecurityVaultFormChange({ stagedOperationTimeoutMinutes })} />
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
	const vaultLookupActionLabel = getVaultLookupActionLabel(securityVaultError)
	const loadedVaultMissingBlocker = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain ? securityPoolCopy.missingVaultDetail : undefined
	const vaultActionsLoadBlocker = getVaultActionsLoadBlocker({ autoLoadVault, hasLoadedSelectedVaultDetails, loadingSecurityVault, securityVaultError })
	const launcherBlockerContext: VaultLauncherBlockerContext = {
		accountAddress: accountState.address,
		hasLoadedSelectedVaultDetails,
		isOnActiveAppChain,
		loadedVaultMissingBlocker,
		repExitMode: effectiveRepExitMode,
		selectedVaultIsOwnedByAccount,
		vaultActionsLoadBlocker,
		vaultExistsOnchain,
		walletRepBalanceAttoRep,
	}
	const depositLauncherBlocker = getVaultLauncherBlocker('deposit-rep', launcherBlockerContext)
	const repExitLauncherBlocker = getVaultLauncherBlocker('rep-exit', launcherBlockerContext)
	const claimFeesLauncherBlocker = getVaultLauncherBlocker('claim-fees', launcherBlockerContext)
	const showSharedRefreshVaultBlocker = vaultActionsLoadBlocker !== undefined && hasConnectedWallet && selectedVaultIsOwnedByAccount && isOnActiveAppChain
	const disabledReasonIdContext = { refreshVaultActionsDescriptionId, showSharedRefreshVaultBlocker, vaultLifecycleBlocker, vaultLifecycleBlockerId }
	const depositDisabledReasonId = getVaultActionDisabledReasonId({ ...disabledReasonIdContext, lifecycleActionEnabled: depositRepToVaultEnabled })
	const repExitDisabledReasonId = getVaultActionDisabledReasonId({ ...disabledReasonIdContext, lifecycleActionEnabled: repExitEnabled })
	const claimFeesDisabledReasonId = getVaultActionDisabledReasonId({ ...disabledReasonIdContext, lifecycleActionEnabled: claimFeesEnabled })
	const visibleDepositLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : depositLauncherBlocker
	const visibleRepExitLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : repExitLauncherBlocker
	const visibleClaimFeesLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : claimFeesLauncherBlocker
	const claimFeesAvailabilityBlocker = visibleClaimFeesLauncherBlocker ?? (hasLoadedSelectedVaultDetails && claimFeesEnabled && !hasClaimableFees ? securityPoolCopy.noClaimableFeesReason : undefined)
	useEffect(() => {
		if (!autoLoadVault) return
		if (normalizedSecurityVaultForm.securityPoolAddress.trim() === '') return
		if (selectedVaultOwner === undefined || selectedVaultOwner === '') return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastAutoLoadKey.current === autoLoadKey) return
		lastAutoLoadKey.current = autoLoadKey
		void onLoadSecurityVault()
	}, [autoLoadKey, autoLoadVault, hasLoadedCurrentVault, loadingSecurityVault, normalizedSecurityVaultForm.securityPoolAddress, onLoadSecurityVault, selectedVaultOwner])
	const adjustmentBlocker = repExitLauncherBlocker ?? vaultLifecycleBlocker ?? (!depositRepToVaultEnabled ? securityPoolCopy.vaultDepositAdmissionClosedDetail : undefined)
	const adjustmentForm = (
		<>
			<VaultBackingFactorForm
				executionRepPerEthPrice={hasValidOraclePrice ? oracleManagerDetails?.lastPrice : undefined}
				repPerEthPrice={repPerEthPrice}
				poolSecurityMultiplierBps={selectedPoolStatoblastSecurityMultiplierBps}
				key={autoLoadKey}
				details={currentSelectedVaultDetails}
				blocker={adjustmentBlocker ?? getOracleRequestEthGuardMessage({ actionLabel: securityPoolCopy.queueTargetChangeFundingAction, includeBuffer: withdrawRepFunding?.includeBuffer === true, requiredCostAttoEth: withdrawRepFunding?.costAttoEth, walletBalanceAttoEth: accountState.ethBalanceAttoEth })}
				busy={securityVaultActiveAction !== undefined}
				pending={securityVaultActiveAction === 'adjustVaultBackingFactor'}
				onAdjust={onAdjustVaultBackingFactor}
			/>
		</>
	)
	const vaultReadinessActions = getSecurityPoolVaultReadinessActions([
		...buildVaultReadinessActions({
			adjustmentBlocker,
			canUseLoadedVaultActions,
			claimFeesAvailabilityBlocker,
			claimFeesDisabledReasonId,
			claimFeesEnabled,
			claimFeesLauncherBlocker,
			depositDisabledReasonId,
			depositRepActionLabel,
			depositRepToVaultEnabled,
			hasClaimableFees,
			onOpenModal: setVaultActionModal,
			repExitActionLabel,
			repExitDisabledReasonId,
			repExitEnabled,
			repExitMode: effectiveRepExitMode,
			showSharedRefreshVaultBlocker,
			vaultExistsOnchain,
			visibleDepositLauncherBlocker,
			visibleRepExitLauncherBlocker,
		}),
		...extraReadinessActions,
	])
	const depositAmountField = <VaultDepositAmountField disabled={!depositRepToVaultEnabled} onChange={depositAmount => onSecurityVaultFormChange({ depositAmount })} value={normalizedSecurityVaultForm.depositAmount} walletRepBalanceAttoRep={walletRepBalanceAttoRep} />
	const savedBackingFactor = !!currentSelectedVaultDetails?.targetBackingFactorBps
	const depositBackingFactorField = <DepositBackingFactorField minimumBps={minimumBps} value={depositTargetHealthFactor} error={targetHealthFactorGuardMessage} disabled={!depositRepToVaultEnabled} onChange={targetHealthFactor => onSecurityVaultFormChange({ targetHealthFactor })} />
	const savedBackingFactorMetric = <MetricField label={securityPoolCopy.vaultBackingFactor}>{depositTargetHealthFactor}×</MetricField>
	const depositApprovalControlProps = {
		approveRepEnabled,
		canUseLoadedVaultActions,
		currentSelectedVaultDetails,
		depositActionGuardMessage,
		depositAmount,
		depositAmountNotice,
		depositGuardMessage,
		depositRepActionLabel,
		depositRepToVaultEnabled,
		hasPositiveDepositAmount,
		onApproveRep,
		onDepositRepToVault,
		repTokenSymbol,
		securityVaultActiveAction,
		securityVaultRepApproval,
	}
	const repWithdrawAmountField =
		effectiveRepExitMode === 'redeem' ? null : <VaultRepWithdrawAmountField disabled={!queueWithdrawRepEnabled} maximumWithdrawableAttoRep={maximumWithdrawableAttoRep} onChange={repWithdrawAmount => onSecurityVaultFormChange({ repWithdrawAmount })} value={normalizedSecurityVaultForm.repWithdrawAmount} />
	const repExitActionButton = (
		<VaultRepExitActionButton
			canUseLoadedVaultActions={canUseLoadedVaultActions}
			hasPositiveWithdrawAmount={hasPositiveWithdrawAmount}
			hasWithdrawableRep={hasWithdrawableRep}
			onRedeemRepFromVault={onRedeemRepFromVault}
			onWithdrawRep={onWithdrawRep}
			repExitActionLabel={repExitActionLabel}
			repExitEnabled={repExitEnabled}
			repExitGuardMessage={repExitGuardMessage}
			repExitMode={effectiveRepExitMode}
			securityVaultActiveAction={securityVaultActiveAction}
		/>
	)
	const selectedVaultSummaryProps = { repPerEthPrice, repPerEthSource, repPerEthSourceUrl, currentVaultIsHealthy, selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount }
	const actionSections = modalFirst ? (
		<>
			<VaultActionLaunchers
				refreshVaultActionsDescriptionId={refreshVaultActionsDescriptionId}
				securityVaultError={securityVaultError}
				showMissingVaultNotice={showMissingVaultNotice}
				showSharedRefreshVaultBlocker={showSharedRefreshVaultBlocker}
				vaultActionsLoadBlocker={vaultActionsLoadBlocker}
				vaultLifecycleBlocker={vaultLifecycleBlocker}
				vaultLifecycleBlockerId={vaultLifecycleBlockerId}
				vaultReadinessActions={vaultReadinessActions}
				walletRepBalanceError={vaultActionModal === 'deposit-rep' ? undefined : walletRepBalanceError}
			/>
			<OperationModal closeOnSuccessKey={securityVaultResult?.action === 'depositRepToVault' ? securityVaultResult.hash : undefined} context={vaultTransactionContext} isOpen={vaultActionModal === 'deposit-rep'} onClose={closeVaultActionModal} title={depositRepActionLabel}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{vaultExistsOnchain ? (
							<SelectedVaultSummarySection {...selectedVaultSummaryProps} capacityOwnershipAttoRep={currentSelectedVaultDetails.capacityOwnershipAttoRep} securityVaultDetails={currentSelectedVaultDetails} variant='embedded' />
						) : (
							<StateHint presentation={{ key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail }} />
						)}
						{depositAmountField}
						{savedBackingFactor ? undefined : depositBackingFactorField}
						<MetricGrid>
							{savedBackingFactor ? savedBackingFactorMetric : undefined}
							<MetricField label={securityPoolCopy.walletRep}>{walletRepBalanceLoading ? <LoadingText>{commonCopy.loading}</LoadingText> : <CurrencyValue value={walletRepBalanceAttoRep} suffix={repTokenSymbol} />}</MetricField>
						</MetricGrid>
						<ErrorNotice message={walletRepBalanceError} />
						<VaultDepositApprovalControl {...depositApprovalControlProps} onCancel={closeVaultActionModal} />
					</>
				)}
			</OperationModal>
			<OperationModal
				closeOnSuccessKey={(securityVaultResult?.action === 'queueWithdrawRep' || securityVaultResult?.action === 'redeemRepFromVault') && securityVaultResult.stagedExecution?.success !== false ? securityVaultResult.hash : undefined}
				context={vaultTransactionContext}
				isOpen={vaultActionModal === 'withdraw-rep'}
				onClose={closeVaultActionModal}
				title={repExitActionLabel}
			>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{effectiveRepExitMode === 'redeem' ? null : <VaultQueuedOperationStatusCards {...operationStatusProps} operation='withdrawRep' />}
						<SelectedVaultSummarySection {...selectedVaultSummaryProps} capacityOwnershipAttoRep={currentSelectedVaultDetails.capacityOwnershipAttoRep} securityVaultDetails={currentSelectedVaultDetails} variant='embedded' />
						<MetricGrid>
							<MetricField label={repExitAmountLabel}>
								{(() => {
									if (effectiveRepExitMode === 'redeem') {
										if (redeemableRepAmountAttoRep === undefined) return '—'

										return <CurrencyValue value={redeemableRepAmountAttoRep} suffix={commonCopy.rep} />
									}
									if (maximumWithdrawableAttoRep === undefined) return '—'

									return <CurrencyValue value={maximumWithdrawableAttoRep} suffix={commonCopy.rep} />
								})()}
							</MetricField>
							{effectiveRepExitMode === 'redeem' ? (
								<MetricField label={commonCopy.disputeStakedAttoRep}>
									<CurrencyValue value={currentSelectedVaultDetails.disputeStakedAttoRep} suffix={commonCopy.rep} />
								</MetricField>
							) : (
								<MetricField label={securityPoolCopy.priceValidUntil}>{oraclePriceValidUntilTimestamp === undefined ? commonCopy.unavailable : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
							)}
						</MetricGrid>
						{repWithdrawAmountField}
						{effectiveRepExitMode === 'redeem' ? null : stagedOperationTimeoutField}
						<div className='actions'>
							{repExitActionButton}
							<button className='secondary' type='button' onClick={closeVaultActionModal}>
								{commonCopy.cancel}
							</button>
						</div>
					</>
				)}
			</OperationModal>
			<VaultBackingFactorModal context={vaultTransactionContext} isOpen={vaultActionModal === 'adjust-backing'} onClose={closeVaultActionModal} result={securityVaultResult} error={securityVaultError}>
				{adjustmentForm}
			</VaultBackingFactorModal>
			<OperationModal closeOnSuccessKey={securityVaultResult?.action === 'redeemFees' ? securityVaultResult.hash : undefined} context={vaultTransactionContext} isOpen={vaultActionModal === 'claim-fees'} onClose={closeVaultActionModal} title={securityPoolCopy.claimFeesTitle}>
				<MetricGrid>
					<MetricField label={securityPoolCopy.claimableFees}>{currentSelectedVaultDetails === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue exactWhenRoundedToZero value={currentSelectedVaultDetails.claimableFeesAttoEth} suffix={commonCopy.eth} />}</MetricField>
					<MetricField label={securityPoolCopy.vault}>{selectedVaultOwner === undefined ? commonCopy.noneSelected : <AddressValue address={selectedVaultOwner} />}</MetricField>
				</MetricGrid>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={securityPoolCopy.claimFees}
						pendingLabel={securityPoolCopy.claimingFees}
						onClick={onRedeemFees}
						pending={securityVaultActiveAction === 'redeemFees'}
						availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: canUseLoadedVaultActions && !hasClaimableFees ? securityPoolCopy.noClaimableFeesReason : claimFeesLauncherBlocker }}
					/>
					<button className='secondary' type='button' onClick={closeVaultActionModal}>
						{commonCopy.cancel}
					</button>
				</div>
			</OperationModal>
		</>
	) : (
		<>
			<SectionBlock title={securityPoolCopy.adjustVaultBackingFactor} variant='embedded'>
				{adjustmentForm}
			</SectionBlock>
			<SectionBlock title={securityPoolCopy.claimFeesTitle} variant='embedded'>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={securityPoolCopy.claimableFees}>
							<CurrencyValue exactWhenRoundedToZero value={currentSelectedVaultDetails.claimableFeesAttoEth} suffix={commonCopy.eth} />
						</MetricField>
					</div>
				)}
				<div className='actions'>
					<TransactionActionButton idleLabel={securityPoolCopy.claimFees} pendingLabel={securityPoolCopy.claimingFees} onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: undefined }} />
				</div>
			</SectionBlock>

			<SectionBlock title={depositRepActionLabel} variant='embedded'>
				{depositAmountField}
				{savedBackingFactor ? <MetricGrid>{savedBackingFactorMetric}</MetricGrid> : depositBackingFactorField}
				<VaultDepositApprovalControl {...depositApprovalControlProps} />
			</SectionBlock>

			<SectionBlock title={repExitActionLabel} variant='embedded'>
				{(effectiveRepExitMode === 'redeem' ? redeemableRepAmountAttoRep : maximumWithdrawableAttoRep) === undefined ? (
					<p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={repExitAmountLabel}>
							<CurrencyValue value={effectiveRepExitMode === 'redeem' ? redeemableRepAmountAttoRep : maximumWithdrawableAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						{(() => {
							if (effectiveRepExitMode === 'redeem')
								return (
									<MetricField className='entity-metric' label={commonCopy.disputeStakedAttoRep}>
										<CurrencyValue value={currentSelectedVaultDetails?.disputeStakedAttoRep} suffix={commonCopy.rep} />
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
				{repWithdrawAmountField}
				{effectiveRepExitMode === 'redeem' ? null : stagedOperationTimeoutField}
				<div className='actions'>{repExitActionButton}</div>
				{effectiveRepExitMode === 'redeem' && currentSelectedVaultDetails?.disputeStakedAttoRep !== undefined && currentSelectedVaultDetails.disputeStakedAttoRep > 0n ? <p className='detail'>{securityPoolCopy.escalationWithdrawalRequiredDetail}</p> : undefined}
			</SectionBlock>

			<ErrorNotice message={securityVaultError} />
			<ErrorNotice message={walletRepBalanceError} />
		</>
	)
	const sections = (
		<>
			{showLookupSection ? (
				<SectionBlock title={securityPoolCopy.vaultLookup} variant='embedded'>
					{vaultLoadNotice}
					<LookupFieldRow
						label={securityPoolCopy.selectedVaultOwner}
						value={normalizedSecurityVaultForm.selectedVaultOwner}
						onInput={selectedVaultOwnerInput => onSecurityVaultFormChange({ selectedVaultOwner: selectedVaultOwnerInput })}
						placeholder={commonCopy.hexValuePlaceholder}
						action={
							<button className='secondary' onClick={() => onLoadSecurityVault()} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? <LoadingText announce={false}>{securityPoolCopy.refreshing}</LoadingText> : vaultLookupActionLabel}
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

			{showSummarySection && currentSelectedVaultDetails !== undefined && vaultExistsOnchain ? <SelectedVaultSummarySection {...selectedVaultSummaryProps} capacityOwnershipAttoRep={capacityOwnershipAttoRep} securityVaultDetails={currentSelectedVaultDetails} /> : undefined}

			<VaultQueuedOperationStatusCards {...operationStatusProps} operation='adjustVaultBackingFactor' />

			{actionSections}
			{selectedVaultIsOwnedByAccount && currentSelectedVaultDetails !== undefined ? (
				<SectionBlock title={securityPoolCopy.coverageOfferTitle} variant='embedded'>
					<CoverageOfferForm key={`${autoLoadKey}:coverage`} details={currentSelectedVaultDetails} account={accountState.address} blocker={!isOnActiveAppChain ? securityPoolCopy.coverageOfferUnavailable : vaultLifecycleBlocker} onSaved={() => void onLoadSecurityVault()} />
				</SectionBlock>
			) : undefined}
		</>
	)
	if (compactLayout) return sections
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={securityPoolCopy.securityVault}>
			{sections}
		</RouteWorkflowPanel>
	)
}
