import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { ActionLauncherCard } from '@zoltar/ui-core-shared/components/ActionLauncherCard.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
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
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionNetworkValue } from '@zoltar/ui-core-shared/components/TransactionNetworkValue.js'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatCurrencyBalance, formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { balanceShortage } from '@zoltar/ui-core-shared/lib/inputs.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js'
import { tryParseRepAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { resolveOracleOperationEthFunding } from '@zoltar/ui-zoltar/features/open-oracle/lib/oracleRequestEth.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/lib/actionGuards.js'
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import { getVaultLauncherVaultOwnerReason, getVaultLauncherWalletReason } from '../lib/securityPoolLabels.js'
import { isVaultHealthyAtFactor } from '../lib/liquidation.js'
import { getTargetHealthFactorGuardMessage, getVaultDepositGuardMessage, getVaultRedeemRepGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'
import { deriveTokenApprovalRequirement } from '@zoltar/ui-core-shared/lib/tokenApproval.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js'
import {
	DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES,
	doesSecurityVaultExistOnchain,
	doesLoadedSecurityVaultMatchSelection,
	getStagedOperationTimeoutSeconds,
	getSecurityVaultWithdrawableRepAmount,
	getSelectedVaultOwner,
	hasValidSecurityVaultOraclePrice,
	isSecurityVaultDepositBelowMinimum,
	isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper,
	MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP,
} from '../lib/securityVault.js'
import type { ReadinessAction, SecurityVaultSectionProps } from '../../types.js'
import { SelectedVaultSummarySection } from './SelectedVaultSummarySection.js'
import { getQueuedVaultOperation, getQueuedVaultOperationStatus, VaultQueuedOperationStatusCard } from './VaultQueuedOperationStatusCard.js'

type VaultActionModal = 'claim-fees' | 'deposit-rep' | 'withdraw-rep' | undefined

export function SecurityVaultSection({
	accountState,
	compactLayout = false,
	autoLoadVault = false,
	extraReadinessActions = [],
	loadingSecurityVault,
	modalFirst = false,
	onApproveRep,
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
	selectedPoolStatoblastSecurityMultiplierBps,
	selectedMarketTitle,
	selectedPoolTotalPoolHeldAttoRep,
	selectedPoolTotalCapacityOwnershipAttoRep,
	showHeader = true,
	showLookupSection = true,
	showSecurityPoolAddressInput = true,
	showSummarySection = true,
	poolState,
}: SecurityVaultSectionProps) {
	const currentTimestamp = useChainTimestamp()
	const [vaultActionModal, setVaultActionModal] = useState<VaultActionModal>(undefined)
	const refreshVaultActionsDescriptionId = useId()
	const vaultLifecycleBlockerId = useId()
	const embeddedTargetHealthFactorDescriptionId = useId()
	const modalTargetHealthFactorDescriptionId = useId()
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
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultOwner, accountState.address)
	const vaultTransactionContext = [
		...(selectedMarketTitle === undefined ? [] : [{ label: commonCopy.question, value: selectedMarketTitle }]),
		{ label: commonCopy.securityPoolAddress, value: <AddressValue address={currentSelectedVaultDetails?.securityPoolAddress ?? normalizedSecurityVaultForm.securityPoolAddress} /> },
		{ label: securityPoolCopy.vault, value: <AddressValue address={selectedVaultOwner === '' ? undefined : selectedVaultOwner} /> },
		{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
	]
	const depositAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.depositAmount)
	const withdrawAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.repWithdrawAmount)
	const stagedOperationTimeoutMinutes = tryParseBigIntInput(normalizedSecurityVaultForm.stagedOperationTimeoutMinutes)
	const stagedOperationTimeoutSeconds = getStagedOperationTimeoutSeconds(stagedOperationTimeoutMinutes)
	const capacityOwnershipAttoRep = currentSelectedVaultDetails?.capacityOwnershipAttoRep ?? 0n
	const vaultExistsOnchain = doesSecurityVaultExistOnchain(currentSelectedVaultDetails)
	const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(currentSelectedVaultDetails?.managerAddress, oracleManagerDetails, currentTimestamp)
	const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? oracleManagerDetails?.priceValidUntilTimestamp : undefined
	const currentVaultIsHealthy =
		currentSelectedVaultDetails === undefined || currentSelectedVaultDetails.openInterestAttoEth === undefined || !hasValidOraclePrice || oracleManagerDetails === undefined || selectedPoolStatoblastSecurityMultiplierBps === undefined
			? undefined
			: isVaultHealthyAtFactor({
					disputeStakedAttoRep: currentSelectedVaultDetails.disputeStakedAttoRep,
					healthFactorBps: 10_000n,
					openInterestAttoEth: currentSelectedVaultDetails.openInterestAttoEth,
					poolHeldVaultRepBackingAttoRep: currentSelectedVaultDetails.vaultAttoRepBacking,
					poolSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps,
					repPerEthPrice: oracleManagerDetails.lastPrice,
				})
	const approvalRequirement = deriveTokenApprovalRequirement(depositAmount, securityVaultRepApproval.value)
	const walletRepShortfallAttoRep = balanceShortage(depositAmount, walletRepBalanceAttoRep)
	const withdrawableRepAmountAttoRep = getSecurityVaultWithdrawableRepAmount({
		disputeStakedAttoRep: currentSelectedVaultDetails?.disputeStakedAttoRep,
		vaultAttoRepBacking: currentSelectedVaultDetails?.vaultAttoRepBacking,
		repPerEthPrice: hasValidOraclePrice ? oracleManagerDetails?.lastPrice : undefined,
		capacityOwnershipAttoRep: currentSelectedVaultDetails?.capacityOwnershipAttoRep,
		statoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps,
		totalPoolHeldAttoRep: selectedPoolTotalPoolHeldAttoRep,
		totalCapacityOwnershipAttoRep: selectedPoolTotalCapacityOwnershipAttoRep,
	})
	const maximumWithdrawableAttoRep = (() => {
		if (currentSelectedVaultDetails !== undefined && currentSelectedVaultDetails.disputeStakedAttoRep > 0n) return 0n
		if (hasValidOraclePrice) return withdrawableRepAmountAttoRep
		return currentSelectedVaultDetails?.vaultAttoRepBacking
	})()
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
	const vaultLifecycleBlocker = (() => {
		if (poolState?.lifecycleState === 'ended') return securityPoolCopy.vaultActionsEndedDetail
		if (poolState?.lifecycleState === 'poolForked' || poolState?.lifecycleState === 'forkMigration') return securityPoolCopy.vaultActionsForkMigrationDetail
		if (poolState?.lifecycleState === 'forkTruthAuction') return securityPoolCopy.vaultActionsTruthAuctionDetail
		if (poolState?.vaultAdmissionClosed) return securityPoolCopy.vaultDepositAdmissionClosedDetail
		if (poolState?.ordinaryEscalationGameStarted) return securityPoolCopy.vaultDepositEscalationStartedDetail
		return undefined
	})()
	const effectiveRepExitMode = redeemRepFromVaultEnabled ? 'redeem' : 'withdraw'
	const repExitEnabled = effectiveRepExitMode === 'redeem' ? redeemRepFromVaultEnabled : queueWithdrawRepEnabled
	const repExitActionLabel = effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemRepFromVault : securityPoolCopy.withdrawRep
	const repExitAmountLabel = (() => {
		if (effectiveRepExitMode === 'redeem') return securityPoolCopy.redeemableAttoRep
		if (hasValidOraclePrice) return securityPoolCopy.withdrawableAttoRep
		return securityPoolCopy.repAvailableToQueue
	})()
	const depositGuardMessage = getVaultDepositGuardMessage({
		approvalSatisfied: hasSufficientDepositAllowance,
		depositAmount,
		isDepositBelowMinimum,
		minimumVaultRepDepositAttoRep,
		targetHealthFactor: normalizedSecurityVaultForm.targetHealthFactor,
		walletRepShortfallAttoRep: hasInsufficientRepBalance ? walletRepShortfallAttoRep : undefined,
	})
	const targetHealthFactorGuardMessage = hasPositiveDepositAmount ? getTargetHealthFactorGuardMessage(normalizedSecurityVaultForm.targetHealthFactor) : undefined
	const depositActionGuardMessage = targetHealthFactorGuardMessage === undefined ? depositGuardMessage : undefined
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
	const queuedVaultOperation = getQueuedVaultOperation({
		pendingOperation: oracleManagerDetails?.pendingOperation,
		selectedVaultOwner: selectedVaultOwner ?? '',
		securityVaultResult,
	})
	const queuedVaultOperationStatus = getQueuedVaultOperationStatus({
		currentTimestamp,
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
					<FormInput className='field-inline-input' inputMode='numeric' min='1' pattern='[0-9]*' step='1' value={normalizedSecurityVaultForm.stagedOperationTimeoutMinutes} onInput={event => onSecurityVaultFormChange({ stagedOperationTimeoutMinutes: event.currentTarget.value })} disabled={!queueWithdrawRepEnabled} />
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
	const vaultLookupActionLabel = securityVaultError === undefined ? commonCopy.refresh : commonCopy.retry
	const loadedVaultMissingBlocker = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain ? securityPoolCopy.missingVaultDetail : undefined
	const vaultActionsLoadBlocker = (() => {
		if (hasLoadedSelectedVaultDetails || loadingSecurityVault) return undefined
		if (autoLoadVault && securityVaultError === undefined) return undefined
		return securityVaultError === undefined ? securityPoolCopy.refreshVaultActionsDetail : securityPoolCopy.retryVaultActionsDetail
	})()
	const getVaultLauncherBlocker = (action: 'claim-fees' | 'deposit-rep' | 'rep-exit') => {
		const walletGuardState = getWalletActiveAppChainGuardState({
			accountAddress: accountState.address,
			isOnActiveAppChain,
			walletRequiredReason: getVaultLauncherWalletReason(action, effectiveRepExitMode),
		})
		if (walletGuardState.blocked) return walletGuardState.reason
		if (!selectedVaultIsOwnedByAccount) return getVaultLauncherVaultOwnerReason(action, effectiveRepExitMode)
		if (!hasLoadedSelectedVaultDetails) return vaultActionsLoadBlocker
		if (action === 'deposit-rep') {
			if (!vaultExistsOnchain && walletRepBalanceAttoRep !== undefined && walletRepBalanceAttoRep <= 0n) return securityPoolCopy.missingVaultRepBalanceReason
			return undefined
		}
		return loadedVaultMissingBlocker
	}
	const depositLauncherBlocker = getVaultLauncherBlocker('deposit-rep')
	const repExitLauncherBlocker = getVaultLauncherBlocker('rep-exit')
	const claimFeesLauncherBlocker = getVaultLauncherBlocker('claim-fees')
	const showSharedRefreshVaultBlocker = vaultActionsLoadBlocker !== undefined && hasConnectedWallet && selectedVaultIsOwnedByAccount && isOnActiveAppChain
	const getVaultActionDisabledReasonId = (lifecycleActionEnabled: boolean) => {
		if (vaultLifecycleBlocker !== undefined && !lifecycleActionEnabled) return vaultLifecycleBlockerId
		if (showSharedRefreshVaultBlocker) return refreshVaultActionsDescriptionId
		return undefined
	}
	const depositDisabledReasonId = getVaultActionDisabledReasonId(depositRepToVaultEnabled)
	const repExitDisabledReasonId = getVaultActionDisabledReasonId(repExitEnabled)
	const claimFeesDisabledReasonId = getVaultActionDisabledReasonId(claimFeesEnabled)
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
	const vaultReadinessActions = getSecurityPoolVaultReadinessActions([
		{
			actionLabel: securityPoolCopy.depositRepToVault,
			description: securityPoolCopy.depositRepToVaultDescription,
			key: 'deposit-rep',
			...(depositRepToVaultEnabled && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('deposit-rep') } : {}),
			readiness: depositRepToVaultEnabled && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(depositDisabledReasonId === undefined ? {} : { disabledReasonId: depositDisabledReasonId }),
			...(visibleDepositLauncherBlocker === undefined || !depositRepToVaultEnabled ? {} : { blocker: visibleDepositLauncherBlocker }),
			title: securityPoolCopy.depositRepToVault,
		},
		{
			actionLabel: repExitActionLabel,
			description: effectiveRepExitMode === 'redeem' ? securityPoolCopy.repRedemptionDescription : securityPoolCopy.repWithdrawalDescription,
			key: 'rep-exit',
			...(repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('withdraw-rep') } : {}),
			readiness: repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(repExitDisabledReasonId === undefined ? {} : { disabledReasonId: repExitDisabledReasonId }),
			...(visibleRepExitLauncherBlocker === undefined || !repExitEnabled ? {} : { blocker: visibleRepExitLauncherBlocker }),
			title: repExitActionLabel,
		},
		{
			actionLabel: securityPoolCopy.claimFees,
			description: securityPoolCopy.claimFeesDescription,
			key: 'claim-fees',
			...(claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('claim-fees') } : {}),
			readiness: claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(claimFeesDisabledReasonId === undefined ? {} : { disabledReasonId: claimFeesDisabledReasonId }),
			...(claimFeesAvailabilityBlocker === undefined ? {} : { blocker: claimFeesAvailabilityBlocker }),
			title: securityPoolCopy.claimFeesTitle,
		},
		...extraReadinessActions,
	] satisfies ReadinessAction[])
	const actionSections = modalFirst ? (
		<>
			<SectionBlock title={securityPoolCopy.vaultActions} variant='plain'>
				{showMissingVaultNotice ? <StateHint presentation={{ key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail }} /> : undefined}
				{vaultLifecycleBlocker === undefined ? undefined : (
					<p className='notice warning' id={vaultLifecycleBlockerId}>
						{vaultLifecycleBlocker}
					</p>
				)}
				{showSharedRefreshVaultBlocker ? (
					<p className='detail' id={refreshVaultActionsDescriptionId}>
						{vaultActionsLoadBlocker}
					</p>
				) : undefined}
				<div className='vault-action-launcher-grid'>
					{vaultReadinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<ErrorNotice message={securityVaultError} />
			<ErrorNotice message={vaultActionModal === 'deposit-rep' ? undefined : walletRepBalanceError} />
			<OperationModal closeOnSuccessKey={securityVaultResult?.action === 'depositRepToVault' ? securityVaultResult.hash : undefined} context={vaultTransactionContext} isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title={securityPoolCopy.depositRepToVault}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{vaultExistsOnchain ? (
							<SelectedVaultSummarySection
								repPerEthPrice={repPerEthPrice}
								repPerEthSource={repPerEthSource}
								repPerEthSourceUrl={repPerEthSourceUrl}
								capacityOwnershipAttoRep={currentSelectedVaultDetails.capacityOwnershipAttoRep}
								currentVaultIsHealthy={currentVaultIsHealthy}
								securityVaultDetails={currentSelectedVaultDetails}
								selectedPoolStatoblastSecurityMultiplierBps={selectedPoolStatoblastSecurityMultiplierBps}
								selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
								variant='embedded'
							/>
						) : (
							<StateHint presentation={{ key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail }} />
						)}
						<label className='field'>
							<span>{securityPoolCopy.repBackingLabel}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} disabled={!depositRepToVaultEnabled} />
								<button
									className='quiet field-inline-action'
									type='button'
									onClick={() => {
										if (walletRepBalanceAttoRep === undefined) return
										onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(walletRepBalanceAttoRep) })
									}}
									disabled={walletRepBalanceAttoRep === undefined || !depositRepToVaultEnabled}
								>
									{commonCopy.max}
								</button>
							</div>
						</label>
						<label className='field'>
							<span>{securityPoolCopy.targetHealthFactor}</span>
							<FormInput
								aria-describedby={embeddedTargetHealthFactorDescriptionId}
								value={normalizedSecurityVaultForm.targetHealthFactor}
								onInput={event => onSecurityVaultFormChange({ targetHealthFactor: event.currentTarget.value })}
								disabled={!depositRepToVaultEnabled}
								invalid={targetHealthFactorGuardMessage !== undefined}
							/>
							<small className='field-help' id={embeddedTargetHealthFactorDescriptionId}>
								{targetHealthFactorGuardMessage ?? securityPoolCopy.targetHealthFactorHelp}
							</small>
						</label>
						<MetricGrid>
							<MetricField label={securityPoolCopy.walletRep}>{walletRepBalanceLoading ? <LoadingText>{commonCopy.loading}</LoadingText> : <CurrencyValue value={walletRepBalanceAttoRep} suffix={commonCopy.rep} />}</MetricField>
						</MetricGrid>
						<ErrorNotice message={walletRepBalanceError} />
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
							disabled={!approveRepEnabled || !canUseLoadedVaultActions || !depositRepToVaultEnabled}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								{commonCopy.cancel}
							</button>
							<TransactionActionButton
								idleLabel={securityPoolCopy.depositRepToVault}
								pendingLabel={securityPoolCopy.depositRepToVaultPendingLabel}
								onClick={onDepositRepToVault}
								pending={securityVaultActiveAction === 'depositRepToVault'}
								availability={{ disabled: !depositRepToVaultEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositActionGuardMessage : undefined }}
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
								amountLabel={securityPoolCopy.repWithdrawal}
								amountSuffix={commonCopy.rep}
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
							capacityOwnershipAttoRep={currentSelectedVaultDetails.capacityOwnershipAttoRep}
							currentVaultIsHealthy={currentVaultIsHealthy}
							securityVaultDetails={currentSelectedVaultDetails}
							selectedPoolStatoblastSecurityMultiplierBps={selectedPoolStatoblastSecurityMultiplierBps}
							selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
							variant='embedded'
						/>
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
						{effectiveRepExitMode === 'redeem' ? null : (
							<label className='field'>
								<span>{securityPoolCopy.repWithdrawAmount}</span>
								<div className='field-inline'>
									<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} disabled={!queueWithdrawRepEnabled} />
									<button
										className='quiet field-inline-action'
										type='button'
										onClick={() => {
											if (maximumWithdrawableAttoRep === undefined) return
											onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(maximumWithdrawableAttoRep) })
										}}
										disabled={maximumWithdrawableAttoRep === undefined || !queueWithdrawRepEnabled}
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
								pendingLabel={effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemingRep : securityPoolCopy.withdrawingRep}
								onClick={effectiveRepExitMode === 'redeem' ? onRedeemRepFromVault : onWithdrawRep}
								pending={effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRepFromVault' : securityVaultActiveAction === 'queueWithdrawRep'}
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

			<OperationModal context={vaultTransactionContext} isOpen={vaultActionModal === 'claim-fees'} onClose={() => setVaultActionModal(undefined)} title={securityPoolCopy.claimFeesTitle}>
				<MetricGrid>
					<MetricField label={securityPoolCopy.claimableFees}>{currentSelectedVaultDetails === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={currentSelectedVaultDetails.claimableFeesAttoEth} suffix={commonCopy.eth} />}</MetricField>
					<MetricField label={securityPoolCopy.vault}>{selectedVaultOwner === undefined ? commonCopy.noneSelected : <AddressValue address={selectedVaultOwner} />}</MetricField>
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
			<SectionBlock title={securityPoolCopy.claimFeesTitle} variant='embedded'>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={securityPoolCopy.claimableFees}>
							<CurrencyValue value={currentSelectedVaultDetails.claimableFeesAttoEth} suffix={commonCopy.eth} />
						</MetricField>
					</div>
				)}
				<div className='actions'>
					<TransactionActionButton idleLabel={securityPoolCopy.claimFees} pendingLabel={securityPoolCopy.claimingFees} onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: undefined }} />
				</div>
			</SectionBlock>

			<SectionBlock title={securityPoolCopy.depositRepToVault} variant='embedded'>
				<label className='field'>
					<span>{securityPoolCopy.repBackingLabel}</span>
					<div className='field-inline'>
						<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} disabled={!depositRepToVaultEnabled} />
						<button
							className='quiet field-inline-action'
							type='button'
							onClick={() => {
								if (walletRepBalanceAttoRep === undefined) return
								onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(walletRepBalanceAttoRep) })
							}}
							disabled={walletRepBalanceAttoRep === undefined || !depositRepToVaultEnabled}
						>
							{commonCopy.max}
						</button>
					</div>
				</label>
				<label className='field'>
					<span>{securityPoolCopy.targetHealthFactor}</span>
					<FormInput
						aria-describedby={modalTargetHealthFactorDescriptionId}
						value={normalizedSecurityVaultForm.targetHealthFactor}
						onInput={event => onSecurityVaultFormChange({ targetHealthFactor: event.currentTarget.value })}
						disabled={!depositRepToVaultEnabled}
						invalid={targetHealthFactorGuardMessage !== undefined}
					/>
					<small className='field-help' id={modalTargetHealthFactorDescriptionId}>
						{targetHealthFactorGuardMessage ?? securityPoolCopy.targetHealthFactorHelp}
					</small>
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
					disabled={!approveRepEnabled || !canUseLoadedVaultActions || !depositRepToVaultEnabled}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={securityPoolCopy.depositRepToVault}
						pendingLabel={securityPoolCopy.depositRepToVaultPendingLabel}
						onClick={onDepositRepToVault}
						pending={securityVaultActiveAction === 'depositRepToVault'}
						availability={{ disabled: !depositRepToVaultEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositActionGuardMessage : undefined }}
					/>
				</div>
				{(() => {
					if (walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n) return <ErrorNotice message={securityPoolCopy.formatInsufficientRepBalanceDetail(formatCurrencyBalance(walletRepShortfallAttoRep))} />
					if (isDepositBelowMinimum)
						return (
							<p className='detail'>
								{securityPoolCopy.newVaultsRequireAtLeast} <CurrencyValue value={minimumVaultRepDepositAttoRep} suffix={commonCopy.rep} copyable={false} /> {securityPoolCopy.firstDepositTail}
							</p>
						)

					return undefined
				})()}
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
				{effectiveRepExitMode === 'redeem' ? null : (
					<label className='field'>
						<span>{securityPoolCopy.repWithdrawAmount}</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} disabled={!queueWithdrawRepEnabled} />
							<button
								className='quiet field-inline-action'
								type='button'
								onClick={() => {
									if (maximumWithdrawableAttoRep === undefined) return
									onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(maximumWithdrawableAttoRep) })
								}}
								disabled={maximumWithdrawableAttoRep === undefined || !queueWithdrawRepEnabled}
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
						pendingLabel={effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemingRep : securityPoolCopy.withdrawingRep}
						onClick={effectiveRepExitMode === 'redeem' ? onRedeemRepFromVault : onWithdrawRep}
						pending={effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRepFromVault' : securityVaultActiveAction === 'queueWithdrawRep'}
						tone='secondary'
						availability={{
							disabled: !repExitEnabled || !canUseLoadedVaultActions || (effectiveRepExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
							reason: canUseLoadedVaultActions ? repExitGuardMessage : undefined,
						}}
					/>
				</div>
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

			{showSummarySection && currentSelectedVaultDetails !== undefined && vaultExistsOnchain ? (
				<SelectedVaultSummarySection
					repPerEthPrice={repPerEthPrice}
					repPerEthSource={repPerEthSource}
					repPerEthSourceUrl={repPerEthSourceUrl}
					capacityOwnershipAttoRep={capacityOwnershipAttoRep}
					currentVaultIsHealthy={currentVaultIsHealthy}
					securityVaultDetails={currentSelectedVaultDetails}
					selectedPoolStatoblastSecurityMultiplierBps={selectedPoolStatoblastSecurityMultiplierBps}
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
