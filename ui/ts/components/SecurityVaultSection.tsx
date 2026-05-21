import { useEffect, useRef, useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { RequirementsChecklist } from './RequirementsChecklist.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { balanceShortage } from '../lib/inputs.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import { getVaultApprovalGuardMessage, getVaultClaimFeesGuardMessage, getVaultDepositGuardMessage, getVaultSetSecurityBondAllowanceGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'
import { deriveTokenApprovalRequirement } from '../lib/tokenApproval.js'
import {
	doesLoadedSecurityVaultMatchSelection,
	getSecurityVaultMaxBondAllowanceAmount,
	getSecurityVaultWithdrawableRepAmount,
	getSelectedVaultAddress,
	hasValidSecurityVaultOraclePrice,
	isSecurityVaultDepositBelowMinimum,
	isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper,
	MIN_SECURITY_BOND_ALLOWANCE,
	MIN_SECURITY_VAULT_REP_DEPOSIT,
} from '../lib/securityVault.js'
import type { SecurityVaultActionResult, StagedOracleOperation } from '../types/contracts.js'
import type { ReadinessAction, SecurityVaultSectionProps, WorkflowOutcomePresentation } from '../types/components.js'

type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl' | 'selectedPoolSecurityMultiplier'> & {
	securityBondAllowance: bigint
	securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>
	selectedVaultIsOwnedByAccount: boolean
	variant?: 'embedded' | 'record'
}

type VaultActionModal = 'claim-fees' | 'deposit-rep' | 'set-bond-allowance' | 'withdraw-rep' | undefined
type QueuedVaultOperationStatus = 'executed' | 'failed' | 'missing' | 'queued' | 'refreshing' | undefined

export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityVaultDetails, selectedPoolSecurityMultiplier, selectedVaultIsOwnedByAccount, variant = 'record' }: SelectedVaultSummarySectionProps) {
	const content = (
		<VaultMetricGrid
			lockedRepInEscalationGame={securityVaultDetails.lockedRepInEscalationGame}
			repDepositShare={securityVaultDetails.repDepositShare}
			repPerEthPrice={repPerEthPrice}
			repPerEthSource={repPerEthSource}
			repPerEthSourceUrl={repPerEthSourceUrl}
			selectedPoolSecurityMultiplier={selectedPoolSecurityMultiplier}
			securityBondAllowance={securityBondAllowance}
			unpaidEthFees={securityVaultDetails.unpaidEthFees}
			variant={variant}
		/>
	)

	if (variant === 'embedded') {
		return (
			<SectionBlock density='compact' headingLevel={4} title='Vault Summary' variant='embedded'>
				{content}
			</SectionBlock>
		)
	}

	return (
		<EntityCard badge={<span className={`badge ${selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}`}>{selectedVaultIsOwnedByAccount ? 'Owned' : 'Read only'}</span>} title='Selected Vault' variant='record'>
			{content}
		</EntityCard>
	)
}

export function getQueuedVaultOperation({ pendingOperation, selectedVaultAddress, securityVaultResult }: { pendingOperation: StagedOracleOperation | undefined; selectedVaultAddress: string; securityVaultResult: SecurityVaultSectionProps['securityVaultResult'] }) {
	if (pendingOperation === undefined) return undefined
	if (!sameAddress(pendingOperation.targetVault, selectedVaultAddress)) return undefined
	if (securityVaultResult?.action === 'queueWithdrawRep' && pendingOperation.operation === 'withdrawRep') return pendingOperation
	if (securityVaultResult?.action === 'queueSetSecurityBondAllowance' && pendingOperation.operation === 'setSecurityBondsAllowance') return pendingOperation
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
	if (loadingSecurityVault || currentPoolOracleManagerDetails === undefined) return 'refreshing'
	if (queuedVaultOperation !== undefined) return 'queued'
	if (currentPoolOracleManagerDetails.isPriceValid) return 'executed'
	return 'missing'
}

export function getVaultWorkflowOutcomePresentation(action: SecurityVaultActionResult | undefined): WorkflowOutcomePresentation | undefined {
	if (action === undefined) return undefined

	switch (action.action) {
		case 'approveRep':
			return {
				detail: 'REP approval updated for the selected vault workflow.',
				nextStep: 'Return to the deposit modal and submit the deposit.',
				title: 'REP Approval Updated',
			}
		case 'depositRep':
			return {
				detail: 'The selected vault received additional REP.',
				nextStep: 'Review the updated vault summary and continue with bond or reporting work if needed.',
				title: 'REP Deposited',
			}
		case 'queueSetSecurityBondAllowance':
			return {
				detail: 'A new security bond allowance was queued for the selected vault.',
				nextStep: 'Review the queued entry in Staged Operations and execute it when the oracle price is valid.',
				title: 'Bond Allowance Queued',
			}
		case 'queueWithdrawRep':
			return {
				detail: 'A REP withdrawal was queued for the selected vault.',
				nextStep: 'Review the queued entry in Staged Operations and execute it when the oracle price is valid.',
				title: 'REP Withdrawal Queued',
			}
		case 'redeemFees':
			return {
				detail: 'Claimable fees were redeemed from the selected vault.',
				nextStep: 'Refresh the vault to confirm the remaining fee balance.',
				title: 'Fees Claimed',
			}
		case 'updateVaultFees':
			return {
				detail: 'Vault fees were updated on-chain.',
				nextStep: 'Refresh the vault summary to confirm the latest fee state.',
				title: 'Vault Fees Updated',
			}
	}
}

function VaultQueuedOperationStatusCard({
	executedTitle,
	failedTitle,
	missingTitle,
	missingDescription,
	queuedBadgeLabel = 'Queued',
	queuedTitle,
	queuedVaultOperation,
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
	queuedBadgeLabel?: string
	queuedTitle: string
	queuedVaultOperation: ReturnType<typeof getQueuedVaultOperation>
	refreshingDescription: string
	refreshingTitle: string
	status: QueuedVaultOperationStatus
	successDescription: string
}) {
	if (status === undefined) return undefined

	if (status === 'queued') {
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{queuedTitle}</h4>
					</div>
					<span className='badge warn'>{queuedBadgeLabel}</span>
				</div>
				<div className='workflow-metric-grid'>
					<MetricField label='Staged Operation'>{queuedVaultOperation === undefined ? 'Refreshing...' : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
					<MetricField label='Amount'>{queuedVaultOperation === undefined ? 'Refreshing...' : <CurrencyValue value={queuedVaultOperation.amount} suffix='REP' />}</MetricField>
				</div>
				{onViewStagedOperations === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={onViewStagedOperations}>
							View In Staged Operations
						</button>
					</div>
				)}
			</section>
		)
	}

	if (status === 'failed') {
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{failedTitle}</h4>
					</div>
					<span className='badge blocked'>Failed</span>
				</div>
				<p className='detail'>{errorMessage ?? 'The security pool rejected the action.'}</p>
			</section>
		)
	}

	if (status === 'executed') {
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{executedTitle}</h4>
					</div>
					<span className='badge ok'>Executed</span>
				</div>
				<p className='detail'>{successDescription}</p>
			</section>
		)
	}

	if (status === 'missing') {
		return (
			<section className='entity-card compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{missingTitle}</h4>
					</div>
					<span className='badge warn'>Check State</span>
				</div>
				<p className='detail'>{missingDescription}</p>
			</section>
		)
	}

	return (
		<section className='entity-card compact'>
			<div className='entity-card-header'>
				<div>
					<h4>{refreshingTitle}</h4>
				</div>
				<span className='badge muted'>Refreshing</span>
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
}: SecurityVaultSectionProps) {
	const [vaultActionModal, setVaultActionModal] = useState<VaultActionModal>(undefined)
	const isMainnet = isMainnetChain(accountState?.chainId)
	const normalizedSecurityVaultForm = {
		depositAmount: securityVaultForm.depositAmount ?? '0',
		repWithdrawAmount: securityVaultForm.repWithdrawAmount ?? '0',
		securityBondAllowanceAmount: securityVaultForm.securityBondAllowanceAmount ?? '0',
		securityPoolAddress: securityVaultForm.securityPoolAddress ?? '',
		selectedVaultAddress: securityVaultForm.selectedVaultAddress ?? '',
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
	const depositAmount = (() => {
		try {
			return parseRepAmountInput(normalizedSecurityVaultForm.depositAmount, 'REP collateral amount')
		} catch {
			return undefined
		}
	})()
	const securityBondAllowanceAmount = (() => {
		try {
			return parseRepAmountInput(normalizedSecurityVaultForm.securityBondAllowanceAmount, 'Security bond allowance')
		} catch {
			return undefined
		}
	})()
	const withdrawAmount = (() => {
		try {
			return parseRepAmountInput(normalizedSecurityVaultForm.repWithdrawAmount, 'REP withdraw amount')
		} catch {
			return undefined
		}
	})()
	const securityBondAllowance = currentSelectedVaultDetails?.securityBondAllowance ?? 0n
	const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(currentSelectedVaultDetails?.managerAddress, oracleManagerDetails)
	const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? oracleManagerDetails?.priceValidUntilTimestamp : undefined
	const approvalRequirement = deriveTokenApprovalRequirement(depositAmount, securityVaultRepApproval.value)
	const repBalanceGap = balanceShortage(depositAmount, securityVaultRepBalance)
	const withdrawableRepAmount = getSecurityVaultWithdrawableRepAmount({
		lockedRepInEscalationGame: currentSelectedVaultDetails?.lockedRepInEscalationGame,
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
	const canClaimFees = selectedVaultIsOwnedByAccount && isMainnet && hasClaimableFees
	const hasSufficientDepositAllowance = selectedVaultIsOwnedByAccount && depositAmount !== undefined && depositAmount > 0n && approvalRequirement.hasSufficientApproval
	const hasInsufficientRepBalance = repBalanceGap !== undefined && repBalanceGap > 0n
	const canWithdrawRep = selectedVaultIsOwnedByAccount && accountState.address !== undefined && isMainnet && hasValidOraclePrice && hasWithdrawAmount && withdrawableRepAmount !== undefined && withdrawableRepAmount > 0n
	const claimFeesGuardMessage = getVaultClaimFeesGuardMessage({
		hasClaimableFees,
		isMainnet,
		selectedVaultIsOwnedByAccount,
	})
	const setSecurityBondAllowanceGuardMessage = getVaultSetSecurityBondAllowanceGuardMessage({
		hasValidOraclePrice,
		isMainnet,
		maxSecurityBondAllowanceAmount,
		securityBondAllowanceAmount,
		selectedVaultDetailsLoaded: currentSelectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
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
		selectedVaultIsOwnedByAccount,
		withdrawAmount: hasWithdrawAmount ? withdrawAmount : undefined,
		withdrawableRepAmount,
	})
	const approvalGuardMessage = getVaultApprovalGuardMessage({
		accountAddress: accountState.address,
		isMainnet,
		selectedVaultDetailsLoaded: !securityVaultMissing && currentSelectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
	})
	const latestActionLabel =
		securityVaultResult === undefined
			? undefined
			: {
					approveRep: 'Approve REP',
					depositRep: 'Deposit REP',
					queueSetSecurityBondAllowance: 'Set Security Bond Allowance',
					queueWithdrawRep: 'Withdraw REP',
					redeemFees: 'Redeem Fees',
					updateVaultFees: 'Update Fees',
				}[securityVaultResult.action]
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
	const vaultLoadNotice = loadingSecurityVault ? (
		<p className='detail'>
			<LoadingText>Loading vault...</LoadingText>
		</p>
	) : securityVaultMissing ? (
		<StateHint presentation={{ key: 'not_found', badgeLabel: 'Not found', badgeTone: 'blocked', detail: 'Try another pool address.' }} />
	) : undefined

	useEffect(() => {
		if (!autoLoadVault) return
		if (accountState.address === undefined) return
		if (normalizedSecurityVaultForm.securityPoolAddress.trim() === '') return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastAutoLoadKey.current === autoLoadKey) return
		lastAutoLoadKey.current = autoLoadKey
		void onLoadSecurityVault()
	}, [accountState.address, autoLoadKey, autoLoadVault, hasLoadedCurrentVault, loadingSecurityVault, normalizedSecurityVaultForm.securityPoolAddress, onLoadSecurityVault])

	useEffect(() => {
		if (!modalFirst || securityVaultResult === undefined) return
		if (securityVaultResult.action === 'approveRep' || securityVaultResult.action === 'queueSetSecurityBondAllowance' || securityVaultResult.action === 'queueWithdrawRep') {
			return
		}
		setVaultActionModal(undefined)
	}, [modalFirst, securityVaultResult])

	const latestAction =
		securityVaultResult === undefined || currentSelectedVaultDetails === undefined ? undefined : (
			<LatestActionSection
				title='Latest Vault Action'
				embedInCard={compactLayout}
				rows={[
					{ label: 'Action', value: latestActionLabel ?? securityVaultResult.action },
					{ label: 'Transaction', value: <TransactionHashLink hash={securityVaultResult.hash} /> },
				]}
			/>
		)

	const vaultReadinessActions = getSecurityPoolVaultReadinessActions([
		{
			actionLabel: 'Deposit REP',
			description: 'Add REP to the selected vault.',
			key: 'deposit-rep',
			onAction: () => setVaultActionModal('deposit-rep'),
			readiness: depositGuardMessage === undefined ? 'ready' : 'warning',
			title: 'Deposit REP',
			...(currentSelectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === undefined ? { blocker: 'Select a vault first.' } : {}),
		},
		{
			actionLabel: 'Withdraw REP',
			description: 'Queue a REP withdrawal once a valid oracle price exists.',
			key: 'withdraw-rep',
			onAction: () => setVaultActionModal('withdraw-rep'),
			readiness: withdrawRepGuardMessage === undefined ? 'ready' : 'warning',
			title: 'Withdraw REP',
			...(currentSelectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === undefined ? { blocker: 'Select a vault first.' } : {}),
		},
		{
			actionLabel: 'Set Bond Allowance',
			description: 'Queue a new security bond allowance using the current oracle price context.',
			key: 'set-bond-allowance',
			onAction: () => setVaultActionModal('set-bond-allowance'),
			readiness: setSecurityBondAllowanceGuardMessage === undefined ? 'ready' : 'warning',
			title: 'Set Security Bond Allowance',
			...(currentSelectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === undefined ? { blocker: 'Select a vault first.' } : {}),
		},
		{
			actionLabel: 'Claim Fees',
			description: 'Review claimable fees and confirm the fee redemption for the selected vault.',
			key: 'claim-fees',
			onAction: () => setVaultActionModal('claim-fees'),
			readiness: claimFeesGuardMessage === undefined ? 'ready' : 'warning',
			title: 'Claim Fees',
			...(currentSelectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === undefined ? { blocker: 'Select a vault first.' } : {}),
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
			<OperationModal isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title='Deposit REP' description='Review the selected vault, then deposit REP.'>
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
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} />
								<button
									className='quiet field-inline-action'
									type='button'
									onClick={() => {
										if (securityVaultRepBalance === undefined) return
										onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(securityVaultRepBalance) })
									}}
									disabled={securityVaultRepBalance === undefined}
								>
									Max
								</button>
							</div>
						</label>
						<div className='workflow-metric-grid'>
							<MetricField label='Wallet REP'>
								<CurrencyValue value={securityVaultRepBalance} suffix='REP' />
							</MetricField>
						</div>
						<TokenApprovalControl
							actionLabel='depositing REP'
							allowanceError={securityVaultRepApproval.error}
							allowanceLoading={securityVaultRepApproval.loading}
							approvedAmount={securityVaultRepApproval.value}
							guardMessage={approvalGuardMessage}
							onApprove={amount => onApproveRep(amount)}
							pending={securityVaultActiveAction === 'approveRep'}
							pendingLabel='Approving REP...'
							requiredAmount={depositAmount}
							resetKey={`${currentSelectedVaultDetails.repToken}:${currentSelectedVaultDetails.securityPoolAddress}:${depositAmount?.toString() ?? ''}`}
							tokenSymbol='REP'
							tokenUnits={18}
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
							<TransactionActionButton idleLabel='Create / Deposit REP' pendingLabel='Depositing REP...' onClick={onDepositRep} pending={securityVaultActiveAction === 'depositRep'} availability={{ disabled: depositGuardMessage !== undefined, reason: depositGuardMessage }} />
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'withdraw-rep'} onClose={() => setVaultActionModal(undefined)} title='Withdraw REP' description='Queue a REP withdrawal after reviewing the current withdrawable balance and oracle validity.'>
				{currentSelectedVaultDetails === undefined ? <p className='detail'>Refresh the selected vault before withdrawing REP.</p> : null}
				{currentSelectedVaultDetails === undefined ? null : (
					<>
						<VaultQueuedOperationStatusCard
							errorMessage={securityVaultResult?.stagedExecution?.errorMessage ?? 'The oracle manager attempted the withdrawal immediately, but the security pool rejected it.'}
							executedTitle='REP Withdrawal Executed'
							failedTitle='REP Withdrawal Failed'
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
						<div className='workflow-metric-grid'>
							<MetricField label='Withdrawable REP'>{withdrawableRepAmount === undefined ? '—' : <CurrencyValue value={withdrawableRepAmount} suffix='REP' />}</MetricField>
							<MetricField label='Price Valid Until'>{oraclePriceValidUntilTimestamp === undefined ? 'Unavailable' : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</div>
						<label className='field'>
							<span>REP Withdraw Amount</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} />
								<button
									className='quiet field-inline-action'
									type='button'
									onClick={() => {
										if (withdrawableRepAmount === undefined) return
										onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(withdrawableRepAmount) })
									}}
									disabled={withdrawableRepAmount === undefined}
								>
									Max
								</button>
							</div>
						</label>
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
								{ key: 'oracle', label: 'A valid oracle price is available', resolved: hasValidOraclePrice },
								{ key: 'withdrawable', label: 'The vault has withdrawable REP', resolved: withdrawableRepAmount !== undefined && withdrawableRepAmount > 0n },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								Cancel
							</button>
							<TransactionActionButton idleLabel='Withdraw REP' pendingLabel='Queueing REP withdrawal...' onClick={onWithdrawRep} pending={securityVaultActiveAction === 'queueWithdrawRep'} tone='secondary' availability={{ disabled: withdrawRepGuardMessage !== undefined, reason: withdrawRepGuardMessage }} />
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
						<div className='workflow-metric-grid'>
							<MetricField label='Current Bond Allowance'>
								<CurrencyValue value={currentSelectedVaultDetails.securityBondAllowance} suffix='ETH' />
							</MetricField>
							<MetricField label='Price Valid Until'>{oraclePriceValidUntilTimestamp === undefined ? 'Unavailable' : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</div>
						<label className='field'>
							<span>Security Bond Allowance Amount</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n}>
									Max
								</button>
							</div>
						</label>
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
								{ key: 'oracle', label: 'A valid oracle price is available', resolved: hasValidOraclePrice },
								{ key: 'allowance', label: `Allowance amount is zero or at least ${formatCurrencyBalance(MIN_SECURITY_BOND_ALLOWANCE)} ETH`, resolved: hasValidSecurityBondAllowanceAmount },
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
								availability={{ disabled: setSecurityBondAllowanceGuardMessage !== undefined, reason: setSecurityBondAllowanceGuardMessage }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'claim-fees'} onClose={() => setVaultActionModal(undefined)} title='Claim Fees' description='Confirm the claimable fee balance before submitting the fee redemption for this vault.'>
				<div className='workflow-metric-grid'>
					<MetricField label='Claimable Fees'>{currentSelectedVaultDetails === undefined ? '—' : <CurrencyValue value={currentSelectedVaultDetails.unpaidEthFees} suffix='ETH' />}</MetricField>
					<MetricField label='Vault'>{selectedVaultAddress === undefined ? 'None selected' : <AddressValue address={selectedVaultAddress} />}</MetricField>
				</div>
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
					<TransactionActionButton idleLabel='Claim Fees' pendingLabel='Claiming fees...' onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: claimFeesGuardMessage !== undefined, reason: claimFeesGuardMessage }} />
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
					<TransactionActionButton idleLabel='Claim Fees' pendingLabel='Claiming fees...' onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !canClaimFees, reason: claimFeesGuardMessage }} />
				</div>
			</SectionBlock>

			<SectionBlock title='Deposit REP'>
				<label className='field'>
					<span>REP Collateral Amount</span>
					<div className='field-inline'>
						<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} />
						<button
							className='quiet field-inline-action'
							type='button'
							onClick={() => {
								if (securityVaultRepBalance === undefined) return
								onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(securityVaultRepBalance) })
							}}
							disabled={securityVaultRepBalance === undefined}
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
					guardMessage={approvalGuardMessage}
					onApprove={amount => onApproveRep(amount)}
					pending={securityVaultActiveAction === 'approveRep'}
					pendingLabel='Approving REP...'
					requiredAmount={depositAmount}
					resetKey={`${currentSelectedVaultDetails?.repToken ?? ''}:${currentSelectedVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`}
					tokenSymbol='REP'
					tokenUnits={18}
				/>
				<div className='actions'>
					<TransactionActionButton idleLabel='Create / Deposit REP' pendingLabel='Depositing REP...' onClick={onDepositRep} pending={securityVaultActiveAction === 'depositRep'} availability={{ disabled: depositGuardMessage !== undefined, reason: depositGuardMessage }} />
				</div>
				{repBalanceGap !== undefined && repBalanceGap > 0n ? (
					<ErrorNotice message={`Insufficient REP balance. Deposit amount exceeds your wallet balance by ${formatCurrencyBalance(repBalanceGap)} REP.`} />
				) : isDepositBelowMinimum ? (
					<p className='detail'>
						New vaults require at least <CurrencyValue value={MIN_SECURITY_VAULT_REP_DEPOSIT} suffix='REP' copyable={false} /> in the first deposit.
					</p>
				) : undefined}
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
								<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} />
								<button className='quiet field-inline-action' type='button' onClick={() => onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n}>
									Max
								</button>
							</div>
						</label>
						<div className='actions'>
							<TransactionActionButton
								idleLabel='Set Security Bond Allowance'
								pendingLabel='Queueing allowance update...'
								onClick={onSetSecurityBondAllowance}
								pending={securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: setSecurityBondAllowanceGuardMessage !== undefined, reason: setSecurityBondAllowanceGuardMessage }}
							/>
						</div>
					</>
				)}
			</SectionBlock>

			<SectionBlock title='Withdraw REP'>
				{withdrawableRepAmount === undefined ? (
					<p className='detail'>Refresh to see withdrawable REP.</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label='Withdrawable REP'>
							<CurrencyValue value={withdrawableRepAmount} suffix='REP' />
						</MetricField>
						{oraclePriceValidUntilTimestamp === undefined ? undefined : (
							<MetricField className='entity-metric' label='Price Valid Until'>
								<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
							</MetricField>
						)}
					</div>
				)}
				<label className='field'>
					<span>REP Withdraw Amount</span>
					<div className='field-inline'>
						<FormInput className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} />
						<button
							className='quiet field-inline-action'
							type='button'
							onClick={() => {
								if (withdrawableRepAmount === undefined) return
								onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(withdrawableRepAmount) })
							}}
							disabled={withdrawableRepAmount === undefined}
						>
							Max
						</button>
					</div>
				</label>
				<div className='actions'>
					<TransactionActionButton idleLabel='Withdraw REP' pendingLabel='Queueing REP withdrawal...' onClick={onWithdrawRep} pending={securityVaultActiveAction === 'queueWithdrawRep'} tone='secondary' availability={{ disabled: !canWithdrawRep, reason: withdrawRepGuardMessage }} />
				</div>
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

			{latestAction}
			{actionSections}
		</>
	)

	if (compactLayout) {
		return sections
	}

	return (
		<RouteWorkflowPanel description='Browse vaults for the selected security pool, then manage REP, fees, and redemptions for the selected vault.' showHeader={showHeader} title='Security Vault'>
			{sections}
		</RouteWorkflowPanel>
	)
}
