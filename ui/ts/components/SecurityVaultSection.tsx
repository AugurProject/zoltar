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
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import { getVaultApprovalGuardMessage, getVaultClaimFeesGuardMessage, getVaultDepositGuardMessage, getVaultRedeemRepGuardMessage, getVaultSetSecurityBondAllowanceGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'
import { deriveTokenApprovalRequirement } from '../lib/tokenApproval.js'
import {
	DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES,
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
export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityVaultDetails, selectedPoolSecurityMultiplier, selectedVaultIsOwnedByAccount, variant = 'record' }: SelectedVaultSummarySectionProps) {
	const collateralizationPercent = getVaultCollateralizationPercent(securityVaultDetails.repDepositShare, securityBondAllowance, repPerEthPrice)
	const collateralizationTarget = selectedPoolSecurityMultiplier === undefined ? undefined : selectedPoolSecurityMultiplier * 100n * 10n ** 18n

	const summaryTitle = <span>Vault Summary</span>

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
						<span>Security Bond Allowance</span>
						<strong>
							<CurrencyValue value={securityBondAllowance} suffix='ETH' />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>REP Collateral</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.repDepositShare} suffix='REP' />
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
		<EntityCard badge={<Badge tone={selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}>{selectedVaultIsOwnedByAccount ? 'Owned' : 'Read only'}</Badge>} title='Selected Vault' variant='record'>
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
					<MetricField label='Staged Operation'>{queuedVaultOperation === undefined ? 'Refreshing...' : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
					{queuedVaultOperation?.amount === undefined ? null : (
						<MetricField label='Amount'>
							<CurrencyValue value={queuedVaultOperation.amount} suffix='REP' />
						</MetricField>
					)}
				</MetricGrid>
				{status === 'manual-queued' ? <p className='detail'>{manualQueuedDescription}</p> : null}
				{onViewStagedOperations === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={onViewStagedOperations}>
							View In Staged Operations
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
					<Badge tone='blocked'>Failed</Badge>
				</div>
				<p className='detail'>{errorMessage ?? 'The security pool rejected the action.'}</p>
				<p className='detail'>Fix the underlying state and submit a new staged operation.</p>
			</section>
		)
	if (status === 'executed')
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{executedTitle}</h4>
					</div>
					<Badge tone='ok'>Executed</Badge>
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
				<Badge tone='muted'>Refreshing</Badge>
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
	const hasWithdrawAmount = normalizedSecurityVaultForm.repWithdrawAmount.trim() !== '' && normalizedSecurityVaultForm.repWithdrawAmount.trim() !== '0'
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultAddress, accountState.address)
	const depositAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.depositAmount)
	const securityBondAllowanceAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.securityBondAllowanceAmount)
	const withdrawAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.repWithdrawAmount)
	const stagedOperationTimeoutMinutes = tryParseBigIntInput(normalizedSecurityVaultForm.stagedOperationTimeoutMinutes)
	const stagedOperationTimeoutSeconds = getStagedOperationTimeoutSeconds(stagedOperationTimeoutMinutes)
	const securityBondAllowance = currentSelectedVaultDetails?.securityBondAllowance ?? 0n
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
	const redeemableRepAmount = currentSelectedVaultDetails?.repDepositShare
	const depositRepEnabled = poolState?.actions.depositRep.enabled ?? true
	const queueWithdrawRepEnabled = poolState?.actions.queueWithdrawRep.enabled ?? true
	const redeemRepEnabled = poolState?.actions.redeemRep.enabled === true
	const approveRepEnabled = poolState?.actions.approveRep.enabled ?? true
	const bondAllowanceEnabled = poolState?.actions.queueSetSecurityBondAllowance.enabled ?? true
	const claimFeesEnabled = poolState?.actions.redeemFees.enabled ?? true
	const poolCollateralActionsEnabled = depositRepEnabled
	const effectiveRepExitMode = redeemRepEnabled ? 'redeem' : 'withdraw'
	const repExitEnabled = effectiveRepExitMode === 'redeem' ? redeemRepEnabled : queueWithdrawRepEnabled
	const repExitActionLabel = effectiveRepExitMode === 'redeem' ? 'Redeem REP' : 'Withdraw REP'
	const claimFeesGuardMessage = getVaultClaimFeesGuardMessage({
		hasClaimableFees,
		isMainnet,
		selectedVaultIsOwnedByAccount,
	})
	const setSecurityBondAllowanceGuardMessage = getVaultSetSecurityBondAllowanceGuardMessage({
		hasValidOraclePrice,
		isMainnet,
		maxSecurityBondAllowanceAmount,
		requestPriceEthCost: oracleManagerDetails?.requestPriceEthCost,
		securityBondAllowanceAmount,
		selectedVaultDetailsLoaded: currentSelectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
		stagedOperationTimeoutMinutes,
		walletEthBalance: accountState.ethBalance,
	})
	const depositGuardMessage = getVaultDepositGuardMessage({
		accountAddress: accountState.address,
		approvalSatisfied: hasSufficientDepositAllowance,
		isDepositBelowMinimum,
		isMainnet,
		repBalanceGap: hasInsufficientRepBalance ? repBalanceGap : undefined,
		selectedVaultDetailsLoaded: currentSelectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
	})
	const withdrawRepGuardMessage = getVaultWithdrawGuardMessage({
		accountAddress: accountState.address,
		hasValidOraclePrice,
		isMainnet,
		requestPriceEthCost: oracleManagerDetails?.requestPriceEthCost,
		selectedVaultIsOwnedByAccount,
		stagedOperationTimeoutMinutes,
		withdrawAmount: hasWithdrawAmount ? withdrawAmount : undefined,
		withdrawableRepAmount,
		walletEthBalance: accountState.ethBalance,
	})
	const redeemRepGuardMessage = getVaultRedeemRepGuardMessage({
		accountAddress: accountState.address,
		isMainnet,
		escalationEscrowedRep: currentSelectedVaultDetails?.escalationEscrowedRep,
		redeemableRepAmount,
		selectedVaultDetailsLoaded: currentSelectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
	})
	const repExitGuardMessage = effectiveRepExitMode === 'redeem' ? redeemRepGuardMessage : withdrawRepGuardMessage
	const approvalGuardMessage = getVaultApprovalGuardMessage({
		accountAddress: accountState.address,
		isMainnet,
		selectedVaultDetailsLoaded: !securityVaultMissing && currentSelectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
	})
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
		stagedOperationTimeoutSeconds === undefined
			? 'Enter whole minutes. Queued self-service operations must stay executable for at least 1 minute after the oracle settlement window completes.'
			: `This queued self-service operation will expire ${formatDuration(stagedOperationTimeoutSeconds)} after the oracle settlement window completes.`
	const renderStagedOperationTimeoutField = () => (
		<>
			<label className='field'>
				<span>Manual Execution Timeout</span>
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
					<span className='field-inline-action'>minutes</span>
				</div>
			</label>
			<p className='detail'>{stagedOperationTimeoutHelpText}</p>
		</>
	)
	const vaultLoadNotice = (() => {
		if (loadingSecurityVault)
			return (
				<p className='detail'>
					<LoadingText>Loading vault...</LoadingText>
				</p>
			)
		if (securityVaultMissing) return <StateHint presentation={{ key: 'not_found', badgeLabel: 'Not found', badgeTone: 'blocked', detail: 'Try another pool address.' }} />

		return undefined
	})()
	useEffect(() => {
		if (!autoLoadVault) return
		if (accountState.address === undefined) return
		if (normalizedSecurityVaultForm.securityPoolAddress.trim() === '') return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastAutoLoadKey.current === autoLoadKey) return
		lastAutoLoadKey.current = autoLoadKey
		void onLoadSecurityVault()
	}, [accountState.address, autoLoadKey, autoLoadVault, hasLoadedCurrentVault, loadingSecurityVault, normalizedSecurityVaultForm.securityPoolAddress, onLoadSecurityVault])
	const vaultReadinessActions = getSecurityPoolVaultReadinessActions([
		{
			actionLabel: 'Deposit REP',
			description: 'Add REP to the selected vault.',
			key: 'deposit-rep',
			...(depositRepEnabled ? { onAction: () => setVaultActionModal('deposit-rep') } : {}),
			readiness: depositRepEnabled ? 'ready' : 'blocked',
			title: 'Deposit REP',
		},
		{
			actionLabel: repExitActionLabel,
			description: effectiveRepExitMode === 'redeem' ? 'Redeem REP from an ended pool after escalation deposits are settled.' : 'Queue a REP withdrawal once a valid oracle price exists.',
			key: 'rep-exit',
			...(repExitEnabled ? { onAction: () => setVaultActionModal('withdraw-rep') } : {}),
			readiness: repExitEnabled ? 'ready' : 'blocked',
			title: repExitActionLabel,
		},
		{
			actionLabel: 'Set Bond Allowance',
			description: 'Queue a new security bond allowance using the current oracle price context.',
			key: 'set-bond-allowance',
			...(bondAllowanceEnabled ? { onAction: () => setVaultActionModal('set-bond-allowance') } : {}),
			readiness: bondAllowanceEnabled ? 'ready' : 'blocked',
			title: 'Set Security Bond Allowance',
		},
		{
			actionLabel: 'Claim Fees',
			description: 'Review claimable fees and confirm the fee redemption for the selected vault.',
			key: 'claim-fees',
			onAction: () => setVaultActionModal('claim-fees'),
			readiness: 'ready',
			title: 'Claim Fees',
		},
		...extraReadinessActions,
	] satisfies ReadinessAction[])
	const actionSections = modalFirst ? (
		<>
			<SectionBlock title='Vault Action Launchers'>
				<div className='vault-action-launcher-grid'>
					{vaultReadinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<ErrorNotice message={securityVaultError} />
			<OperationModal isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title='Deposit REP'>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>Refresh the selected vault before depositing REP.</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
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
						<label className='field'>
							<span>REP Collateral Amount</span>
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
									Max
								</button>
							</div>
						</label>
						<MetricGrid>
							<MetricField label='Wallet REP'>
								<CurrencyValue value={securityVaultRepBalance} suffix='REP' />
							</MetricField>
						</MetricGrid>
						<TokenApprovalControl
							actionLabel='depositing REP'
							allowanceError={securityVaultRepApproval.error}
							allowanceLoading={securityVaultRepApproval.loading}
							approvedAmount={securityVaultRepApproval.value}
							guardMessage={approveRepEnabled ? approvalGuardMessage : undefined}
							onApprove={amount => onApproveRep(amount)}
							pending={securityVaultActiveAction === 'approveRep'}
							pendingLabel='Approving REP...'
							requiredAmount={depositAmount}
							resetKey={`${currentSelectedVaultDetails.repToken}:${currentSelectedVaultDetails.securityPoolAddress}:${depositAmount?.toString() ?? ''}`}
							tokenSymbol='REP'
							tokenUnits={18}
							disabled={!approveRepEnabled}
						/>
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
								{ key: 'balance', label: 'Wallet REP balance covers the deposit amount', resolved: repBalanceGap === undefined || repBalanceGap <= 0n, ...(repBalanceGap !== undefined && repBalanceGap > 0n ? { detail: `Need ${formatCurrencyBalance(repBalanceGap)} more REP.` } : {}) },
								{ key: 'minimum', label: 'First deposit meets the vault minimum', resolved: !isDepositBelowMinimum, ...(isDepositBelowMinimum ? { detail: `First deposits must be at least ${formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)} REP.` } : {}) },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								Cancel
							</button>
							<TransactionActionButton idleLabel='Deposit REP' pendingLabel='Depositing REP...' onClick={onDepositRep} pending={securityVaultActiveAction === 'depositRep'} availability={{ disabled: !depositRepEnabled || depositGuardMessage !== undefined, reason: depositRepEnabled ? depositGuardMessage : undefined }} />
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal
				isOpen={vaultActionModal === 'withdraw-rep'}
				onClose={() => setVaultActionModal(undefined)}
				title={repExitActionLabel}
				description={effectiveRepExitMode === 'redeem' ? 'Redeem the remaining REP collateral from this ended pool after escalation deposits are settled.' : 'Queue a REP withdrawal after reviewing the current withdrawable balance and oracle validity.'}
			>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>{effectiveRepExitMode === 'redeem' ? 'Refresh the selected vault before redeeming REP.' : 'Refresh the selected vault before withdrawing REP.'}</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						{effectiveRepExitMode === 'redeem' ? null : (
							<VaultQueuedOperationStatusCard
								errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? 'The oracle manager attempted the withdrawal immediately, but the security pool rejected it.'}
								executedTitle='REP Withdrawal Executed'
								failedTitle='REP Withdrawal Failed'
								manualQueuedDescription='Another staged operation already holds the auto-execute slot. Execute this staged operation manually with its id after a valid oracle price is available.'
								missingDescription='The transaction succeeded, but no matching staged operation is currently visible for this vault. Refresh staged operations to confirm the latest manager state.'
								missingTitle='REP Withdrawal Submitted'
								onViewStagedOperations={onViewStagedOperations}
								queuedTitle='REP Withdrawal Queued'
								queuedVaultOperation={queuedVaultOperation}
								refreshingDescription='Refreshing the oracle manager to determine whether the withdrawal was queued or executed immediately.'
								refreshingTitle='Refreshing Withdrawal State'
								status={securityVaultResult?.action === 'queueWithdrawRep' ? queuedVaultOperationStatus : undefined}
								successDescription='A valid oracle price was already available, so the withdrawal executed immediately and no staged operation was created.'
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
							<MetricField label={effectiveRepExitMode === 'redeem' ? 'Redeemable REP' : 'Withdrawable REP'}>
								{(() => {
									if (effectiveRepExitMode === 'redeem') {
										if (redeemableRepAmount === undefined) return '—'

										return <CurrencyValue value={redeemableRepAmount} suffix='REP' />
									}
									if (withdrawableRepAmount === undefined) return '—'

									return <CurrencyValue value={withdrawableRepAmount} suffix='REP' />
								})()}
							</MetricField>
							{effectiveRepExitMode === 'redeem' ? (
								<MetricField label='Escrowed REP'>
									<CurrencyValue value={currentSelectedVaultDetails.escalationEscrowedRep} suffix='REP' />
								</MetricField>
							) : (
								<MetricField label='Price Valid Until'>{oraclePriceValidUntilTimestamp === undefined ? 'Unavailable' : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
							)}
						</MetricGrid>
						{effectiveRepExitMode === 'redeem' ? null : (
							<label className='field'>
								<span>REP Withdraw Amount</span>
								<div className='field-inline'>
									<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
									<button
										className='quiet field-inline-action'
										type='button'
										onClick={() => {
											if (withdrawableRepAmount === undefined) return
											onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(withdrawableRepAmount) })
										}}
										disabled={withdrawableRepAmount === undefined || !poolCollateralActionsEnabled}
									>
										Max
									</button>
								</div>
							</label>
						)}
						{effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField()}
						<RequirementsChecklist
							items={
								effectiveRepExitMode === 'redeem'
									? [
											{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
											{
												key: 'locked',
												label: 'No REP remains locked in the escalation game',
												resolved: currentSelectedVaultDetails.escalationEscrowedRep === 0n,
												...(currentSelectedVaultDetails.escalationEscrowedRep > 0n ? { detail: 'Withdraw escalation deposits before redeeming REP.' } : {}),
											},
											{ key: 'redeemable', label: 'The vault has redeemable REP', resolved: redeemableRepAmount !== undefined && redeemableRepAmount > 0n },
										]
									: [
											{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
											{ key: 'oracle', label: 'A valid oracle price is available', resolved: hasValidOraclePrice },
											{ key: 'withdrawable', label: 'The vault has withdrawable REP', resolved: withdrawableRepAmount !== undefined && withdrawableRepAmount > 0n },
											{ key: 'timeout', label: 'Manual execution timeout is at least 1 minute', resolved: stagedOperationTimeoutSeconds !== undefined },
										]
							}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								Cancel
							</button>
							<TransactionActionButton
								idleLabel={repExitActionLabel}
								pendingLabel={effectiveRepExitMode === 'redeem' ? 'Redeeming REP...' : 'Queueing REP withdrawal...'}
								onClick={effectiveRepExitMode === 'redeem' ? onRedeemRep : onWithdrawRep}
								pending={effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRep' : securityVaultActiveAction === 'queueWithdrawRep'}
								tone='secondary'
								availability={{ disabled: !repExitEnabled || repExitGuardMessage !== undefined, reason: repExitEnabled ? repExitGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'set-bond-allowance'} onClose={() => setVaultActionModal(undefined)} title='Set Bond Allowance' description='Queue a new bond allowance using the latest valid oracle price for the selected vault.'>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>Refresh the selected vault before changing its bond allowance.</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						<VaultQueuedOperationStatusCard
							errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? 'The oracle manager attempted the allowance update immediately, but the security pool rejected it.'}
							executedTitle='Bond Allowance Executed'
							failedTitle='Bond Allowance Failed'
							manualQueuedDescription='Another staged operation already holds the auto-execute slot. Execute this staged operation manually with its id after a valid oracle price is available.'
							missingDescription='The transaction succeeded, but no matching staged operation is currently visible for this vault. Refresh staged operations to confirm the latest manager state.'
							missingTitle='Bond Allowance Submitted'
							onViewStagedOperations={onViewStagedOperations}
							queuedTitle='Bond Allowance Queued'
							queuedVaultOperation={queuedVaultOperation}
							refreshingDescription='Refreshing the oracle manager to determine whether the bond allowance was queued or executed immediately.'
							refreshingTitle='Refreshing Bond Allowance State'
							status={securityVaultResult?.action === 'queueSetSecurityBondAllowance' ? queuedVaultOperationStatus : undefined}
							successDescription='A valid oracle price was already available, so the new bond allowance executed immediately and no staged operation was created.'
						/>
						<MetricGrid>
							<MetricField label='Current Bond Allowance'>
								<CurrencyValue value={currentSelectedVaultDetails.securityBondAllowance} suffix='ETH' />
							</MetricField>
							<MetricField label='Price Valid Until'>{oraclePriceValidUntilTimestamp === undefined ? 'Unavailable' : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</MetricGrid>
						<label className='field'>
							<span>Security Bond Allowance Amount</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n || !poolCollateralActionsEnabled}>
									Max
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
								{ key: 'oracle', label: 'A valid oracle price is available', resolved: hasValidOraclePrice },
								{ key: 'allowance', label: `Allowance amount is zero or at least ${formatCurrencyBalance(MIN_SECURITY_BOND_ALLOWANCE)} ETH`, resolved: hasValidSecurityBondAllowanceAmount },
								{ key: 'timeout', label: 'Manual execution timeout is at least 1 minute', resolved: stagedOperationTimeoutSeconds !== undefined },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								Cancel
							</button>
							<TransactionActionButton
								idleLabel='Set Security Bond Allowance'
								pendingLabel='Queueing allowance update...'
								onClick={onSetSecurityBondAllowance}
								pending={securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: !bondAllowanceEnabled || setSecurityBondAllowanceGuardMessage !== undefined, reason: bondAllowanceEnabled ? setSecurityBondAllowanceGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'claim-fees'} onClose={() => setVaultActionModal(undefined)} title='Claim Fees' description='Confirm the claimable fee balance before submitting the fee redemption for this vault.'>
				<MetricGrid>
					<MetricField label='Claimable Fees'>{currentSelectedVaultDetails === undefined ? '—' : <CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix='ETH' />}</MetricField>
					<MetricField label='Vault'>{selectedVaultAddress === undefined ? 'None selected' : <AddressValue address={selectedVaultAddress} />}</MetricField>
				</MetricGrid>
				<RequirementsChecklist
					items={[
						{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
						{ key: 'fees', label: 'Claimable fees are available', resolved: hasClaimableFees },
					]}
				/>
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
						Cancel
					</button>
					<TransactionActionButton idleLabel='Claim Fees' pendingLabel='Claiming fees...' onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !claimFeesEnabled || claimFeesGuardMessage !== undefined, reason: claimFeesEnabled ? claimFeesGuardMessage : undefined }} />
				</div>
			</OperationModal>
		</>
	) : (
		<>
			<SectionBlock title='Claim Fees'>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>Refresh the vault to inspect claimable fees.</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label='Claimable Fees'>
							<CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix='ETH' />
						</MetricField>
					</div>
				)}
				<div className='actions'>
					<TransactionActionButton idleLabel='Claim Fees' pendingLabel='Claiming fees...' onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !claimFeesEnabled || claimFeesGuardMessage !== undefined, reason: claimFeesEnabled ? claimFeesGuardMessage : undefined }} />
				</div>
			</SectionBlock>

			<SectionBlock title='Deposit REP'>
				<label className='field'>
					<span>REP Collateral Amount</span>
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
							Max
						</button>
					</div>
				</label>
				<TokenApprovalControl
					actionLabel='depositing REP'
					allowanceError={securityVaultRepApproval.error}
					allowanceLoading={securityVaultRepApproval.loading}
					approvedAmount={securityVaultRepApproval.value}
					guardMessage={approveRepEnabled ? approvalGuardMessage : undefined}
					onApprove={amount => onApproveRep(amount)}
					pending={securityVaultActiveAction === 'approveRep'}
					pendingLabel='Approving REP...'
					requiredAmount={depositAmount}
					resetKey={`${currentSelectedVaultDetails?.repToken ?? ''}:${currentSelectedVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`}
					tokenSymbol='REP'
					tokenUnits={18}
					disabled={!approveRepEnabled}
				/>
				<div className='actions'>
					<TransactionActionButton idleLabel='Deposit REP' pendingLabel='Depositing REP...' onClick={onDepositRep} pending={securityVaultActiveAction === 'depositRep'} availability={{ disabled: !depositRepEnabled || depositGuardMessage !== undefined, reason: depositRepEnabled ? depositGuardMessage : undefined }} />
				</div>
				{(() => {
					if (repBalanceGap !== undefined && repBalanceGap > 0n) return <ErrorNotice message={`Insufficient REP balance. Deposit amount exceeds your wallet balance by ${formatCurrencyBalance(repBalanceGap)} REP.`} />
					if (isDepositBelowMinimum)
						return (
							<p className='detail'>
								New vaults require at least <CurrencyValue value={MIN_SECURITY_VAULT_REP_DEPOSIT} suffix='REP' copyable={false} /> in the first deposit.
							</p>
						)

					return undefined
				})()}
			</SectionBlock>

			<SectionBlock title='Set Security Bond Allowance'>
				{currentSelectedVaultDetails === undefined ? (
					<p className='detail'>Refresh the vault before setting a security bond allowance.</p>
				) : (
					<>
						<div className='entity-metric-grid'>
							<MetricField className='entity-metric' label='Current Security Bond Allowance'>
								<CurrencyValue value={securityBondAllowance} suffix='ETH' />
							</MetricField>
							{oraclePriceValidUntilTimestamp === undefined ? undefined : (
								<MetricField className='entity-metric' label='Price Valid Until'>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)}
						</div>
						<label className='field'>
							<span>Security Bond Allowance Amount</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n || !poolCollateralActionsEnabled}>
									Max
								</button>
							</div>
						</label>
						{renderStagedOperationTimeoutField()}
						<div className='actions'>
							<TransactionActionButton
								idleLabel='Set Security Bond Allowance'
								pendingLabel='Queueing allowance update...'
								onClick={onSetSecurityBondAllowance}
								pending={securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: !bondAllowanceEnabled || setSecurityBondAllowanceGuardMessage !== undefined, reason: bondAllowanceEnabled ? setSecurityBondAllowanceGuardMessage : undefined }}
							/>
						</div>
					</>
				)}
			</SectionBlock>

			<SectionBlock title={repExitActionLabel}>
				{(effectiveRepExitMode === 'redeem' ? redeemableRepAmount : withdrawableRepAmount) === undefined ? (
					<p className='detail'>{effectiveRepExitMode === 'redeem' ? 'Refresh to see redeemable REP.' : 'Refresh to see withdrawable REP.'}</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label={effectiveRepExitMode === 'redeem' ? 'Redeemable REP' : 'Withdrawable REP'}>
							<CurrencyValue value={effectiveRepExitMode === 'redeem' ? redeemableRepAmount : withdrawableRepAmount} suffix='REP' />
						</MetricField>
						{(() => {
							if (effectiveRepExitMode === 'redeem')
								return (
									<MetricField className='entity-metric' label='Escrowed REP'>
										<CurrencyValue value={currentSelectedVaultDetails?.escalationEscrowedRep} suffix='REP' />
									</MetricField>
								)
							if (oraclePriceValidUntilTimestamp === undefined) return undefined

							return (
								<MetricField className='entity-metric' label='Price Valid Until'>
									<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
								</MetricField>
							)
						})()}
					</div>
				)}
				{effectiveRepExitMode === 'redeem' ? null : (
					<label className='field'>
						<span>REP Withdraw Amount</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} disabled={!poolCollateralActionsEnabled} />
							<button
								className='quiet field-inline-action'
								type='button'
								onClick={() => {
									if (withdrawableRepAmount === undefined) return
									onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(withdrawableRepAmount) })
								}}
								disabled={withdrawableRepAmount === undefined || !poolCollateralActionsEnabled}
							>
								Max
							</button>
						</div>
					</label>
				)}
				{effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField()}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={repExitActionLabel}
						pendingLabel={effectiveRepExitMode === 'redeem' ? 'Redeeming REP...' : 'Queueing REP withdrawal...'}
						onClick={effectiveRepExitMode === 'redeem' ? onRedeemRep : onWithdrawRep}
						pending={effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRep' : securityVaultActiveAction === 'queueWithdrawRep'}
						tone='secondary'
						availability={{ disabled: !repExitEnabled || repExitGuardMessage !== undefined, reason: repExitEnabled ? repExitGuardMessage : undefined }}
					/>
				</div>
				{effectiveRepExitMode === 'redeem' && currentSelectedVaultDetails?.escalationEscrowedRep !== undefined && currentSelectedVaultDetails.escalationEscrowedRep > 0n ? <p className='detail'>Withdraw escalation deposits before redeeming REP.</p> : undefined}
			</SectionBlock>

			<ErrorNotice message={securityVaultError} />
		</>
	)
	const sections = (
		<>
			{showLookupSection ? (
				<SectionBlock title='Vault Lookup'>
					{vaultLoadNotice}
					<LookupFieldRow
						label='Selected Vault Address'
						value={normalizedSecurityVaultForm.selectedVaultAddress}
						onInput={selectedVaultAddressInput => onSecurityVaultFormChange({ selectedVaultAddress: selectedVaultAddressInput })}
						placeholder='0x...'
						action={
							<button className='secondary' onClick={() => onLoadSecurityVault()} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? <LoadingText>Refreshing...</LoadingText> : 'Refresh'}
							</button>
						}
					/>
					{showSecurityPoolAddressInput ? (
						<label className='field'>
							<span>Security Pool Address</span>
							<FormInput value={normalizedSecurityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
						</label>
					) : undefined}
					{selectedVaultIsOwnedByAccount ? undefined : <p className='detail'>Select your own vault to unlock actions.</p>}
				</SectionBlock>
			) : undefined}

			{showSummarySection && currentSelectedVaultDetails !== undefined ? (
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
		<RouteWorkflowPanel description='Browse vaults for the selected security pool, then manage REP, fees, and redemptions for the selected vault.' showHeader={showHeader} title='Security Vault'>
			{sections}
		</RouteWorkflowPanel>
	)
}
