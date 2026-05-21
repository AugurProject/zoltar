import { useEffect, useRef, useState } from 'preact/hooks'
import { zeroAddress } from 'viem'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { OpenOraclePriceValue } from './OpenOraclePriceValue.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { ResultBanner } from './ResultBanner.js'
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
import { TimestampValue } from './TimestampValue.js'
import { UniverseLink } from './UniverseLink.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { ViewTabs } from './ViewTabs.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js'
import {
	getCurrentPoolOracleManagerDetails,
	getSelectedPoolCardTitle,
	getSelectedPoolOracleMetricValues,
	getSelectedPoolWorkflowGuardMessage,
	getSelectedPoolWorkflowLockedPresentation,
	isForkWorkflowDisabled,
	resolveSelectedPoolView,
	shouldShowSelectedPoolWorkflowDetails,
	type SelectedPoolView,
} from '../lib/securityPoolWorkflow.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { balanceShortage } from '../lib/inputs.js'
import { hasForkActivity } from '../lib/forkAuction.js'
import { getLiquidationNoticeState } from '../lib/liquidationStatus.js'
import { resolveRequestedLoadableValueState } from '../lib/loadState.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { getVaultApprovalGuardMessage, getVaultClaimFeesGuardMessage, getVaultDepositGuardMessage, getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage, getVaultSetSecurityBondAllowanceGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'
import { deriveTokenApprovalRequirement } from '../lib/tokenApproval.js'
import {
	getSecurityVaultMaxBondAllowanceAmount,
	getSecurityVaultWithdrawableRepAmount,
	getSelectedVaultAddress,
	hasValidSecurityVaultOraclePrice,
	isSecurityVaultDepositBelowMinimum,
	isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper,
	MIN_SECURITY_BOND_ALLOWANCE,
	MIN_SECURITY_VAULT_REP_DEPOSIT,
} from '../lib/securityVault.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { OracleManagerDetails, SecurityPoolSystemState } from '../types/contracts.js'
import type { ReadinessAction, SecurityPoolWorkflowRouteContentProps, ViewTabOption, WorkflowOutcomePresentation } from '../types/components.js'

type SelectedVaultView = 'browse-vaults' | 'selected-vault'

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

function getSecurityPoolStatusBadgeTone(systemState: SecurityPoolSystemState) {
	return systemState === 'operational' ? 'ok' : 'warn'
}

function getQueuedVaultOperation({ pendingOperation, selectedVaultAddress, securityVaultResult }: { pendingOperation: OracleManagerDetails['pendingOperation']; selectedVaultAddress: string; securityVaultResult: SecurityPoolWorkflowRouteContentProps['securityVault']['securityVaultResult'] }) {
	if (pendingOperation === undefined) return undefined
	if (!sameAddress(pendingOperation.targetVault, selectedVaultAddress)) return undefined
	if (securityVaultResult?.action === 'queueWithdrawRep' && pendingOperation.operation === 'withdrawRep') return pendingOperation
	if (securityVaultResult?.action === 'queueSetSecurityBondAllowance' && pendingOperation.operation === 'setSecurityBondsAllowance') return pendingOperation
	return undefined
}

function getVaultQueuedOperationStatus({
	currentPoolOracleManagerDetails,
	loadingPoolOracleManager,
	queuedVaultOperation,
	securityVaultResult,
}: {
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	loadingPoolOracleManager: boolean
	queuedVaultOperation: ReturnType<typeof getQueuedVaultOperation>
	securityVaultResult: SecurityPoolWorkflowRouteContentProps['securityVault']['securityVaultResult']
}) {
	if (securityVaultResult?.action !== 'queueWithdrawRep' && securityVaultResult?.action !== 'queueSetSecurityBondAllowance') return undefined
	if (securityVaultResult.stagedExecution !== undefined) return securityVaultResult.stagedExecution.success ? 'executed' : 'failed'
	if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return 'refreshing'
	if (queuedVaultOperation !== undefined) return 'queued'
	if (currentPoolOracleManagerDetails.isPriceValid) return 'executed'
	return 'missing'
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

export function SecurityPoolWorkflowSection({
	accountState,
	activeUniverseId,
	checkedSecurityPoolAddress,
	closeLiquidationModal,
	forkAuction,
	liquidationAmount,
	liquidationMaxAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	loadingPoolOracleManager,
	loadingSecurityPools,
	onLiquidationAmountChange,
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
	securityPoolOverviewResult,
	securityPoolAddress,
	securityPools,
	securityVault,
	onSelectedPoolViewChange,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & { showHeader?: boolean }) {
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
					{ label: 'Staged Operations', value: 'staged-operations' },
					{ label: 'Open Oracle', value: 'price-oracle' },
				]
			: [
					{ disabled: true, label: 'Vaults', reason: selectedPoolWorkflowGuardMessage, value: 'vaults' },
					{ disabled: true, label: 'Trading', reason: selectedPoolWorkflowGuardMessage, value: 'trading' },
					{ disabled: true, label: 'Reporting', reason: selectedPoolWorkflowGuardMessage, value: 'reporting' },
					{ disabled: true, label: 'Fork', reason: selectedPoolWorkflowGuardMessage, value: 'fork' },
					{ disabled: true, label: 'Staged Operations', reason: selectedPoolWorkflowGuardMessage, value: 'staged-operations' },
					{ disabled: true, label: 'Open Oracle', reason: selectedPoolWorkflowGuardMessage, value: 'price-oracle' },
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
	const selectedVaultSecurityPoolAddress = securityVault.securityVaultForm.securityPoolAddress.trim()
	const selectedVaultDetails = securityVault.securityVaultDetails
	const selectedVaultAutoLoadKey = `${normalizeAddress(selectedVaultAddress) ?? ''}:${normalizeAddress(selectedPool?.securityPoolAddress) ?? ''}`
	const hasLoadedCurrentVault = selectedVaultDetails !== undefined && sameAddress(selectedVaultDetails.vaultAddress, selectedVaultAddress) && sameAddress(selectedVaultDetails.securityPoolAddress, selectedPool?.securityPoolAddress)
	const lastSelectedVaultAutoLoadKey = useRef<string | undefined>(undefined)
	const lastQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastImmediateQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastLiquidationOutcomeRefreshKey = useRef<string | undefined>(undefined)
	const lastExecutedOperationRefreshHash = useRef<string | undefined>(undefined)
	const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(selectedVaultDetails?.managerAddress, currentPoolOracleManagerDetails)
	const depositAmount = (() => {
		try {
			return parseRepAmountInput(securityVault.securityVaultForm.depositAmount ?? '', 'REP collateral amount')
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
	const withdrawableRepAmount = getSecurityVaultWithdrawableRepAmount({
		lockedRepInEscalationGame: selectedVaultDetails?.lockedRepInEscalationGame,
		repDepositShare: selectedVaultDetails?.repDepositShare,
		repPerEthPrice: hasValidOraclePrice ? currentPoolOracleManagerDetails?.lastPrice : undefined,
		securityBondAllowance: selectedVaultDetails?.securityBondAllowance,
		totalRepDeposit: selectedPool?.totalRepDeposit,
		totalSecurityBondAllowance: selectedPool?.totalSecurityBondAllowance,
	})
	const maxSecurityBondAllowanceAmount = getSecurityVaultMaxBondAllowanceAmount({
		currentSecurityBondAllowance: selectedVaultDetails?.securityBondAllowance,
		repDepositShare: selectedVaultDetails?.repDepositShare,
		repPerEthPrice: hasValidOraclePrice ? currentPoolOracleManagerDetails?.lastPrice : undefined,
		totalRepDeposit: selectedPool?.totalRepDeposit,
		totalSecurityBondAllowance: selectedPool?.totalSecurityBondAllowance,
	})
	const isDepositBelowMinimum = isSecurityVaultDepositBelowMinimum(selectedVaultDetails?.repDepositShare, depositAmount)
	const hasClaimableFees = selectedVaultDetails !== undefined && selectedVaultDetails.unpaidEthFees > 0n
	const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? currentPoolOracleManagerDetails?.priceValidUntilTimestamp : undefined
	const approvalGuardMessage = getVaultApprovalGuardMessage({
		accountAddress: accountState.address,
		isMainnet,
		selectedVaultDetailsLoaded: selectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
	})
	const depositGuardMessage = getVaultDepositGuardMessage({
		accountAddress: accountState.address,
		approvalSatisfied: approvalRequirement.hasSufficientApproval,
		isDepositBelowMinimum,
		isMainnet,
		repBalanceGap,
		selectedVaultDetailsLoaded: selectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
	})
	const withdrawRepGuardMessage = getVaultWithdrawGuardMessage({
		accountAddress: accountState.address,
		hasValidOraclePrice,
		isMainnet,
		selectedVaultIsOwnedByAccount,
		withdrawAmount,
		withdrawableRepAmount,
	})
	const setSecurityBondAllowanceGuardMessage = getVaultSetSecurityBondAllowanceGuardMessage({
		hasValidOraclePrice,
		isMainnet,
		maxSecurityBondAllowanceAmount,
		securityBondAllowanceAmount,
		selectedVaultDetailsLoaded: selectedVaultDetails !== undefined,
		selectedVaultIsOwnedByAccount,
	})
	const hasValidSecurityBondAllowanceAmount = securityBondAllowanceAmount !== undefined && securityBondAllowanceAmount >= 0n && (securityBondAllowanceAmount === 0n || securityBondAllowanceAmount >= MIN_SECURITY_BOND_ALLOWANCE)
	const claimFeesGuardMessage = getVaultClaimFeesGuardMessage({
		hasClaimableFees,
		isMainnet,
		selectedVaultIsOwnedByAccount,
	})
	const vaultReadinessActions = getSecurityPoolVaultReadinessActions([
		{
			actionLabel: 'Deposit REP',
			description: 'Add REP to the selected vault.',
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
			...(selectedPool === undefined || selectedVaultAddress === '' ? {} : { onAction: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, selectedVaultAddress as `0x${string}`, selectedVaultDetails?.securityBondAllowance) }),
		},
	] satisfies ReadinessAction[])
	const vaultWorkflowOutcome = getVaultWorkflowOutcomePresentation(securityVault.securityVaultResult)
	const queuedVaultOperation = getQueuedVaultOperation({
		pendingOperation: currentPoolOracleManagerDetails?.pendingOperation,
		selectedVaultAddress,
		securityVaultResult: securityVault.securityVaultResult,
	})
	const queuedVaultOperationStatus = getVaultQueuedOperationStatus({
		currentPoolOracleManagerDetails,
		loadingPoolOracleManager,
		queuedVaultOperation,
		securityVaultResult: securityVault.securityVaultResult,
	})
	const liquidationNoticeState = getLiquidationNoticeState({
		currentPoolOracleManagerDetails,
		liquidationTargetVault,
		loadingPoolOracleManager,
		securityPoolOverviewResult,
	})
	const selectedPoolQuestionDescription = marketDetails === undefined ? undefined : marketDetails.description.trim() === '' ? undefined : marketDetails.description
	const loadedSelectedPool = selectedPool
	const selectedPoolOracleMetricValues = loadedSelectedPool === undefined ? undefined : getSelectedPoolOracleMetricValues(loadedSelectedPool)
	const requestPriceGuardMessage = getVaultRequestPriceGuardMessage({
		accountAddress: accountState.address,
		hasLoadedSelectedPool: loadedSelectedPool !== undefined,
		isMainnet,
		pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
	})
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
	const executePendingOperationGuardMessage = getVaultExecutePendingOperationGuardMessage({
		accountAddress: accountState.address,
		hasLoadedOracleManager: currentPoolOracleManagerDetails !== undefined,
		isMainnet,
		isPriceValid: currentPoolOracleManagerDetails?.isPriceValid,
		resolvedPendingOperationId,
	})
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
		if (selectedPoolManagerAddress === undefined) return
		if (loadingPoolOracleManager) return

		const queuedOperationHash =
			securityVault.securityVaultResult?.action === 'queueSetSecurityBondAllowance' || securityVault.securityVaultResult?.action === 'queueWithdrawRep' ? securityVault.securityVaultResult.hash : securityPoolOverviewResult?.action === 'queueLiquidation' ? securityPoolOverviewResult.hash : undefined

		if (queuedOperationHash === undefined) {
			lastQueuedOperationRefreshHash.current = undefined
			return
		}
		if (lastQueuedOperationRefreshHash.current === queuedOperationHash) return
		lastQueuedOperationRefreshHash.current = queuedOperationHash
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [loadingPoolOracleManager, onLoadPoolOracleManager, securityPoolOverviewResult, securityVault.securityVaultResult, selectedPoolManagerAddress])

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (normalizedSelectedPoolAddress === undefined) return
		setVaultView('selected-vault')
		if (accountState.address === undefined) return
		if (isSelectedVaultOwnedByAccountHelper(securityVault.securityVaultForm.selectedVaultAddress, accountState.address)) return
		securityVault.onSecurityVaultFormChange({ selectedVaultAddress: accountState.address.toString() })
	}, [accountState.address, securityVault.onSecurityVaultFormChange, securityVault.securityVaultForm.selectedVaultAddress, selectedPoolVaultDefaultKey])

	useEffect(() => {
		if (!showSelectedPoolWorkflowDetails || view !== 'vaults') return
		if (accountState.address === undefined) return
		if (selectedPool?.securityPoolAddress === undefined || selectedVaultAddress === '') return
		if (!sameAddress(selectedVaultSecurityPoolAddress, selectedPool.securityPoolAddress)) return
		if (hasLoadedCurrentVault || securityVault.loadingSecurityVault) return
		if (lastSelectedVaultAutoLoadKey.current === selectedVaultAutoLoadKey) return
		lastSelectedVaultAutoLoadKey.current = selectedVaultAutoLoadKey
		void securityVault.onLoadSecurityVault()
	}, [accountState.address, hasLoadedCurrentVault, securityVault.loadingSecurityVault, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, selectedVaultAddress, selectedVaultAutoLoadKey, selectedVaultSecurityPoolAddress, showSelectedPoolWorkflowDetails, view])

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
		if (securityVault.securityVaultResult.action === 'approveRep' || securityVault.securityVaultResult.action === 'queueSetSecurityBondAllowance' || securityVault.securityVaultResult.action === 'queueWithdrawRep') {
			return
		}
		setVaultActionModal(undefined)
	}, [securityVault.securityVaultResult])

	useEffect(() => {
		const queuedOperationHash = securityVault.securityVaultResult?.action === 'queueSetSecurityBondAllowance' || securityVault.securityVaultResult?.action === 'queueWithdrawRep' ? securityVault.securityVaultResult.hash : undefined
		if (queuedOperationHash === undefined) {
			lastImmediateQueuedOperationRefreshHash.current = undefined
			return
		}
		if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return
		if (queuedVaultOperation !== undefined || !currentPoolOracleManagerDetails.isPriceValid) return
		if (lastImmediateQueuedOperationRefreshHash.current === queuedOperationHash) return
		lastImmediateQueuedOperationRefreshHash.current = queuedOperationHash
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) {
			void securityVault.onLoadSecurityVault()
		}
	}, [currentPoolOracleManagerDetails, hasLoadedCurrentVault, loadingPoolOracleManager, onRefreshSelectedPoolData, queuedVaultOperation, securityVault.onLoadSecurityVault, securityVault.securityVaultResult, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])

	useEffect(() => {
		const liquidationRefreshKey = securityPoolOverviewResult?.action !== 'queueLiquidation' || liquidationNoticeState === undefined || liquidationNoticeState === 'submitted' ? undefined : `${securityPoolOverviewResult.hash}:${liquidationNoticeState}`
		if (liquidationRefreshKey === undefined) {
			lastLiquidationOutcomeRefreshKey.current = undefined
			return
		}
		if (lastLiquidationOutcomeRefreshKey.current === liquidationRefreshKey) return
		lastLiquidationOutcomeRefreshKey.current = liquidationRefreshKey
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) {
			void securityVault.onLoadSecurityVault()
		}
	}, [hasLoadedCurrentVault, liquidationNoticeState, onRefreshSelectedPoolData, securityPoolOverviewResult, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])

	useEffect(() => {
		if (poolPriceOracleResult?.action !== 'executeStagedOperation') {
			lastExecutedOperationRefreshHash.current = undefined
			return
		}
		if (poolPriceOracleResult.stagedExecution?.success === false) {
			lastExecutedOperationRefreshHash.current = poolPriceOracleResult.hash
			return
		}
		if (lastExecutedOperationRefreshHash.current === poolPriceOracleResult.hash) return
		lastExecutedOperationRefreshHash.current = poolPriceOracleResult.hash
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) {
			void securityVault.onLoadSecurityVault()
		}
	}, [hasLoadedCurrentVault, onRefreshSelectedPoolData, poolPriceOracleResult, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])

	return (
		<RouteWorkflowPanel showHeader={showHeader} title='Selected Pool'>
			{securityPoolOverviewResult === undefined || liquidationNoticeState === undefined ? undefined : liquidationNoticeState === 'failed' ? (
				<div className='notice error'>
					<strong>Liquidation failed</strong>
					<p>
						Pool <AddressValue address={securityPoolOverviewResult.securityPoolAddress} />: <TransactionHashLink hash={securityPoolOverviewResult.hash} />
					</p>
					{securityPoolOverviewResult.stagedExecution?.errorMessage === undefined ? undefined : <p>{securityPoolOverviewResult.stagedExecution.errorMessage}</p>}
				</div>
			) : (
				<p className='notice success'>
					{liquidationNoticeState === 'successful' ? 'Liquidation successful' : liquidationNoticeState === 'queued' ? 'Liquidation queued' : 'Liquidation submitted'} for <AddressValue address={securityPoolOverviewResult.securityPoolAddress} />: <TransactionHashLink hash={securityPoolOverviewResult.hash} />
				</p>
			)}
			<StickyObjectContext {...(loadedSelectedPool === undefined ? {} : { badge: <span className={`badge ${getSecurityPoolStatusBadgeTone(loadedSelectedPool.systemState)}`}>{loadedSelectedPool.systemState}</span> })} sticky={false} title={getSelectedPoolCardTitle()} items={[]}>
				<div className='selected-pool-context-controls'>
					<div className='selected-pool-context-lookup'>
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
					</div>
				</div>
				{loadedSelectedPool === undefined ? undefined : (
					<div className='selected-pool-context-summary'>
						<div className='selected-pool-context-overview'>
							{selectedPoolQuestionDescription === undefined ? undefined : <p className='detail selected-pool-context-description'>{selectedPoolQuestionDescription}</p>}
							<div className='selected-pool-context-grid'>
								<MetricField label='Vaults'>{loadedSelectedPool.vaultCount.toString()}</MetricField>
								<MetricField label='Security Multiplier'>{loadedSelectedPool.securityMultiplier.toString()}</MetricField>
								<MetricField label='Open Interest Fee / Year'>
									<CurrencyValue value={openInterestFeePerYearBigint(loadedSelectedPool.currentRetentionRate)} suffix='%' />
								</MetricField>
								<MetricField label='Total REP Collateral'>
									<CurrencyValue value={loadedSelectedPool.totalRepDeposit} suffix='REP' />
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
								<MetricField label='Open Oracle Price' valueTagName='span'>
									<OpenOraclePriceValue
										currentTimestamp={currentTimestamp}
										lastPrice={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice}
										lastSettlementTimestamp={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp ?? 0n}
										priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp}
									/>
								</MetricField>
								{loadedSelectedPool.systemState === 'operational' ? undefined : (
									<>
										<MetricField label='Fork Mode'>{loadedSelectedPool.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent / Zoltar fork'}</MetricField>
										<MetricField label='Fork Outcome'>{loadedSelectedPool.forkOutcome}</MetricField>
										{loadedSelectedPool.truthAuctionAddress === zeroAddress ? undefined : (
											<MetricField label='Truth Auction'>
												<AddressValue address={loadedSelectedPool.truthAuctionAddress} />
											</MetricField>
										)}
									</>
								)}
								{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
									<MetricField label='Pending Request'>
										<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
											Report #{currentPoolOracleManagerDetails.pendingReportId.toString()}
										</button>
									</MetricField>
								)}
							</div>
						</div>
					</div>
				)}
			</StickyObjectContext>

			<ResultBanner outcome={vaultWorkflowOutcome} />

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
							<SectionBlock title={selectedPoolLookupState === 'missing' ? 'Pool not found' : 'Pool Workflows'}>{selectedPoolWorkflowLockedPresentation === undefined ? undefined : <StateHint presentation={selectedPoolWorkflowLockedPresentation} />}</SectionBlock>
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
												</div>
											}
										>
											{selectedVaultLoadNotice}
											<LookupFieldRow
												label='Selected Vault Address'
												value={selectedVaultAddressInput}
												onInput={selectedVaultAddress => securityVault.onSecurityVaultFormChange({ selectedVaultAddress })}
												placeholder='0x...'
												action={
													<button className='secondary' onClick={() => securityVault.onLoadSecurityVault()} disabled={securityVault.loadingSecurityVault}>
														{securityVault.loadingSecurityVault ? <LoadingText>Refreshing...</LoadingText> : 'Refresh'}
													</button>
												}
											/>
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
																		<button
																			className='destructive'
																			onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress, vault.securityBondAllowance)}
																			disabled={accountState.address === undefined || !isMainnet || currentPoolOracleManagerDetails?.isPriceValid === false}
																		>
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
												<SectionBlock title='Vault Action Launchers'>
													<div className='vault-action-launcher-grid'>
														{vaultReadinessActions.map(action => (
															<ActionLauncherCard key={action.key} action={action} />
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

								{view === 'staged-operations' && loadedSelectedPool !== undefined ? (
									<SectionBlock density='compact' title='Staged Operations'>
										<ErrorNotice message={poolOracleManagerError} />
										{poolPriceOracleResult === undefined ? undefined : poolPriceOracleResult.action === 'executeStagedOperation' && poolPriceOracleResult.stagedExecution?.success === false ? (
											<ErrorNotice message={poolPriceOracleResult.stagedExecution.errorMessage ?? 'Failed to execute the staged operation'} />
										) : (
											<p className='notice success'>
												{poolPriceOracleResult.action === 'executeStagedOperation' ? 'Executed staged operation' : 'Requested price'}: <TransactionHashLink hash={poolPriceOracleResult.hash} />
											</p>
										)}
										<SectionBlock density='compact' headingLevel={4} title='Staged Operations List' variant='embedded'>
											{currentPoolOracleManagerDetails?.pendingOperation === undefined ? null : (
												<EntityCard className='compact' title={getPendingOperationLabel(currentPoolOracleManagerDetails.pendingOperation.operation)} variant='compact' badge={<span className='badge warn'>Queued</span>}>
													<div className='workflow-metric-grid'>
														<MetricField label='Operation Id'>{currentPoolOracleManagerDetails.pendingOperation.operationId.toString()}</MetricField>
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
												</EntityCard>
											)}
											{currentPoolOracleManagerDetails === undefined || currentPoolOracleManagerDetails.pendingOperation !== undefined ? null : <StateHint presentation={{ key: 'empty', badgeLabel: 'None queued', badgeTone: 'muted', detail: 'No staged operations are currently queued for this pool.' }} />}
										</SectionBlock>
										{currentPoolOracleManagerDetails === undefined ? undefined : (
											<label className='field'>
												<span>Staged Operation Id</span>
												<FormInput value={manualPendingOperationId} onInput={event => setManualPendingOperationId(event.currentTarget.value)} placeholder={selectedPendingOperationId > 0n ? selectedPendingOperationId.toString() : '0'} />
											</label>
										)}
										<div className='actions'>
											<button className='secondary' onClick={() => onLoadPoolOracleManager(loadedSelectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
												{loadingPoolOracleManager ? <LoadingText>Refreshing operations...</LoadingText> : currentPoolOracleManagerDetails === undefined ? 'Load Staged Operations' : 'Refresh Staged Operations'}
											</button>
											{currentPoolOracleManagerDetails === undefined ? undefined : (
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
											)}
										</div>
									</SectionBlock>
								) : undefined}

								{view === 'price-oracle' && loadedSelectedPool !== undefined ? (
									<SectionBlock density='compact' title='Open Oracle'>
										<div className='workflow-metric-grid'>
											<MetricField label='Open Oracle Price' valueTagName='span'>
												<OpenOraclePriceValue
													currentTimestamp={currentTimestamp}
													lastPrice={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice}
													lastSettlementTimestamp={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp ?? 0n}
													priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp}
												/>
											</MetricField>
											{currentPoolOracleManagerDetails === undefined ? undefined : (
												<MetricField label='Request Cost'>
													<CurrencyValue value={currentPoolOracleManagerDetails.requestPriceEthCost} suffix='ETH' />
												</MetricField>
											)}
											{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
												<MetricField label='Pending Request'>
													<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
														Report #{currentPoolOracleManagerDetails.pendingReportId.toString()}
													</button>
												</MetricField>
											)}
										</div>
										<ErrorNotice message={poolOracleManagerError} />
										{poolPriceOracleResult === undefined ? undefined : poolPriceOracleResult.action === 'executeStagedOperation' && poolPriceOracleResult.stagedExecution?.success === false ? (
											<ErrorNotice message={poolPriceOracleResult.stagedExecution.errorMessage ?? 'Failed to execute the staged operation'} />
										) : (
											<p className='notice success'>
												{poolPriceOracleResult.action === 'requestPrice' ? 'Requested price' : 'Executed staged operation'}: <TransactionHashLink hash={poolPriceOracleResult.hash} />
											</p>
										)}
										<div className='actions'>
											<button className='secondary' onClick={() => onLoadPoolOracleManager(loadedSelectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
												{loadingPoolOracleManager ? <LoadingText>Refreshing oracle...</LoadingText> : 'Refresh Oracle'}
											</button>
											<TransactionActionButton
												idleLabel='Request New Price'
												pendingLabel='Requesting new price...'
												onClick={() => onRequestPoolPrice(loadedSelectedPool.managerAddress)}
												pending={poolOracleActiveAction === 'requestPrice'}
												tone='secondary'
												availability={{ disabled: requestPriceGuardMessage !== undefined, reason: requestPriceGuardMessage }}
											/>
										</div>
									</SectionBlock>
								) : undefined}
							</>
						)}
					</div>
				</div>
			</section>

			<OperationModal isOpen={vaultActionModal === 'deposit-rep'} onClose={() => setVaultActionModal(undefined)} title='Deposit REP' description='Review the selected vault, then deposit REP.'>
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
							<span>REP Collateral Amount</span>
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
						<div className='workflow-metric-grid'>
							<MetricField label='Wallet REP'>
								<CurrencyValue value={securityVault.securityVaultRepBalance} suffix='REP' />
							</MetricField>
						</div>
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
						{securityVault.securityVaultResult?.action !== 'queueWithdrawRep' ? null : queuedVaultOperationStatus === 'queued' ? (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>REP Withdrawal Queued</h4>
									</div>
									<span className='badge warn'>Queued</span>
								</div>
								<div className='workflow-metric-grid'>
									<MetricField label='Staged Operation'>{queuedVaultOperation === undefined ? 'Refreshing...' : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
									<MetricField label='Amount'>{queuedVaultOperation === undefined ? 'Refreshing...' : <CurrencyValue value={queuedVaultOperation.amount} suffix='REP' />}</MetricField>
								</div>
								<div className='actions'>
									<button className='secondary' type='button' onClick={() => onSelectedPoolViewChange('staged-operations')}>
										View In Staged Operations
									</button>
								</div>
							</section>
						) : queuedVaultOperationStatus === 'failed' ? (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>REP Withdrawal Failed</h4>
									</div>
									<span className='badge blocked'>Failed</span>
								</div>
								<p className='detail'>{securityVault.securityVaultResult.stagedExecution?.errorMessage ?? 'The oracle manager attempted the withdrawal immediately, but the security pool rejected it.'}</p>
							</section>
						) : queuedVaultOperationStatus === 'executed' ? (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>REP Withdrawal Executed</h4>
									</div>
									<span className='badge ok'>Executed</span>
								</div>
								<p className='detail'>A valid oracle price was already available, so the withdrawal executed immediately and no staged operation was created.</p>
							</section>
						) : queuedVaultOperationStatus === 'missing' ? (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>REP Withdrawal Submitted</h4>
									</div>
									<span className='badge warn'>Check State</span>
								</div>
								<p className='detail'>The transaction succeeded, but no matching staged operation is currently visible for this vault. Refresh staged operations to confirm the latest manager state.</p>
							</section>
						) : (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>Refreshing Withdrawal State</h4>
									</div>
									<span className='badge muted'>Refreshing</span>
								</div>
								<p className='detail'>Refreshing the oracle manager to determine whether the withdrawal was queued or executed immediately.</p>
							</section>
						)}
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
						{securityVault.securityVaultResult?.action !== 'queueSetSecurityBondAllowance' ? null : queuedVaultOperationStatus === 'queued' ? (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>Bond Allowance Queued</h4>
									</div>
									<span className='badge warn'>Queued</span>
								</div>
								<div className='workflow-metric-grid'>
									<MetricField label='Staged Operation'>{queuedVaultOperation === undefined ? 'Refreshing...' : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
									<MetricField label='Amount'>{queuedVaultOperation === undefined ? 'Refreshing...' : <CurrencyValue value={queuedVaultOperation.amount} suffix='REP' />}</MetricField>
								</div>
								<div className='actions'>
									<button className='secondary' type='button' onClick={() => onSelectedPoolViewChange('staged-operations')}>
										View In Staged Operations
									</button>
								</div>
							</section>
						) : queuedVaultOperationStatus === 'failed' ? (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>Bond Allowance Failed</h4>
									</div>
									<span className='badge blocked'>Failed</span>
								</div>
								<p className='detail'>{securityVault.securityVaultResult.stagedExecution?.errorMessage ?? 'The oracle manager attempted the allowance update immediately, but the security pool rejected it.'}</p>
							</section>
						) : queuedVaultOperationStatus === 'executed' ? (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>Bond Allowance Executed</h4>
									</div>
									<span className='badge ok'>Executed</span>
								</div>
								<p className='detail'>A valid oracle price was already available, so the new bond allowance executed immediately and no staged operation was created.</p>
							</section>
						) : queuedVaultOperationStatus === 'missing' ? (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>Bond Allowance Submitted</h4>
									</div>
									<span className='badge warn'>Check State</span>
								</div>
								<p className='detail'>The transaction succeeded, but no matching staged operation is currently visible for this vault. Refresh staged operations to confirm the latest manager state.</p>
							</section>
						) : (
							<section className='entity-card compact'>
								<div className='entity-card-header'>
									<div>
										<h4>Refreshing Bond Allowance State</h4>
									</div>
									<span className='badge muted'>Refreshing</span>
								</div>
								<p className='detail'>Refreshing the oracle manager to determine whether the bond allowance was queued or executed immediately.</p>
							</section>
						)}
						<div className='workflow-metric-grid'>
							<MetricField label='Current Bond Allowance'>
								<CurrencyValue value={selectedVaultDetails.securityBondAllowance} suffix='ETH' />
							</MetricField>
							<MetricField label='Price Valid Until'>{oraclePriceValidUntilTimestamp === undefined ? 'Unavailable' : <TimestampValue timestamp={oraclePriceValidUntilTimestamp} />}</MetricField>
						</div>
						<label className='field'>
							<span>Security Bond Allowance Amount</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={securityVault.securityVaultForm.securityBondAllowanceAmount} onInput={event => securityVault.onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} />
								<button className='quiet field-inline-action' type='button' onClick={() => securityVault.onSecurityVaultFormChange({ securityBondAllowanceAmount: formatCurrencyInputBalance(maxSecurityBondAllowanceAmount) })} disabled={maxSecurityBondAllowanceAmount <= 0n}>
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
					<MetricField label='Vault'>{selectedVaultAddress === '' ? 'None selected' : <AddressValue address={selectedVaultAddress} />}</MetricField>
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
				currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
				isMainnet={isMainnet}
				liquidationAmount={liquidationAmount}
				liquidationMaxAmount={liquidationMaxAmount}
				liquidationManagerAddress={liquidationManagerAddress}
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				loadingPoolOracleManager={loadingPoolOracleManager}
				liquidationTargetVault={liquidationTargetVault}
				onLoadPoolOracleManager={onLoadPoolOracleManager}
				onSelectedPoolViewChange={onSelectedPoolViewChange}
				repPerEthPrice={repPerEthPrice}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				selectedPool={selectedPool}
				securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
				securityPoolOverviewResult={securityPoolOverviewResult}
				callerVaultSummary={accountState.address === undefined ? undefined : selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))}
				targetVaultSummary={selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault))}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
