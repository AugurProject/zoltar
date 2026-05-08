import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { zeroAddress } from 'viem'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ActionReadinessPanel } from './ActionReadinessPanel.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { LifecycleStageBanner } from './LifecycleStageBanner.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { ResultBanner } from './ResultBanner.js'
import { getQuestionTitle } from './Question.js'
import { ReportingSection } from './ReportingSection.js'
import { RequirementsChecklist } from './RequirementsChecklist.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { SelectedVaultSummarySection } from './SecurityVaultSection.js'
import { StickyObjectContext } from './StickyObjectContext.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TradingSection } from './TradingSection.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { WorkflowSummaryStrip } from './WorkflowSummaryStrip.js'
import { ViewTabs } from './ViewTabs.js'
import { TimestampValue } from './TimestampValue.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import { getSecurityPoolStagePresentation } from '../lib/securityPoolStage.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { balanceShortage } from '../lib/inputs.js'
import { hasForkActivity } from '../lib/forkAuction.js'
import { resolveRequestedLoadableValueState, type LoadableValueState } from '../lib/loadState.js'
import { formatCurrencyBalance, formatCurrencyInputBalance, formatDuration, formatRoundedCurrencyBalance } from '../lib/formatters.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { deriveTokenApprovalRequirement } from '../lib/tokenApproval.js'
import { getOracleManagerPriceValidUntilTimestamp, getSelectedVaultAddress, hasValidSecurityVaultOraclePrice, isSecurityVaultDepositBelowMinimum, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper, MIN_SECURITY_VAULT_REP_DEPOSIT } from '../lib/securityVault.js'
import { getPoolRegistryPresentation, getWalletPresentation } from '../lib/userCopy.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'
import { formatUniverseLabel } from '../lib/universe.js'
import { resolveEnumValue } from '../lib/viewState.js'
import { getTimeRemaining } from '../lib/time.js'
import type { ListedSecurityPool, OracleManagerDetails, SecurityPoolSystemState } from '../types/contracts.js'
import type { ReadinessAction, SecurityPoolWorkflowRouteContentProps, ViewTabOption, WorkflowOutcomePresentation } from '../types/components.js'

type SelectedPoolView = 'vaults' | 'trading' | 'reporting' | 'fork'
type SelectedVaultView = 'browse-vaults' | 'selected-vault'
type SelectedPoolLookupDisplay = 'empty' | LoadableValueState

export function resolveSelectedPoolView(value: string | undefined): SelectedPoolView {
	const normalizedValue = value === 'resolution' ? 'reporting' : value
	return resolveEnumValue<SelectedPoolView>(normalizedValue, 'vaults', ['vaults', 'trading', 'reporting', 'fork'])
}

export function shouldShowSelectedPoolWorkflowDetails({ hasSelectedPoolAddress, selectedPoolExists, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolExists: boolean; selectedPoolUniverseMismatch: boolean }) {
	return hasSelectedPoolAddress && selectedPoolExists && !selectedPoolUniverseMismatch
}

export function getSelectedPoolCardTitle({ hasSelectedPoolAddress, resolvedPoolTitle }: { hasSelectedPoolAddress: boolean; resolvedPoolTitle: string | undefined }) {
	if (resolvedPoolTitle !== undefined) return resolvedPoolTitle
	return hasSelectedPoolAddress ? 'Selected Pool' : 'Select a security pool'
}

export function getSelectedPoolLookupDisplay({ hasSelectedPoolAddress, selectedPoolLookupState }: { hasSelectedPoolAddress: boolean; selectedPoolLookupState: LoadableValueState }): SelectedPoolLookupDisplay {
	if (!hasSelectedPoolAddress) return 'empty'
	return selectedPoolLookupState
}

export function getSelectedPoolWorkflowGuardMessage({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolLookupState: LoadableValueState; selectedPoolUniverseMismatch: boolean }) {
	if (selectedPoolUniverseMismatch) return 'Switch to the same universe before using this pool workflow.'
	if (selectedPoolLookupState === 'loading') return 'Wait for this pool to finish loading.'
	if (selectedPoolLookupState === 'missing') return 'Load a valid pool to open this workflow.'
	if (!hasSelectedPoolAddress || selectedPoolLookupState === 'unknown') return 'Load a pool to open this workflow.'
	return undefined
}

export function getSelectedPoolWorkflowLockedPresentation({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolLookupState: LoadableValueState; selectedPoolUniverseMismatch: boolean }): UserMessagePresentation {
	if (selectedPoolUniverseMismatch) {
		return {
			actionHint: 'Switch to the matching universe first.',
			badgeLabel: 'Unavailable',
			badgeTone: 'blocked',
			detail: 'Switch to the same universe before using vault, trading, reporting, and fork workflows.',
			key: 'unavailable',
		}
	}

	if (selectedPoolLookupState === 'loading') {
		return {
			detail: 'Loading...',
			detailIsLoading: true,
			key: 'loading',
		}
	}

	if (selectedPoolLookupState === 'missing') {
		return {
			actionHint: 'Try another address or open one from Browse Pools.',
			badgeLabel: 'Not found',
			badgeTone: 'blocked',
			detail: 'Load a valid security pool to unlock vault, trading, reporting, and fork workflows.',
			key: 'not_found',
		}
	}

	return {
		badgeLabel: hasSelectedPoolAddress ? 'Waiting for pool' : 'No pool selected',
		badgeTone: 'muted',
		detail: hasSelectedPoolAddress ? 'Pool not available yet.' : 'No pool selected.',
		...(hasSelectedPoolAddress ? { actionHint: 'Refresh this address after the pool is deployed.' } : {}),
		key: 'action_needed',
	}
}

export function isForkWorkflowDisabled(selectedPoolState: SecurityPoolSystemState | undefined, selectedPoolHasForkActivity = false) {
	return selectedPoolState === undefined || (selectedPoolState === 'operational' && !selectedPoolHasForkActivity)
}

export function getOracleLastPriceDisplay({ lastPrice, lastSettlementTimestamp }: { lastPrice: bigint; lastSettlementTimestamp: bigint }) {
	if (lastSettlementTimestamp === 0n) return '-'
	return `≈ ${formatRoundedCurrencyBalance(lastPrice, 18, 2)} REP / ETH`
}

export function getOraclePriceExpiryDisplay({ currentTimestamp, lastSettlementTimestamp, priceValidUntilTimestamp }: { currentTimestamp: bigint; lastSettlementTimestamp: bigint; priceValidUntilTimestamp: bigint | undefined }) {
	if (lastSettlementTimestamp === 0n) return '-'

	const validUntilTimestamp = priceValidUntilTimestamp ?? getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp)
	if (validUntilTimestamp === undefined) return '-'

	const timeRemaining = getTimeRemaining(validUntilTimestamp, currentTimestamp)
	if (timeRemaining === undefined) return '-'
	return timeRemaining === 0n ? 'Expired' : formatDuration(timeRemaining)
}

function getPendingOperationLabel(operation: 'liquidation' | 'setSecurityBondsAllowance' | 'withdrawRep') {
	switch (operation) {
		case 'liquidation':
			return 'Liquidation'
		case 'withdrawRep':
			return 'Withdraw REP'
		case 'setSecurityBondsAllowance':
			return 'Set Bond Allowance'
	}
}

export function getCurrentPoolOracleManagerDetails({ poolOracleManagerDetails, selectedPoolManagerAddress }: { poolOracleManagerDetails: OracleManagerDetails | undefined; selectedPoolManagerAddress: string | undefined }) {
	if (!sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress)) return undefined
	return poolOracleManagerDetails
}

export function getSelectedPoolOracleMetricValues({ lastOraclePrice, lastOracleSettlementTimestamp }: Pick<ListedSecurityPool, 'lastOraclePrice' | 'lastOracleSettlementTimestamp'>) {
	return {
		lastPrice: lastOraclePrice ?? 0n,
		lastSettlementTimestamp: lastOracleSettlementTimestamp,
	}
}

type VaultActionModal = 'claim-fees' | 'deposit-rep' | 'set-bond-allowance' | 'withdraw-rep' | undefined

function getVaultWorkflowOutcomePresentation(action: SecurityPoolWorkflowRouteContentProps['securityVault']['securityVaultResult']): WorkflowOutcomePresentation | undefined {
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
				nextStep: 'Watch the staged operation state in Pool Summary and execute it when valid.',
				title: 'Bond Allowance Queued',
			}
		case 'queueWithdrawRep':
			return {
				detail: 'A REP withdrawal was queued for the selected vault.',
				nextStep: 'Watch the staged operation state in Pool Summary and execute it when valid.',
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

export function SecurityPoolWorkflowSection({
	accountState,
	activeUniverseId,
	checkedSecurityPoolAddress,
	closeLiquidationModal,
	forkAuction,
	liquidationAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	loadingPoolOracleManager,
	loadingSecurityPools,
	onLiquidationAmountChange,
	onLiquidationTargetVaultChange,
	onLoadPoolOracleManager,
	onOpenLiquidationModal,
	onQueueLiquidation,
	onExecutePendingPoolOperation,
	onRefreshSelectedPoolData,
	onRequestPoolPrice,
	onViewPendingReport,
	poolOracleActiveAction,
	poolOracleManagerDetails,
	poolOracleManagerError,
	poolPriceOracleResult,
	onSecurityPoolAddressChange,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	reporting,
	selectedPoolView,
	securityPoolOverviewActiveAction,
	securityPoolAddress,
	securityPools,
	securityVault,
	modeTabs,
	onSelectedPoolViewChange,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & { modeTabs?: ComponentChildren; showHeader?: boolean }) {
	const view = resolveSelectedPoolView(selectedPoolView)
	const [manualPendingOperationId, setManualPendingOperationId] = useState('')
	const [vaultView, setVaultView] = useState<SelectedVaultView>('selected-vault')
	const [vaultActionModal, setVaultActionModal] = useState<VaultActionModal>(undefined)
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedPool = securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, securityPoolAddress))
	const currentReportingDetails = sameAddress(reporting.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? reporting.reportingDetails : undefined
	const currentForkAuctionDetails = sameAddress(forkAuction.forkAuctionDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? forkAuction.forkAuctionDetails : undefined
	const selectedPoolLookupState = resolveRequestedLoadableValueState({
		currentKey: normalizeAddress(securityPoolAddress),
		isLoading: loadingSecurityPools,
		resolvedKey: checkedSecurityPoolAddress,
		value: selectedPool,
	})
	const marketDetails = selectedPool?.marketDetails ?? currentReportingDetails?.marketDetails ?? currentForkAuctionDetails?.marketDetails
	const selectedPoolState = selectedPool?.systemState ?? currentForkAuctionDetails?.systemState
	const selectedPoolHasForkActivity = selectedPool !== undefined ? hasForkActivity(selectedPool) : currentForkAuctionDetails !== undefined ? hasForkActivity(currentForkAuctionDetails) : false
	const currentTimestamp = currentReportingDetails?.currentTime ?? BigInt(Math.floor(Date.now() / 1000))
	const reportingReady = marketDetails !== undefined && marketDetails.endTime <= currentTimestamp
	const forkWorkflowDisabled = isForkWorkflowDisabled(selectedPoolState, selectedPoolHasForkActivity)
	const selectedPoolUniverseMismatch = selectedPool !== undefined && selectedPool.universeId !== activeUniverseId
	const hasSelectedPoolAddress = securityPoolAddress.trim() !== ''
	const showSelectedPoolWorkflowDetails = shouldShowSelectedPoolWorkflowDetails({
		hasSelectedPoolAddress,
		selectedPoolExists: selectedPool !== undefined,
		selectedPoolUniverseMismatch,
	})
	const selectedPoolWorkflowGuardMessage = getSelectedPoolWorkflowGuardMessage({
		hasSelectedPoolAddress,
		selectedPoolLookupState,
		selectedPoolUniverseMismatch,
	})
	const selectedPoolWorkflowLockedPresentation = showSelectedPoolWorkflowDetails
		? undefined
		: getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress,
				selectedPoolLookupState,
				selectedPoolUniverseMismatch,
			})
	const selectedPoolViewOptions: ViewTabOption<SelectedPoolView>[] =
		selectedPoolWorkflowGuardMessage === undefined
			? [
					{ label: 'Vaults', value: 'vaults' },
					{ label: 'Trading', value: 'trading' },
					{ label: 'Reporting', value: 'reporting' },
					{ label: 'Fork', value: 'fork' },
				]
			: [
					{ disabled: true, label: 'Vaults', reason: selectedPoolWorkflowGuardMessage, value: 'vaults' },
					{ disabled: true, label: 'Trading', reason: selectedPoolWorkflowGuardMessage, value: 'trading' },
					{ disabled: true, label: 'Reporting', reason: selectedPoolWorkflowGuardMessage, value: 'reporting' },
					{ disabled: true, label: 'Fork', reason: selectedPoolWorkflowGuardMessage, value: 'fork' },
				]
	const selectedVaultViewOptions: ViewTabOption<SelectedVaultView>[] = [
		{ label: 'Directory', value: 'browse-vaults' },
		{ label: 'Selected', value: 'selected-vault' },
	]
	const selectedPoolManagerAddress = selectedPool?.managerAddress
	const currentPoolOracleManagerDetails = getCurrentPoolOracleManagerDetails({
		poolOracleManagerDetails,
		selectedPoolManagerAddress,
	})
	const selectedVaultAddressInput = securityVault.securityVaultForm.selectedVaultAddress ?? ''
	const selectedVaultAddress = getSelectedVaultAddress(selectedVaultAddressInput, accountState.address) ?? ''
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultAddressInput, accountState.address)
	const selectedVaultDetails = securityVault.securityVaultDetails
	const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(selectedVaultDetails?.managerAddress, currentPoolOracleManagerDetails)
	const depositAmount = (() => {
		try {
			return parseRepAmountInput(securityVault.securityVaultForm.depositAmount ?? '', 'REP deposit amount')
		} catch {
			return undefined
		}
	})()
	const withdrawAmount = (() => {
		try {
			return parseRepAmountInput(securityVault.securityVaultForm.repWithdrawAmount ?? '', 'REP withdraw amount')
		} catch {
			return undefined
		}
	})()
	const securityBondAllowanceAmount = (() => {
		try {
			return parseRepAmountInput(securityVault.securityVaultForm.securityBondAllowanceAmount ?? '', 'Security bond allowance')
		} catch {
			return undefined
		}
	})()
	const approvalRequirement = deriveTokenApprovalRequirement(depositAmount, securityVault.securityVaultRepApproval.value)
	const repBalanceGap = balanceShortage(depositAmount, securityVault.securityVaultRepBalance)
	const withdrawableRepAmount = selectedVaultDetails === undefined ? undefined : selectedVaultDetails.repDepositShare > selectedVaultDetails.lockedRepInEscalationGame ? selectedVaultDetails.repDepositShare - selectedVaultDetails.lockedRepInEscalationGame : 0n
	const isDepositBelowMinimum = isSecurityVaultDepositBelowMinimum(selectedVaultDetails?.repDepositShare, depositAmount)
	const hasClaimableFees = selectedVaultDetails !== undefined && selectedVaultDetails.unpaidEthFees > 0n
	const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? currentPoolOracleManagerDetails?.priceValidUntilTimestamp : undefined
	const approvalGuardMessage = (() => {
		const walletPresentation = getWalletPresentation({ accountAddress: accountState.address, isMainnet })
		if (walletPresentation !== undefined) return walletPresentation.detail
		if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to approve REP.'
		if (selectedVaultDetails === undefined) return 'Refresh the vault first.'
		return undefined
	})()
	const depositGuardMessage = !selectedVaultIsOwnedByAccount
		? 'Select your own vault to deposit REP.'
		: accountState.address === undefined
			? 'Connect a wallet before depositing REP.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before depositing REP.'
				: selectedVaultDetails === undefined
					? 'Refresh the vault before depositing REP.'
					: !approvalRequirement.hasSufficientApproval
						? 'Approve enough REP before depositing.'
						: repBalanceGap !== undefined && repBalanceGap > 0n
							? `Need ${formatCurrencyBalance(repBalanceGap)} more REP in this wallet.`
							: isDepositBelowMinimum
								? `New vaults require at least ${formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)} REP in the first deposit.`
								: undefined
	const withdrawRepGuardMessage = !selectedVaultIsOwnedByAccount
		? 'Select your own vault to withdraw REP.'
		: accountState.address === undefined
			? 'Connect a wallet before withdrawing REP.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before withdrawing REP.'
				: !hasValidOraclePrice
					? 'A valid oracle price is required before withdrawing REP.'
					: withdrawAmount === undefined || withdrawAmount <= 0n
						? 'Enter a valid REP withdraw amount.'
						: withdrawableRepAmount === undefined || withdrawableRepAmount <= 0n
							? 'No REP is currently withdrawable from this vault.'
							: undefined
	const setSecurityBondAllowanceGuardMessage = !selectedVaultIsOwnedByAccount
		? 'Select your own vault to set the security bond allowance.'
		: !isMainnet
			? 'Switch to Ethereum mainnet before setting the security bond allowance.'
			: selectedVaultDetails === undefined
				? 'Refresh the vault before setting the security bond allowance.'
				: !hasValidOraclePrice
					? 'A valid oracle price is required before setting the security bond allowance.'
					: securityBondAllowanceAmount === undefined || securityBondAllowanceAmount <= 0n
						? 'Enter a security bond allowance greater than zero.'
						: undefined
	const claimFeesGuardMessage = !selectedVaultIsOwnedByAccount ? 'Select your own vault to claim fees.' : !isMainnet ? 'Switch to Ethereum mainnet before claiming fees.' : !hasClaimableFees ? 'No claimable fees are available for this vault.' : undefined
	const selectedPoolStage = getSecurityPoolStagePresentation({
		activeUniverseId,
		pool: selectedPool,
		poolOracleManagerDetails: currentPoolOracleManagerDetails,
		reportingReady,
	})
	const vaultReadinessActions = getSecurityPoolVaultReadinessActions([
		{
			actionLabel: 'Deposit REP',
			description: 'Add REP to the selected vault, including approval from inside the operation.',
			key: 'deposit-rep',
			onAction: () => setVaultActionModal('deposit-rep'),
			readiness: depositGuardMessage === undefined ? 'ready' : 'warning',
			title: 'Deposit REP',
			...(selectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === '' ? { blocker: 'Select a vault first.' } : {}),
		},
		{
			actionLabel: 'Withdraw REP',
			description: 'Queue a REP withdrawal once a valid oracle price exists.',
			key: 'withdraw-rep',
			onAction: () => setVaultActionModal('withdraw-rep'),
			readiness: withdrawRepGuardMessage === undefined ? 'ready' : 'warning',
			title: 'Withdraw REP',
			...(selectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === '' ? { blocker: 'Select a vault first.' } : {}),
		},
		{
			actionLabel: 'Set Bond Allowance',
			description: 'Queue a new security bond allowance using the current oracle price context.',
			key: 'set-bond-allowance',
			onAction: () => setVaultActionModal('set-bond-allowance'),
			readiness: setSecurityBondAllowanceGuardMessage === undefined ? 'ready' : 'warning',
			title: 'Set Bond Allowance',
			...(selectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === '' ? { blocker: 'Select a vault first.' } : {}),
		},
		{
			actionLabel: 'Claim Fees',
			description: 'Review claimable fees and confirm the fee redemption for the selected vault.',
			key: 'claim-fees',
			onAction: () => setVaultActionModal('claim-fees'),
			readiness: claimFeesGuardMessage === undefined ? 'ready' : 'warning',
			title: 'Claim Fees',
			...(selectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === '' ? { blocker: 'Select a vault first.' } : {}),
		},
		{
			actionLabel: 'Liquidate Vault',
			description: 'Queue a high-risk liquidation against the selected vault.',
			key: 'liquidate-vault',
			readiness: currentPoolOracleManagerDetails?.isPriceValid === false ? 'blocked' : 'warning',
			title: 'Liquidate Vault',
			...(selectedPool === undefined || selectedVaultAddress === '' ? { blocker: 'Select a pool and vault first.' } : {}),
			...(selectedPool === undefined || selectedVaultAddress === '' ? {} : { onAction: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, selectedVaultAddress as `0x${string}`) }),
		},
	] satisfies ReadinessAction[])
	const vaultWorkflowOutcome = getVaultWorkflowOutcomePresentation(securityVault.securityVaultResult)
	const selectedPoolQuestionTitle = marketDetails === undefined ? undefined : getQuestionTitle(marketDetails)
	const selectedPoolQuestionDescription = marketDetails === undefined ? undefined : marketDetails.description.trim() === '' ? 'No description provided.' : marketDetails.description
	const selectedPoolLookupDisplay = getSelectedPoolLookupDisplay({
		hasSelectedPoolAddress,
		selectedPoolLookupState,
	})
	const loadedSelectedPool = selectedPool
	const selectedPoolOracleMetricValues = loadedSelectedPool === undefined ? undefined : getSelectedPoolOracleMetricValues(loadedSelectedPool)
	const requestPriceGuardMessage =
		accountState.address === undefined
			? 'Connect a wallet before requesting a new price.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before requesting a new price.'
				: loadedSelectedPool === undefined
					? 'Load a security pool before requesting a new price.'
					: currentPoolOracleManagerDetails?.pendingReportId !== undefined && currentPoolOracleManagerDetails.pendingReportId > 0n
						? 'A pending price report already exists for this pool.'
						: undefined
	const selectedPendingOperationId = currentPoolOracleManagerDetails?.pendingOperationSlotId ?? 0n
	const pendingOperationInput = manualPendingOperationId.trim() !== '' ? manualPendingOperationId.trim() : selectedPendingOperationId > 0n ? selectedPendingOperationId.toString() : ''
	const resolvedPendingOperationId =
		pendingOperationInput === ''
			? undefined
			: (() => {
					try {
						return BigInt(pendingOperationInput)
					} catch {
						return undefined
					}
				})()
	const executePendingOperationGuardMessage =
		accountState.address === undefined
			? 'Connect a wallet before executing a staged operation.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before executing a staged operation.'
				: currentPoolOracleManagerDetails === undefined
					? 'Load the price oracle before executing a staged operation.'
					: currentPoolOracleManagerDetails.isPriceValid === false
						? 'Wait for a valid oracle price before executing a staged operation.'
						: resolvedPendingOperationId === undefined
							? 'Enter a valid staged operation id.'
							: undefined
	const selectedPoolLookupPresentation =
		selectedPoolLookupDisplay === 'empty'
			? {
					key: 'not_checked' as const,
					badgeLabel: 'No pool selected',
					badgeTone: 'muted' as const,
					detail: 'Paste a security pool address or browse pools.',
				}
			: getPoolRegistryPresentation({ mode: 'selection', state: selectedPoolLookupState })
	const selectedPoolBrowsePresentation = selectedPool === undefined ? getPoolRegistryPresentation({ mode: 'selection', state: selectedPoolLookupState }) : undefined
	const selectedVaultLoadNotice = securityVault.loadingSecurityVault ? (
		<p className='detail'>
			<LoadingText>Loading vault...</LoadingText>
		</p>
	) : securityVault.securityVaultMissing ? (
		<StateHint presentation={{ key: 'not_found', badgeLabel: 'Not found', badgeTone: 'blocked', detail: 'Try another vault address.' }} />
	) : undefined
	const selectedPoolVaultDefaultKey = `${normalizeAddress(selectedPool?.securityPoolAddress) ?? ''}:${normalizeAddress(accountState.address) ?? ''}`

	useEffect(() => {
		if (selectedPoolManagerAddress === undefined) return
		if (sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress)) return
		if (loadingPoolOracleManager) return
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [loadingPoolOracleManager, onLoadPoolOracleManager, poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress])

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (normalizedSelectedPoolAddress === undefined) return
		setVaultView('selected-vault')
		if (accountState.address === undefined) return
		if (isSelectedVaultOwnedByAccountHelper(securityVault.securityVaultForm.selectedVaultAddress, accountState.address)) return
		securityVault.onSecurityVaultFormChange({ selectedVaultAddress: accountState.address.toString() })
	}, [accountState.address, securityVault.onSecurityVaultFormChange, securityVault.securityVaultForm.selectedVaultAddress, selectedPoolVaultDefaultKey])

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (view !== 'reporting' || !reportingReady || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) return
		if (sameAddress(reporting.reportingDetails?.securityPoolAddress, normalizedSelectedPoolAddress)) return
		if (reporting.loadingReportingDetails) return
		void reporting.onLoadReporting()
	}, [reporting.loadingReportingDetails, reporting.onLoadReporting, reporting.reportingDetails?.securityPoolAddress, reportingReady, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (view !== 'fork' || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) return
		if (sameAddress(forkAuction.forkAuctionDetails?.securityPoolAddress, normalizedSelectedPoolAddress)) return
		if (forkAuction.loadingForkAuctionDetails) return
		void forkAuction.onLoadForkAuction()
	}, [forkAuction.forkAuctionDetails?.securityPoolAddress, forkAuction.loadingForkAuctionDetails, forkAuction.onLoadForkAuction, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])

	useEffect(() => {
		if (securityVault.securityVaultResult === undefined) return
		setVaultActionModal(undefined)
	}, [securityVault.securityVaultResult])

	return (
		<RouteWorkflowPanel showHeader={showHeader} title='Selected Pool'>
			<StickyObjectContext
				eyebrow='Security Pools Operate'
				title={getSelectedPoolCardTitle({ hasSelectedPoolAddress, resolvedPoolTitle: selectedPoolQuestionTitle })}
				items={[
					{ label: 'Pool', value: hasSelectedPoolAddress ? securityPoolAddress : 'None selected' },
					{ label: 'Universe', value: selectedPool?.universeId === undefined ? formatUniverseLabel(activeUniverseId) : formatUniverseLabel(selectedPool.universeId) },
					{ label: 'Stage', value: selectedPoolStage?.label ?? 'Waiting for pool' },
					{ label: 'Primary Action', value: view === 'vaults' ? 'Vault operations' : view === 'trading' ? 'Trading' : view === 'reporting' ? 'Reporting' : 'Fork workflow' },
				]}
			/>

			<LifecycleStageBanner stage={selectedPoolStage} />

			{view === 'vaults' ? <ActionReadinessPanel actions={vaultReadinessActions} title='Vault execution flows' /> : undefined}

			{view === 'reporting' ? <WorkflowSummaryStrip currentStep={reportingReady ? 'Reporting' : 'Awaiting Market End'} steps={['Pool selected', 'Market ends', 'Reporting', 'Withdrawals']} title='Reporting Workflow' /> : undefined}

			{view === 'fork' ? <WorkflowSummaryStrip currentStep={selectedPoolState === 'operational' ? 'Operational' : 'Fork workflow'} steps={['Operational', 'Fork', 'Auction', 'Settlement']} title='Fork Workflow' /> : undefined}

			<ResultBanner outcome={vaultWorkflowOutcome} />

			<SectionBlock density='compact' title='Security pools' actions={<div className='actions'>{modeTabs}</div>}>
				<LookupFieldRow
					label='Security Pool Address'
					value={securityPoolAddress}
					onInput={onSecurityPoolAddressChange}
					placeholder='0x...'
					action={
						<button className='secondary' onClick={() => onRefreshSelectedPoolData()} disabled={!hasSelectedPoolAddress || loadingSecurityPools}>
							{loadingSecurityPools ? <LoadingText>Refreshing pool...</LoadingText> : 'Refresh pool'}
						</button>
					}
				/>
				{selectedPoolLookupPresentation === undefined ? undefined : <StateHint presentation={selectedPoolLookupPresentation} />}
				{loadedSelectedPool === undefined ? undefined : (
					<>
						<SectionBlock density='compact' headingLevel={4} title='Pool Summary' variant='embedded'>
							<div className='workflow-metric-grid'>
								<MetricField label='Status'>{loadedSelectedPool.systemState}</MetricField>
								<MetricField label='Vaults'>{loadedSelectedPool.vaultCount.toString()}</MetricField>
								<MetricField label='Security Multiplier'>{loadedSelectedPool.securityMultiplier.toString()}</MetricField>
								<MetricField label='Open Interest Fee / Year'>
									<CurrencyValue value={openInterestFeePerYearBigint(loadedSelectedPool.currentRetentionRate)} suffix='%' />
								</MetricField>
								<MetricField label='Total Security Bond Allowance'>
									<CurrencyValue value={loadedSelectedPool.totalSecurityBondAllowance} suffix='ETH' />
								</MetricField>
								<OpenInterestCapacityMetrics
									completeSetCollateralAmount={loadedSelectedPool.completeSetCollateralAmount}
									repPerEthPrice={repPerEthPrice}
									repPerEthSource={repPerEthSource}
									repPerEthSourceUrl={repPerEthSourceUrl}
									securityMultiplier={loadedSelectedPool.securityMultiplier}
									totalRepDeposit={loadedSelectedPool.totalRepDeposit}
									totalSecurityBondAllowance={loadedSelectedPool.totalSecurityBondAllowance}
								/>
								{reportingReady ? <MetricField label='Reporting'>Unlocked</MetricField> : undefined}
								<MetricField label='Manager'>
									<AddressValue address={loadedSelectedPool.managerAddress} />
								</MetricField>
								{loadedSelectedPool.systemState !== 'operational' ? (
									<>
										<MetricField label='Fork Flow'>Forked / active</MetricField>
										{loadedSelectedPool.truthAuctionAddress === zeroAddress ? undefined : (
											<MetricField label='Truth Auction'>
												<AddressValue address={loadedSelectedPool.truthAuctionAddress} />
											</MetricField>
										)}
										<MetricField label='Fork Mode'>{loadedSelectedPool.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent / Zoltar fork'}</MetricField>
										<MetricField label='Fork Outcome'>{loadedSelectedPool.forkOutcome}</MetricField>
									</>
								) : undefined}
								<MetricField label='Last Price'>{getOracleLastPriceDisplay(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues ?? { lastPrice: 0n, lastSettlementTimestamp: 0n })}</MetricField>
								<MetricField label='Set At'>
									<TimestampValue timestamp={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp ?? 0n} zeroText='Never' />
								</MetricField>
								<MetricField label='Expires In'>
									{getOraclePriceExpiryDisplay({
										currentTimestamp,
										lastSettlementTimestamp: (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp ?? 0n,
										priceValidUntilTimestamp: currentPoolOracleManagerDetails?.priceValidUntilTimestamp,
									})}
								</MetricField>
								{currentPoolOracleManagerDetails === undefined ? undefined : (
									<>
										<MetricField label='Pending Request'>
											{currentPoolOracleManagerDetails.pendingReportId > 0n ? (
												<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
													Report #{currentPoolOracleManagerDetails.pendingReportId.toString()} (security pool/price)
												</button>
											) : (
												'None'
											)}
										</MetricField>
										<MetricField label='Request Cost'>
											<CurrencyValue value={currentPoolOracleManagerDetails.requestPriceEthCost} suffix='ETH' />
										</MetricField>
									</>
								)}
							</div>
							<ErrorNotice message={poolOracleManagerError} />
							{poolPriceOracleResult === undefined ? undefined : (
								<p className='notice success'>
									{poolPriceOracleResult.action === 'executeStagedOperation' ? 'Executed staged operation' : 'Requested price'}: <TransactionHashLink hash={poolPriceOracleResult.hash} />
								</p>
							)}
							{currentPoolOracleManagerDetails === undefined ? <p className='detail'>Load the price oracle to inspect the latest settlement details.</p> : undefined}
							{currentPoolOracleManagerDetails?.pendingOperation === undefined ? undefined : (
								<SectionBlock density='compact' headingLevel={4} title='Queued Operation' variant='embedded'>
									<div className='workflow-metric-grid'>
										<MetricField label='Operation Id'>{currentPoolOracleManagerDetails.pendingOperation.operationId.toString()}</MetricField>
										<MetricField label='Operation'>{getPendingOperationLabel(currentPoolOracleManagerDetails.pendingOperation.operation)}</MetricField>
										<MetricField label='Initiator'>
											<AddressValue address={currentPoolOracleManagerDetails.pendingOperation.initiatorVault} />
										</MetricField>
										<MetricField label='Target Vault'>
											<AddressValue address={currentPoolOracleManagerDetails.pendingOperation.targetVault} />
										</MetricField>
										<MetricField label='Amount'>
											<CurrencyValue value={currentPoolOracleManagerDetails.pendingOperation.amount} />
										</MetricField>
									</div>
								</SectionBlock>
							)}
							{currentPoolOracleManagerDetails === undefined ? undefined : (
								<label className='field'>
									<span>Staged Operation Id</span>
									<FormInput value={manualPendingOperationId} onInput={event => setManualPendingOperationId(event.currentTarget.value)} placeholder={selectedPendingOperationId > 0n ? selectedPendingOperationId.toString() : '0'} />
								</label>
							)}
							<div className='actions'>
								<button className='secondary' onClick={() => onLoadPoolOracleManager(loadedSelectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
									{loadingPoolOracleManager ? <LoadingText>Refreshing oracle...</LoadingText> : currentPoolOracleManagerDetails === undefined ? 'Load Price Oracle' : 'Refresh Oracle'}
								</button>
								{currentPoolOracleManagerDetails === undefined ? undefined : (
									<>
										<TransactionActionButton
											idleLabel='Request New Price'
											pendingLabel='Requesting new price...'
											onClick={() => onRequestPoolPrice(loadedSelectedPool.managerAddress)}
											pending={poolOracleActiveAction === 'requestPrice'}
											tone='secondary'
											availability={{ disabled: requestPriceGuardMessage !== undefined, reason: requestPriceGuardMessage }}
										/>
										<TransactionActionButton
											idleLabel='Execute Staged Operation'
											pendingLabel='Executing staged operation...'
											onClick={() => {
												if (resolvedPendingOperationId === undefined) return
												onExecutePendingPoolOperation(loadedSelectedPool.managerAddress, resolvedPendingOperationId)
											}}
											pending={poolOracleActiveAction === 'executeStagedOperation'}
											tone='secondary'
											availability={{ disabled: executePendingOperationGuardMessage !== undefined, reason: executePendingOperationGuardMessage }}
										/>
									</>
								)}
							</div>
						</SectionBlock>

						{selectedPoolQuestionTitle === undefined ? undefined : (
							<SectionBlock density='compact' headingLevel={4} title='Question' variant='embedded'>
								<div className='selected-pool-summary-question'>
									<strong className='selected-pool-summary-title'>{selectedPoolQuestionTitle}</strong>
									<p className='detail selected-pool-summary-detail'>{selectedPoolQuestionDescription}</p>
								</div>
							</SectionBlock>
						)}
					</>
				)}
			</SectionBlock>

			{selectedPool === undefined || !selectedPoolUniverseMismatch ? undefined : (
				<SectionBlock title='Universe Mismatch' tone='critical'>
					<p className='detail'>
						This pool belongs to <UniverseLink universeId={selectedPool.universeId} /> but the app is currently set to {formatUniverseLabel(activeUniverseId)}.
					</p>
					<p className='detail'>Switch to the same universe before using this pool.</p>
				</SectionBlock>
			)}

			<section className='selected-pool-workspace'>
				<div className='selected-pool-workspace-grid'>
					<div className='selected-pool-workflow-rail'>
						<ViewTabs ariaLabel='Selected pool views' className='selected-pool-workflow-nav' orientation='vertical' size='compact' value={view} onChange={nextView => onSelectedPoolViewChange(hasSelectedPoolAddress ? nextView : undefined)} options={selectedPoolViewOptions} />
					</div>

					<div className='selected-pool-workflow-content'>
						{!showSelectedPoolWorkflowDetails ? (
							<SectionBlock title='Pool Workflows'>{selectedPoolWorkflowLockedPresentation === undefined ? undefined : <StateHint presentation={selectedPoolWorkflowLockedPresentation} />}</SectionBlock>
						) : (
							<>
								{view === 'vaults' ? (
									<div className='workflow-stack vault-workspace'>
										<SectionBlock
											density='compact'
											title='Vault Operations'
											actions={
												<div className='actions'>
													<ViewTabs ariaLabel='Selected pool vault views' className='vault-content-switch' size='compact' value={vaultView} onChange={setVaultView} options={selectedVaultViewOptions} />
													<button className='secondary' onClick={() => securityVault.onLoadSecurityVault()} disabled={securityVault.loadingSecurityVault}>
														{securityVault.loadingSecurityVault ? <LoadingText>Refreshing...</LoadingText> : 'Refresh'}
													</button>
												</div>
											}
										>
											{selectedVaultLoadNotice}
											<label className='field'>
												<span>Selected Vault Address</span>
												<FormInput value={selectedVaultAddressInput} onInput={event => securityVault.onSecurityVaultFormChange({ selectedVaultAddress: event.currentTarget.value })} placeholder='0x...' />
											</label>
											{selectedVaultIsOwnedByAccount ? undefined : <p className='detail'>Select your own vault to unlock actions.</p>}
											{vaultView === 'selected-vault' && securityVault.securityVaultDetails !== undefined ? (
												<SelectedVaultSummarySection
													repPerEthPrice={repPerEthPrice}
													repPerEthSource={repPerEthSource}
													repPerEthSourceUrl={repPerEthSourceUrl}
													securityBondAllowance={securityVault.securityVaultDetails.securityBondAllowance}
													securityVaultDetails={securityVault.securityVaultDetails}
													securityVaultRepApproval={securityVault.securityVaultRepApproval}
													selectedPoolSecurityMultiplier={securityVault.selectedPoolSecurityMultiplier}
													selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
													variant='embedded'
												/>
											) : undefined}
										</SectionBlock>

										{vaultView === 'browse-vaults' ? (
											<SectionBlock title='Vault Directory'>
												{selectedPool === undefined ? (
													selectedPoolBrowsePresentation === undefined ? undefined : (
														<StateHint presentation={selectedPoolBrowsePresentation} />
													)
												) : selectedPool.vaults.length === 0 ? (
													<StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No vaults in this pool yet.' }} />
												) : (
													<div className='entity-card-list'>
														{selectedPool.vaults.map(vault => (
															<EntityCard
																key={`${selectedPool.securityPoolAddress}-${vault.vaultAddress}`}
																className='compact'
																title={<AddressValue address={vault.vaultAddress} />}
																variant='compact'
																badge={selectedVaultAddress !== '' && sameCaseInsensitiveText(selectedVaultAddress, vault.vaultAddress) ? <span className='badge ok'>Selected</span> : undefined}
																actions={
																	<div className='actions'>
																		<button
																			className='secondary'
																			onClick={() => {
																				securityVault.onSecurityVaultFormChange({ selectedVaultAddress: vault.vaultAddress.toString() })
																				setVaultView('selected-vault')
																				void securityVault.onLoadSecurityVault(vault.vaultAddress.toString())
																			}}
																		>
																			Select Vault
																		</button>
																		<button className='destructive' onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress)} disabled={accountState.address === undefined || !isMainnet || currentPoolOracleManagerDetails?.isPriceValid === false}>
																			Liquidate Vault
																		</button>
																	</div>
																}
															>
																<VaultMetricGrid
																	className='workflow-vault-grid'
																	lockedRepInEscalationGame={vault.lockedRepInEscalationGame}
																	repDepositShare={vault.repDepositShare}
																	repPerEthPrice={repPerEthPrice}
																	repPerEthSource={repPerEthSource}
																	repPerEthSourceUrl={repPerEthSourceUrl}
																	selectedPoolSecurityMultiplier={selectedPool.securityMultiplier}
																	securityBondAllowance={vault.securityBondAllowance}
																	unpaidEthFees={vault.unpaidEthFees}
																	variant='embedded'
																/>
															</EntityCard>
														))}
													</div>
												)}
											</SectionBlock>
										) : (
											<div className='workflow-stack'>
												<SectionBlock title='Vault Action Launchers' description='The page stays focused on vault state. Execution happens inside focused modals.'>
													<div className='vault-action-launcher-grid'>
														{vaultReadinessActions.map(action => (
															<section key={action.key} className={`action-launcher-card ${action.readiness}`}>
																<div className='action-launcher-card-copy'>
																	<h4>{action.title}</h4>
																	<p className='detail'>{action.description}</p>
																	{action.blocker === undefined ? undefined : <p className='detail'>Blocked: {action.blocker}</p>}
																</div>
																<div className='action-launcher-card-actions'>
																	<TransactionActionButton idleLabel={action.actionLabel} pendingLabel='Opening...' onClick={() => action.onAction?.()} tone='secondary' availability={{ disabled: action.onAction === undefined || action.blocker !== undefined, reason: action.blocker }} />
																</div>
															</section>
														))}
													</div>
												</SectionBlock>
												<ErrorNotice message={securityVault.securityVaultError} />
											</div>
										)}
									</div>
								) : undefined}

								{view === 'trading' ? <TradingSection {...trading} embedInCard showHeader={false} showSecurityPoolAddressInput={false} /> : undefined}

								{view === 'reporting' ? (
									<ReportingSection
										{...reporting}
										currentTimestamp={currentTimestamp}
										embedInCard
										lockedReason={reportingReady ? undefined : 'Reporting opens after market end.'}
										previewMarketDetails={currentReportingDetails === undefined ? marketDetails : undefined}
										reportingDetails={currentReportingDetails}
										showHeader={false}
										showSecurityPoolAddressInput={false}
									/>
								) : undefined}

								{view === 'fork' ? (
									<ForkAuctionSection
										{...forkAuction}
										disabled={forkWorkflowDisabled}
										disabledMessage={forkWorkflowDisabled ? 'This pool is currently operational, so fork and truth auction actions are read only.' : undefined}
										embedInCard
										forkAuctionDetails={currentForkAuctionDetails}
										previewPool={selectedPool}
										showHeader={false}
										showSecurityPoolAddressInput={false}
									/>
								) : undefined}
							</>
						)}
					</div>
				</div>
			</section>

			<OperationModal isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title='Deposit REP' description='Review the selected vault, complete REP approval if needed, then deposit REP.'>
				{selectedVaultDetails === undefined ? <p className='detail'>Refresh the selected vault before depositing REP.</p> : null}
				{selectedVaultDetails === undefined ? null : (
					<>
						<SelectedVaultSummarySection
							repPerEthPrice={repPerEthPrice}
							repPerEthSource={repPerEthSource}
							repPerEthSourceUrl={repPerEthSourceUrl}
							securityBondAllowance={selectedVaultDetails.securityBondAllowance}
							securityVaultDetails={selectedVaultDetails}
							securityVaultRepApproval={securityVault.securityVaultRepApproval}
							selectedPoolSecurityMultiplier={securityVault.selectedPoolSecurityMultiplier}
							selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
							variant='embedded'
						/>
						<label className='field'>
							<span>REP Deposit Amount</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={securityVault.securityVaultForm.depositAmount} onInput={event => securityVault.onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} />
								<button
									className='quiet field-inline-action'
									type='button'
									onClick={() => {
										if (securityVault.securityVaultRepBalance === undefined) return
										securityVault.onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(securityVault.securityVaultRepBalance) })
									}}
									disabled={securityVault.securityVaultRepBalance === undefined}
								>
									Max
								</button>
							</div>
						</label>
						<TokenApprovalControl
							actionLabel='depositing REP'
							allowanceError={securityVault.securityVaultRepApproval.error}
							allowanceLoading={securityVault.securityVaultRepApproval.loading}
							approvedAmount={securityVault.securityVaultRepApproval.value}
							guardMessage={approvalGuardMessage}
							onApprove={amount => securityVault.onApproveRep(amount)}
							pending={securityVault.securityVaultActiveAction === 'approveRep'}
							pendingLabel='Approving REP...'
							requiredAmount={depositAmount}
							resetKey={`${selectedVaultDetails.repToken}:${selectedVaultDetails.securityPoolAddress}:${depositAmount?.toString() ?? ''}`}
							tokenSymbol='REP'
							tokenUnits={18}
						/>
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
								{ key: 'approval', label: 'REP approval is sufficient for the deposit amount', resolved: approvalRequirement.hasSufficientApproval, ...(approvalRequirement.hasSufficientApproval ? {} : { detail: 'Approve REP inside this modal before depositing.' }) },
								{ key: 'balance', label: 'Wallet REP balance covers the deposit amount', resolved: repBalanceGap === undefined || repBalanceGap <= 0n, ...(repBalanceGap !== undefined && repBalanceGap > 0n ? { detail: `Need ${formatCurrencyBalance(repBalanceGap)} more REP.` } : {}) },
								{ key: 'minimum', label: 'First deposit meets the vault minimum', resolved: !isDepositBelowMinimum, ...(isDepositBelowMinimum ? { detail: `First deposits must be at least ${formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)} REP.` } : {}) },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								Cancel
							</button>
							<TransactionActionButton idleLabel='Create / Deposit REP' pendingLabel='Depositing REP...' onClick={() => securityVault.onDepositRep()} pending={securityVault.securityVaultActiveAction === 'depositRep'} availability={{ disabled: depositGuardMessage !== undefined, reason: depositGuardMessage }} />
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'withdraw-rep'} onClose={() => setVaultActionModal(undefined)} title='Withdraw REP' description='Queue a REP withdrawal after reviewing the current withdrawable balance and oracle validity.'>
				{selectedVaultDetails === undefined ? <p className='detail'>Refresh the selected vault before withdrawing REP.</p> : null}
				{selectedVaultDetails === undefined ? null : (
					<>
						<SelectedVaultSummarySection
							repPerEthPrice={repPerEthPrice}
							repPerEthSource={repPerEthSource}
							repPerEthSourceUrl={repPerEthSourceUrl}
							securityBondAllowance={selectedVaultDetails.securityBondAllowance}
							securityVaultDetails={selectedVaultDetails}
							securityVaultRepApproval={securityVault.securityVaultRepApproval}
							selectedPoolSecurityMultiplier={securityVault.selectedPoolSecurityMultiplier}
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
								<FormInput className='field-inline-input' value={securityVault.securityVaultForm.repWithdrawAmount} onInput={event => securityVault.onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} />
								<button
									className='quiet field-inline-action'
									type='button'
									onClick={() => {
										if (withdrawableRepAmount === undefined) return
										securityVault.onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(withdrawableRepAmount) })
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
							<TransactionActionButton
								idleLabel='Withdraw REP'
								pendingLabel='Queueing REP withdrawal...'
								onClick={() => securityVault.onWithdrawRep()}
								pending={securityVault.securityVaultActiveAction === 'queueWithdrawRep'}
								tone='secondary'
								availability={{ disabled: withdrawRepGuardMessage !== undefined, reason: withdrawRepGuardMessage }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'set-bond-allowance'} onClose={() => setVaultActionModal(undefined)} title='Set Bond Allowance' description='Queue a new bond allowance using the latest valid oracle price for the selected vault.'>
				{selectedVaultDetails === undefined ? <p className='detail'>Refresh the selected vault before changing its bond allowance.</p> : null}
				{selectedVaultDetails === undefined ? null : (
					<>
						<div className='workflow-metric-grid'>
							<MetricField label='Current Bond Allowance'>
								<CurrencyValue value={selectedVaultDetails.securityBondAllowance} suffix='ETH' />
							</MetricField>
							<MetricField label='Price Valid Until'>{oraclePriceValidUntilTimestamp === undefined ? 'Unavailable' : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</div>
						<label className='field'>
							<span>Security Bond Allowance Amount</span>
							<FormInput value={securityVault.securityVaultForm.securityBondAllowanceAmount} onInput={event => securityVault.onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} />
						</label>
						<RequirementsChecklist
							items={[
								{ key: 'owned', label: 'Selected vault is owned by the connected account', resolved: selectedVaultIsOwnedByAccount },
								{ key: 'oracle', label: 'A valid oracle price is available', resolved: hasValidOraclePrice },
								{ key: 'allowance', label: 'Allowance amount is greater than zero', resolved: securityBondAllowanceAmount !== undefined && securityBondAllowanceAmount > 0n },
							]}
						/>
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => setVaultActionModal(undefined)}>
								Cancel
							</button>
							<TransactionActionButton
								idleLabel='Set Security Bond Allowance'
								pendingLabel='Queueing allowance update...'
								onClick={() => securityVault.onSetSecurityBondAllowance()}
								pending={securityVault.securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: setSecurityBondAllowanceGuardMessage !== undefined, reason: setSecurityBondAllowanceGuardMessage }}
							/>
						</div>
					</>
				)}
			</OperationModal>

			<OperationModal isOpen={vaultActionModal === 'claim-fees'} onClose={() => setVaultActionModal(undefined)} title='Claim Fees' description='Confirm the claimable fee balance before submitting the fee redemption for this vault.'>
				<div className='workflow-metric-grid'>
					<MetricField label='Claimable Fees'>{selectedVaultDetails === undefined ? '—' : <CurrencyValue value={selectedVaultDetails.unpaidEthFees} suffix='ETH' />}</MetricField>
					<MetricField label='Vault'>{selectedVaultAddress === '' ? 'None selected' : selectedVaultAddress}</MetricField>
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
					<TransactionActionButton idleLabel='Claim Fees' pendingLabel='Claiming fees...' onClick={() => securityVault.onRedeemFees()} pending={securityVault.securityVaultActiveAction === 'redeemFees'} availability={{ disabled: claimFeesGuardMessage !== undefined, reason: claimFeesGuardMessage }} />
				</div>
			</OperationModal>

			<LiquidationModal
				accountAddress={accountState.address}
				closeLiquidationModal={closeLiquidationModal}
				isMainnet={isMainnet}
				liquidationAmount={liquidationAmount}
				liquidationManagerAddress={liquidationManagerAddress}
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				liquidationTargetVault={liquidationTargetVault}
				securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onLiquidationTargetVaultChange={onLiquidationTargetVaultChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
