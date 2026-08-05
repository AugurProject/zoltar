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
import { tryParseBigIntInput, tryParseEthAmountInput, tryParseRepAmountInput } from '../../markets/lib/marketForm.js'
import { isActiveAppChain } from '../../../lib/network.js'
import { resolveOracleOperationEthFunding } from '../../open-oracle/lib/oracleRequestEth.js'
import { getWalletActiveAppChainGuardState } from '../../../lib/actionGuards.js'
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import { getVaultLauncherVaultOwnerReason, getVaultLauncherWalletReason } from '../lib/securityPoolLabels.js'
import { getVaultDepositGuardMessage, getVaultRedeemRepGuardMessage, getVaultSetCoverageCommitmentGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'
import { deriveTokenApprovalRequirement } from '../../../lib/tokenApproval.js'
import { useChainTimestamp } from '../../../lib/chainTimestamp.js'
import {
	DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES,
	doesSecurityVaultExistOnchain,
	doesLoadedSecurityVaultMatchSelection,
	getSecurityVaultMaxCoverageCommitmentAttoEthAmount,
	getStagedOperationTimeoutSeconds,
	getSecurityVaultWithdrawableRepAmount,
	getSelectedVaultOwner,
	hasValidSecurityVaultOraclePrice,
	isOracleManagerPriceUsable,
	isSecurityVaultDepositBelowMinimum,
	isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper,
	MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP,
} from '../lib/securityVault.js'
import type { StagedOracleOperation } from '../../../types/contracts.js'
import type { ReadinessAction, SecurityVaultSectionProps } from '../../types.js'
type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl' | 'selectedPoolStatoblastSecurityMultiplierBps'> & {
	coverageCommitmentAttoEth: bigint
	securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>
	selectedVaultIsOwnedByAccount: boolean
	variant?: 'embedded' | 'record'
}
type VaultActionModal = 'claim-fees' | 'deposit-rep' | 'set-coverage-commitment' | 'withdraw-rep' | undefined
type QueuedVaultOperationStatus = 'executed' | 'failed' | 'manual-queued' | 'missing' | 'queued' | 'refreshing' | undefined
type QueuedVaultOperationView = {
	amount: bigint | undefined
	isPendingSlot: boolean
	operationId: bigint
}
export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, coverageCommitmentAttoEth, securityVaultDetails, selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount, variant = 'record' }: SelectedVaultSummarySectionProps) {
	const summaryTitle = <span>{securityPoolCopy.vaultSummary}</span>

	const embeddedContent = (
		<div className='security-pool-selected-vault-summary security-pool-browse-vault-list'>
			<div className='security-pool-browse-vault-row'>
				<div className='security-pool-browse-vault-row-top security-pool-browse-vault-row-top-compact'>
					<div className='security-pool-browse-vault-row-title'>
						<div className='security-pool-browse-vault-row-id'>
							<strong>
								<AddressValue address={securityVaultDetails.vaultAddress} />
							</strong>
						</div>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{securityPoolCopy.currentCoverageCommitmentAttoEth}</span>
						<strong>
							<CurrencyValue value={coverageCommitmentAttoEth} suffix={commonCopy.eth} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{commonCopy.poolHeldVaultRepBackingAttoRep}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.vaultRepBackingAttoRep} suffix={commonCopy.rep} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{commonCopy.disputeStakedRepAttoRep}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.disputeStakedRepAttoRep} suffix={commonCopy.rep} />
						</strong>
					</div>
				</div>
			</div>
		</div>
	)
	const gridContent = (
		<VaultMetricGrid
			layout='grid'
			disputeStakedRepAttoRep={securityVaultDetails.disputeStakedRepAttoRep}
			vaultRepBackingAttoRep={securityVaultDetails.vaultRepBackingAttoRep}
			repPerEthPrice={repPerEthPrice}
			repPerEthSource={repPerEthSource}
			repPerEthSourceUrl={repPerEthSourceUrl}
			selectedPoolStatoblastSecurityMultiplierBps={selectedPoolStatoblastSecurityMultiplierBps}
			coverageCommitmentAttoEth={coverageCommitmentAttoEth}
			claimableFeesAttoEth={securityVaultDetails.claimableFeesAttoEth}
		/>
	)
	if (variant === 'embedded')
		return (
			<SectionBlock density='compact' headingLevel={4} title={summaryTitle} variant='embedded'>
				{embeddedContent}
			</SectionBlock>
		)
	return (
		<EntityCard badge={<Badge tone={selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}>{selectedVaultIsOwnedByAccount ? securityPoolCopy.owned : securityPoolCopy.readOnlyBadgeLabel}</Badge>} surface='flat' title={securityPoolCopy.selectedVault} variant='record'>
			{gridContent}
		</EntityCard>
	)
}
export function getQueuedVaultOperation({ pendingOperation, selectedVaultOwner, securityVaultResult }: { pendingOperation: StagedOracleOperation | undefined; selectedVaultOwner: string; securityVaultResult: SecurityVaultSectionProps['securityVaultResult'] }) {
	if (pendingOperation !== undefined && sameAddress(pendingOperation.targetVault, selectedVaultOwner)) {
		if (securityVaultResult?.action === 'queueWithdrawRep' && pendingOperation.operation === 'withdrawRep') return { amount: pendingOperation.amount, isPendingSlot: true, operationId: pendingOperation.operationId } satisfies QueuedVaultOperationView
		if (securityVaultResult?.action === 'queueSetCoverageCommitmentAttoEth' && pendingOperation.operation === 'setCoverageCommitment') return { amount: pendingOperation.amount, isPendingSlot: true, operationId: pendingOperation.operationId } satisfies QueuedVaultOperationView
	}
	if (securityVaultResult?.queuedOperation === undefined) return undefined
	if (securityVaultResult.action === 'queueWithdrawRep' && securityVaultResult.queuedOperation.operation === 'withdrawRep') return { amount: undefined, isPendingSlot: securityVaultResult.queuedOperation.isPendingSlot, operationId: securityVaultResult.queuedOperation.operationId } satisfies QueuedVaultOperationView
	if (securityVaultResult.action === 'queueSetCoverageCommitmentAttoEth' && securityVaultResult.queuedOperation.operation === 'setCoverageCommitment')
		return { amount: undefined, isPendingSlot: securityVaultResult.queuedOperation.isPendingSlot, operationId: securityVaultResult.queuedOperation.operationId } satisfies QueuedVaultOperationView
	return undefined
}
function getQueuedVaultOperationStatus({
	currentTimestamp,
	currentPoolOracleManagerDetails,
	loadingSecurityVault,
	queuedVaultOperation,
	securityVaultResult,
}: {
	currentTimestamp: bigint | undefined
	currentPoolOracleManagerDetails: SecurityVaultSectionProps['oracleManagerDetails']
	loadingSecurityVault: boolean
	queuedVaultOperation: ReturnType<typeof getQueuedVaultOperation>
	securityVaultResult: SecurityVaultSectionProps['securityVaultResult']
}) {
	if (securityVaultResult?.action !== 'queueWithdrawRep' && securityVaultResult?.action !== 'queueSetCoverageCommitmentAttoEth') return undefined
	if (securityVaultResult.stagedExecution !== undefined) return securityVaultResult.stagedExecution.success ? 'executed' : 'failed'
	if (queuedVaultOperation !== undefined) return queuedVaultOperation.isPendingSlot ? 'queued' : 'manual-queued'
	if (loadingSecurityVault || currentPoolOracleManagerDetails === undefined) return 'refreshing'
	if (isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp)) return 'executed'
	return 'missing'
}
function VaultQueuedOperationStatusCard({
	amountLabel,
	amountSuffix,
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
	amountLabel: string
	amountSuffix: string
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
			<WarningSurface as='section' surface='flat' variant='compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{queuedTitle}</h4>
					</div>
				</div>
				<MetricGrid>
					<MetricField label={commonCopy.stagedOperation}>{queuedVaultOperation === undefined ? securityPoolCopy.refreshing : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
					{queuedVaultOperation?.amount === undefined ? null : (
						<MetricField label={amountLabel}>
							<CurrencyValue precision='exact' value={queuedVaultOperation.amount} suffix={amountSuffix} />
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
			<section className='entity-card compact flat'>
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
			<section className='entity-card compact flat'>
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
			<WarningSurface as='section' surface='flat' variant='compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{missingTitle}</h4>
					</div>
				</div>
				<p className='detail'>{missingDescription}</p>
			</WarningSurface>
		)
	return (
		<section className='entity-card compact flat'>
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
	onDepositRepToVault,
	onLoadSecurityVault,
	onRedeemFees,
	onRedeemRepFromVault,
	onSetCoverageCommitment,
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
	securityVaultResult,
	selectedPoolStatoblastSecurityMultiplierBps,
	selectedMarketTitle,
	selectedPoolTotalPoolHeldRepAttoRep,
	selectedPoolTotalCoverageCommitmentAttoEth,
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
	const isOnActiveAppChain = isActiveAppChain(accountState?.chainId)
	const normalizedSecurityVaultForm = {
		depositAmount: securityVaultForm.depositAmount ?? '0',
		repWithdrawAmount: securityVaultForm.repWithdrawAmount ?? '0',
		coverageCommitmentEthAmount: securityVaultForm.coverageCommitmentEthAmount ?? '0',
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
		...(currentSelectedVaultDetails?.universeId === undefined ? [] : [{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={currentSelectedVaultDetails.universeId} /> }]),
		{ label: securityPoolCopy.vault, value: <AddressValue address={selectedVaultOwner === '' ? undefined : selectedVaultOwner} /> },
		{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
	]
	const depositAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.depositAmount)
	const coverageCommitmentAttoEthAmount = tryParseEthAmountInput(normalizedSecurityVaultForm.coverageCommitmentEthAmount)
	const withdrawAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.repWithdrawAmount)
	const stagedOperationTimeoutMinutes = tryParseBigIntInput(normalizedSecurityVaultForm.stagedOperationTimeoutMinutes)
	const stagedOperationTimeoutSeconds = getStagedOperationTimeoutSeconds(stagedOperationTimeoutMinutes)
	const coverageCommitmentAttoEth = currentSelectedVaultDetails?.coverageCommitmentAttoEth ?? 0n
	const vaultExistsOnchain = doesSecurityVaultExistOnchain(currentSelectedVaultDetails)
	const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(currentSelectedVaultDetails?.managerAddress, oracleManagerDetails, currentTimestamp)
	const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? oracleManagerDetails?.priceValidUntilTimestamp : undefined
	const approvalRequirement = deriveTokenApprovalRequirement(depositAmount, securityVaultRepApproval.value)
	const walletRepShortfallAttoRep = balanceShortage(depositAmount, walletRepBalanceAttoRep)
	const withdrawableRepAmountAttoRep = getSecurityVaultWithdrawableRepAmount({
		disputeStakedRepAttoRep: currentSelectedVaultDetails?.disputeStakedRepAttoRep,
		vaultRepBackingAttoRep: currentSelectedVaultDetails?.vaultRepBackingAttoRep,
		repPerEthPrice: hasValidOraclePrice ? oracleManagerDetails?.lastPrice : undefined,
		coverageCommitmentAttoEth: currentSelectedVaultDetails?.coverageCommitmentAttoEth,
		statoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps,
		totalPoolHeldRepAttoRep: selectedPoolTotalPoolHeldRepAttoRep,
		totalCoverageCommitmentAttoEth: selectedPoolTotalCoverageCommitmentAttoEth,
	})
	const maximumWithdrawableRepAttoRep = (() => {
		if (currentSelectedVaultDetails !== undefined && currentSelectedVaultDetails.disputeStakedRepAttoRep > 0n) return 0n
		if (hasValidOraclePrice) return withdrawableRepAmountAttoRep
		return currentSelectedVaultDetails?.vaultRepBackingAttoRep
	})()
	const maxCoverageCommitmentAttoEthAmount = getSecurityVaultMaxCoverageCommitmentAttoEthAmount({
		currentCoverageCommitmentAttoEth: currentSelectedVaultDetails?.coverageCommitmentAttoEth,
		disputeStakedRepAttoRep: currentSelectedVaultDetails?.disputeStakedRepAttoRep,
		vaultRepBackingAttoRep: currentSelectedVaultDetails?.vaultRepBackingAttoRep,
		repPerEthPrice: hasValidOraclePrice ? oracleManagerDetails?.lastPrice : undefined,
		statoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps,
		totalPoolHeldRepAttoRep: selectedPoolTotalPoolHeldRepAttoRep,
		totalCoverageCommitmentAttoEth: selectedPoolTotalCoverageCommitmentAttoEth,
	})
	const isDepositBelowMinimum = isSecurityVaultDepositBelowMinimum(currentSelectedVaultDetails?.vaultRepBackingAttoRep, depositAmount)
	const hasClaimableFees = currentSelectedVaultDetails !== undefined && currentSelectedVaultDetails.claimableFeesAttoEth > 0n
	const hasSufficientDepositAllowance = selectedVaultIsOwnedByAccount && depositAmount !== undefined && depositAmount > 0n && approvalRequirement.hasSufficientApproval
	const hasInsufficientRepBalance = walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n
	const hasPositiveDepositAmount = depositAmount !== undefined && depositAmount > 0n
	const hasPositiveWithdrawAmount = withdrawAmount !== undefined && withdrawAmount > 0n
	const redeemableRepAmountAttoRep = currentSelectedVaultDetails?.vaultRepBackingAttoRep
	const hasWithdrawableRep = maximumWithdrawableRepAttoRep !== undefined && maximumWithdrawableRepAttoRep > 0n
	const depositRepToVaultEnabled = poolState?.actions.depositRepToVault.enabled ?? true
	const queueWithdrawRepEnabled = poolState?.actions.queueWithdrawRep.enabled ?? true
	const redeemRepFromVaultEnabled = poolState?.actions.redeemRepFromVault.enabled === true
	const approveRepEnabled = poolState?.actions.approveRep.enabled ?? true
	const coverageCommitmentAttoEthEnabled = poolState?.actions.queueSetCoverageCommitmentAttoEth.enabled ?? true
	const claimFeesEnabled = poolState?.actions.redeemFees.enabled ?? true
	const vaultLifecycleBlocker = (() => {
		if (poolState?.lifecycleState === 'ended') return securityPoolCopy.vaultActionsEndedDetail
		if (poolState?.lifecycleState === 'poolForked' || poolState?.lifecycleState === 'forkMigration') return securityPoolCopy.vaultActionsForkMigrationDetail
		if (poolState?.lifecycleState === 'forkTruthAuction') return securityPoolCopy.vaultActionsTruthAuctionDetail
		return undefined
	})()
	const poolCollateralActionsEnabled = depositRepToVaultEnabled
	const effectiveRepExitMode = redeemRepFromVaultEnabled ? 'redeem' : 'withdraw'
	const repExitEnabled = effectiveRepExitMode === 'redeem' ? redeemRepFromVaultEnabled : queueWithdrawRepEnabled
	const repExitActionLabel = effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemRepFromVault : securityPoolCopy.withdrawRep
	const repExitAmountLabel = (() => {
		if (effectiveRepExitMode === 'redeem') return securityPoolCopy.redeemableRepAttoRep
		if (hasValidOraclePrice) return securityPoolCopy.withdrawableRepAttoRep
		return securityPoolCopy.repAvailableToQueue
	})()
	const setCoverageCommitmentFunding = resolveOracleOperationEthFunding({
		managerDetails: oracleManagerDetails,
		priceUsable: hasValidOraclePrice,
	})
	const setCoverageCommitmentGuardMessage = getVaultSetCoverageCommitmentGuardMessage({
		bufferRequiredEthCost: setCoverageCommitmentFunding?.includeBuffer === true,
		maxCoverageCommitmentAttoEthAmount: hasValidOraclePrice ? maxCoverageCommitmentAttoEthAmount : undefined,
		requiredCostAttoEth: setCoverageCommitmentFunding?.costAttoEth,
		coverageCommitmentAttoEthAmount,
		stagedOperationTimeoutMinutes,
		walletBalanceAttoEth: accountState.ethBalanceAttoEth,
	})
	const depositGuardMessage = getVaultDepositGuardMessage({
		approvalSatisfied: hasSufficientDepositAllowance,
		depositAmount,
		isDepositBelowMinimum,
		walletRepShortfallAttoRep: hasInsufficientRepBalance ? walletRepShortfallAttoRep : undefined,
	})
	const withdrawRepFunding = resolveOracleOperationEthFunding({
		managerDetails: oracleManagerDetails,
		priceUsable: hasValidOraclePrice,
	})
	const withdrawRepGuardMessage = getVaultWithdrawGuardMessage({
		bufferRequiredEthCost: withdrawRepFunding?.includeBuffer === true,
		disputeStakedRepAttoRep: currentSelectedVaultDetails?.disputeStakedRepAttoRep,
		requiredCostAttoEth: withdrawRepFunding?.costAttoEth,
		stagedOperationTimeoutMinutes,
		withdrawAmount,
		withdrawableRepAmountAttoRep: maximumWithdrawableRepAttoRep,
		walletBalanceAttoEth: accountState.ethBalanceAttoEth,
	})
	const redeemRepFromVaultGuardMessage = getVaultRedeemRepGuardMessage({
		disputeStakedRepAttoRep: currentSelectedVaultDetails?.disputeStakedRepAttoRep,
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
	const lastAutoLoadKey = useRef<string | undefined>(undefined)
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
	const getVaultLauncherBlocker = (action: 'claim-fees' | 'deposit-rep' | 'rep-exit' | 'set-coverage-commitment') => {
		const walletGuardState = getWalletActiveAppChainGuardState({
			accountAddress: accountState.address,
			isOnActiveAppChain,
			walletRequiredReason: getVaultLauncherWalletReason(action, effectiveRepExitMode),
		})
		if (walletGuardState.blocked) return walletGuardState.reason
		if (!selectedVaultIsOwnedByAccount) return getVaultLauncherVaultOwnerReason(action, effectiveRepExitMode)
		if (!hasLoadedSelectedVaultDetails) return securityPoolCopy.refreshVaultActionsDetail
		if (action === 'deposit-rep') {
			if (!vaultExistsOnchain && walletRepBalanceAttoRep !== undefined && walletRepBalanceAttoRep <= 0n) return securityPoolCopy.missingVaultRepBalanceReason
			return undefined
		}
		return loadedVaultMissingBlocker
	}
	const depositLauncherBlocker = getVaultLauncherBlocker('deposit-rep')
	const repExitLauncherBlocker = getVaultLauncherBlocker('rep-exit')
	const coverageCommitmentAttoEthLauncherBlocker = getVaultLauncherBlocker('set-coverage-commitment')
	const claimFeesLauncherBlocker = getVaultLauncherBlocker('claim-fees')
	const showSharedRefreshVaultBlocker = vaultLifecycleBlocker === undefined && hasConnectedWallet && selectedVaultIsOwnedByAccount && !hasLoadedSelectedVaultDetails && isOnActiveAppChain
	const getVaultActionDisabledReasonId = (lifecycleActionEnabled: boolean) => {
		if (vaultLifecycleBlocker !== undefined && !lifecycleActionEnabled) return vaultLifecycleBlockerId
		if (showSharedRefreshVaultBlocker) return refreshVaultActionsDescriptionId
		return undefined
	}
	const depositDisabledReasonId = getVaultActionDisabledReasonId(depositRepToVaultEnabled)
	const repExitDisabledReasonId = getVaultActionDisabledReasonId(repExitEnabled)
	const coverageCommitmentAttoEthDisabledReasonId = getVaultActionDisabledReasonId(coverageCommitmentAttoEthEnabled)
	const claimFeesDisabledReasonId = getVaultActionDisabledReasonId(claimFeesEnabled)
	const visibleDepositLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : depositLauncherBlocker
	const visibleRepExitLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : repExitLauncherBlocker
	const visibleCoverageCommitmentAttoEthLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : coverageCommitmentAttoEthLauncherBlocker
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
			actionLabel: securityPoolCopy.setCoverageCommitment,
			description: securityPoolCopy.coverageCommitmentAttoEthWorkflowDescription,
			key: 'set-coverage-commitment',
			...(coverageCommitmentAttoEthEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('set-coverage-commitment') } : {}),
			readiness: coverageCommitmentAttoEthEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
			...(coverageCommitmentAttoEthDisabledReasonId === undefined ? {} : { disabledReasonId: coverageCommitmentAttoEthDisabledReasonId }),
			...(visibleCoverageCommitmentAttoEthLauncherBlocker === undefined || !coverageCommitmentAttoEthEnabled ? {} : { blocker: visibleCoverageCommitmentAttoEthLauncherBlocker }),
			title: securityPoolCopy.setCoverageCommitmentTitle,
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
			<OperationModal closeOnSuccessKey={securityVaultResult?.action === 'depositRepToVault' ? securityVaultResult.hash : undefined} context={vaultTransactionContext} isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title={securityPoolCopy.depositRepToVault}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{vaultExistsOnchain ? (
							<SelectedVaultSummarySection
								repPerEthPrice={repPerEthPrice}
								repPerEthSource={repPerEthSource}
								repPerEthSourceUrl={repPerEthSourceUrl}
								coverageCommitmentAttoEth={currentSelectedVaultDetails.coverageCommitmentAttoEth}
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
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button
									className='quiet field-inline-action'
									type='button'
									onClick={() => {
										if (walletRepBalanceAttoRep === undefined) return
										onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(walletRepBalanceAttoRep) })
									}}
									disabled={walletRepBalanceAttoRep === undefined || !poolCollateralActionsEnabled}
								>
									{commonCopy.max}
								</button>
							</div>
						</label>
						<MetricGrid>
							<MetricField label={securityPoolCopy.walletRep}>
								<CurrencyValue value={walletRepBalanceAttoRep} suffix={commonCopy.rep} />
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
								idleLabel={securityPoolCopy.depositRepToVault}
								pendingLabel={securityPoolCopy.depositRepToVaultPendingLabel}
								onClick={onDepositRepToVault}
								pending={securityVaultActiveAction === 'depositRepToVault'}
								availability={{ disabled: !depositRepToVaultEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositGuardMessage : undefined }}
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
							coverageCommitmentAttoEth={currentSelectedVaultDetails.coverageCommitmentAttoEth}
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
									if (maximumWithdrawableRepAttoRep === undefined) return '—'

									return <CurrencyValue value={maximumWithdrawableRepAttoRep} suffix={commonCopy.rep} />
								})()}
							</MetricField>
							{effectiveRepExitMode === 'redeem' ? (
								<MetricField label={commonCopy.disputeStakedRepAttoRep}>
									<CurrencyValue value={currentSelectedVaultDetails.disputeStakedRepAttoRep} suffix={commonCopy.rep} />
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
											if (maximumWithdrawableRepAttoRep === undefined) return
											onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(maximumWithdrawableRepAttoRep) })
										}}
										disabled={maximumWithdrawableRepAttoRep === undefined || !poolCollateralActionsEnabled}
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

			<OperationModal context={vaultTransactionContext} isOpen={vaultActionModal === 'set-coverage-commitment'} onClose={() => setVaultActionModal(undefined)} title={securityPoolCopy.setCoverageCommitmentTitle}>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						<VaultQueuedOperationStatusCard
							amountLabel={securityPoolCopy.coverageCommitment}
							amountSuffix={commonCopy.eth}
							errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? securityPoolCopy.immediateCoverageCommitmentFailureDetail}
							executedTitle={securityPoolCopy.coverageCommitmentUpdated}
							failedTitle={securityPoolCopy.coverageCommitmentUpdateFailed}
							manualQueuedDescription={commonCopy.manualQueuedOperationDetail}
							missingDescription={commonCopy.transactionStateUnavailableDetail}
							missingTitle={securityPoolCopy.coverageCommitmentAttoEthSubmitted}
							onViewStagedOperations={onViewStagedOperations}
							queuedTitle={securityPoolCopy.coverageCommitmentUpdateQueued}
							queuedVaultOperation={queuedVaultOperation}
							refreshingDescription={securityPoolCopy.refreshingCoverageCommitmentStatusDetail}
							refreshingTitle={securityPoolCopy.refreshingCoverageCommitmentState}
							status={securityVaultResult?.action === 'queueSetCoverageCommitmentAttoEth' ? queuedVaultOperationStatus : undefined}
							successDescription={securityPoolCopy.immediateCoverageCommitmentSuccessDetail}
						/>
						<MetricGrid>
							<MetricField label={securityPoolCopy.currentCoverageCommitmentAttoEth}>
								<CurrencyValue value={currentSelectedVaultDetails.coverageCommitmentAttoEth} suffix={commonCopy.eth} />
							</MetricField>
							<MetricField label={securityPoolCopy.priceValidUntil}>{oraclePriceValidUntilTimestamp === undefined ? commonCopy.unavailable : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</MetricGrid>
						<label className='field'>
							<span>{securityPoolCopy.coverageCommitmentEthAmount}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.coverageCommitmentEthAmount} onInput={event => onSecurityVaultFormChange({ coverageCommitmentEthAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button
									aria-label={securityPoolCopy.coverageCommitmentEthAmountMax}
									className='quiet field-inline-action'
									type='button'
									onClick={() => onSecurityVaultFormChange({ coverageCommitmentEthAmount: formatCurrencyInputBalance(maxCoverageCommitmentAttoEthAmount) })}
									disabled={maxCoverageCommitmentAttoEthAmount <= 0n || !poolCollateralActionsEnabled}
								>
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
								idleLabel={securityPoolCopy.setCoverageCommitment}
								pendingLabel={securityPoolCopy.settingCoverageCommitment}
								onClick={onSetCoverageCommitment}
								pending={securityVaultActiveAction === 'queueSetCoverageCommitmentAttoEth'}
								tone='secondary'
								availability={{ disabled: !coverageCommitmentAttoEthEnabled || !canUseLoadedVaultActions || setCoverageCommitmentGuardMessage !== undefined, reason: canUseLoadedVaultActions ? setCoverageCommitmentGuardMessage : undefined }}
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
						<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
						<button
							className='quiet field-inline-action'
							type='button'
							onClick={() => {
								if (walletRepBalanceAttoRep === undefined) return
								onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(walletRepBalanceAttoRep) })
							}}
							disabled={walletRepBalanceAttoRep === undefined || !poolCollateralActionsEnabled}
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
						idleLabel={securityPoolCopy.depositRepToVault}
						pendingLabel={securityPoolCopy.depositRepToVaultPendingLabel}
						onClick={onDepositRepToVault}
						pending={securityVaultActiveAction === 'depositRepToVault'}
						availability={{ disabled: !depositRepToVaultEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositGuardMessage : undefined }}
					/>
				</div>
				{(() => {
					if (walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n) return <ErrorNotice message={securityPoolCopy.formatInsufficientRepBalanceDetail(formatCurrencyBalance(walletRepShortfallAttoRep))} />
					if (isDepositBelowMinimum)
						return (
							<p className='detail'>
								{securityPoolCopy.newVaultsRequireAtLeast} <CurrencyValue value={MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP} suffix={commonCopy.rep} copyable={false} /> {securityPoolCopy.firstDepositTail}
							</p>
						)

					return undefined
				})()}
			</SectionBlock>

			<SectionBlock title={securityPoolCopy.setCoverageCommitmentTitle} variant='embedded'>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p>
				) : (
					<>
						<div className='entity-metric-grid'>
							<MetricField className='entity-metric' label={securityPoolCopy.currentCoverageCommitmentAttoEth}>
								<CurrencyValue value={coverageCommitmentAttoEth} suffix={commonCopy.eth} />
							</MetricField>
							{oraclePriceValidUntilTimestamp === undefined ? undefined : (
								<MetricField className='entity-metric' label={securityPoolCopy.priceValidUntil}>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)}
						</div>
						<label className='field'>
							<span>{securityPoolCopy.coverageCommitmentEthAmount}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.coverageCommitmentEthAmount} onInput={event => onSecurityVaultFormChange({ coverageCommitmentEthAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button
									aria-label={securityPoolCopy.coverageCommitmentEthAmountMax}
									className='quiet field-inline-action'
									type='button'
									onClick={() => onSecurityVaultFormChange({ coverageCommitmentEthAmount: formatCurrencyInputBalance(maxCoverageCommitmentAttoEthAmount) })}
									disabled={maxCoverageCommitmentAttoEthAmount <= 0n || !poolCollateralActionsEnabled}
								>
									{commonCopy.max}
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={securityPoolCopy.setCoverageCommitment}
								pendingLabel={securityPoolCopy.settingCoverageCommitment}
								onClick={onSetCoverageCommitment}
								pending={securityVaultActiveAction === 'queueSetCoverageCommitmentAttoEth'}
								tone='secondary'
								availability={{ disabled: !coverageCommitmentAttoEthEnabled || !canUseLoadedVaultActions || setCoverageCommitmentGuardMessage !== undefined, reason: canUseLoadedVaultActions ? setCoverageCommitmentGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</SectionBlock>

			<SectionBlock title={repExitActionLabel} variant='embedded'>
				{(effectiveRepExitMode === 'redeem' ? redeemableRepAmountAttoRep : maximumWithdrawableRepAttoRep) === undefined ? (
					<p className='detail'>{securityPoolCopy.selectedVaultDetailsUnavailable}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={repExitAmountLabel}>
							<CurrencyValue value={effectiveRepExitMode === 'redeem' ? redeemableRepAmountAttoRep : maximumWithdrawableRepAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						{(() => {
							if (effectiveRepExitMode === 'redeem')
								return (
									<MetricField className='entity-metric' label={commonCopy.disputeStakedRepAttoRep}>
										<CurrencyValue value={currentSelectedVaultDetails?.disputeStakedRepAttoRep} suffix={commonCopy.rep} />
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
									if (maximumWithdrawableRepAttoRep === undefined) return
									onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(maximumWithdrawableRepAttoRep) })
								}}
								disabled={maximumWithdrawableRepAttoRep === undefined || !poolCollateralActionsEnabled}
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
				{effectiveRepExitMode === 'redeem' && currentSelectedVaultDetails?.disputeStakedRepAttoRep !== undefined && currentSelectedVaultDetails.disputeStakedRepAttoRep > 0n ? <p className='detail'>{securityPoolCopy.escalationWithdrawalRequiredDetail}</p> : undefined}
			</SectionBlock>

			<ErrorNotice message={securityVaultError} />
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
					coverageCommitmentAttoEth={coverageCommitmentAttoEth}
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
