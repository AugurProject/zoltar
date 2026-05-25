import { useEffect, useRef, useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OpenOraclePriceValue } from './OpenOraclePriceValue.js'
import { Question } from './Question.js'
import { ReportingSection } from './ReportingSection.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolVaultDirectory } from './SecurityPoolVaultDirectory.js'
import { SectionBlock } from './SectionBlock.js'
import { getQueuedVaultOperation, SecurityVaultSection, SelectedVaultSummarySection } from './SecurityVaultSection.js'
import { StickyObjectContext } from './StickyObjectContext.js'
import { StateHint } from './StateHint.js'
import { TradingSection } from './TradingSection.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { UniverseLink } from './UniverseLink.js'
import { ViewTabs } from './ViewTabs.js'
import { WarningSurface } from './WarningSurface.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { useChainTimestamp } from '../lib/chainTimestamp.js'
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
import { hasForkActivity } from '../lib/forkAuction.js'
import { getLiquidationNoticeState } from '../lib/liquidationStatus.js'
import { resolveRequestedLoadableValueState } from '../lib/loadState.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingLockedUntilMessage } from '../lib/reporting.js'
import { getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage } from '../lib/securityVaultGuards.js'
import { doesLoadedSecurityVaultMatchSelection, getSelectedVaultAddress, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { SecurityPoolSystemState } from '../types/contracts.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../types/components.js'

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
	securityPoolOverviewFeedback,
	securityPoolOverviewError,
	securityPoolOverviewResult,
	securityPoolAddress,
	securityPools,
	securityVault,
	onSelectedPoolViewChange,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & { showHeader?: boolean }) {
	const view = resolveSelectedPoolView(selectedPoolView)
	const chainCurrentTimestamp = useChainTimestamp()
	const [manualPendingOperationId, setManualPendingOperationId] = useState('')
	const [vaultView, setVaultView] = useState<SelectedVaultView>('selected-vault')
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedPool = securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, securityPoolAddress))
	const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
	const normalizedReportingFormPoolAddress = normalizeAddress(reporting.reportingForm.securityPoolAddress)
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
	const currentTimestamp = chainCurrentTimestamp ?? currentReportingDetails?.currentTime ?? currentForkAuctionDetails?.currentTime
	const reportingReady = marketDetails !== undefined && currentTimestamp !== undefined && marketDetails.endTime <= currentTimestamp
	const reportingLockedReason = reportingReady ? undefined : marketDetails === undefined ? 'Reporting opens after market end.' : getReportingLockedUntilMessage(marketDetails.endTime, currentTimestamp)
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
					{ label: 'Withdraw Escalation Deposits', value: 'withdraw-escalation-deposits' },
					{ label: 'Fork', value: 'fork' },
					{ label: 'Staged Operations', value: 'staged-operations' },
					{ label: 'Open Oracle', value: 'price-oracle' },
				]
			: [
					{ disabled: true, label: 'Vaults', reason: selectedPoolWorkflowGuardMessage, value: 'vaults' },
					{ disabled: true, label: 'Trading', reason: selectedPoolWorkflowGuardMessage, value: 'trading' },
					{ disabled: true, label: 'Reporting', reason: selectedPoolWorkflowGuardMessage, value: 'reporting' },
					{ disabled: true, label: 'Withdraw Escalation Deposits', reason: selectedPoolWorkflowGuardMessage, value: 'withdraw-escalation-deposits' },
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
	const selectedVaultDetails = doesLoadedSecurityVaultMatchSelection({
		accountAddress: accountState.address,
		securityPoolAddress: selectedPool?.securityPoolAddress,
		securityVaultDetails: securityVault.securityVaultDetails,
		selectedVaultAddress: selectedVaultAddressInput,
	})
		? securityVault.securityVaultDetails
		: undefined
	const currentSecurityVaultResult = selectedVaultDetails === undefined ? undefined : securityVault.securityVaultResult
	const selectedVaultAutoLoadKey = `${normalizeAddress(selectedVaultAddress) ?? ''}:${normalizeAddress(selectedPool?.securityPoolAddress) ?? ''}`
	const hasLoadedCurrentVault = selectedVaultDetails !== undefined && sameAddress(selectedVaultDetails.vaultAddress, selectedVaultAddress) && sameAddress(selectedVaultDetails.securityPoolAddress, selectedPool?.securityPoolAddress)
	const lastSelectedVaultAutoLoadKey = useRef<string | undefined>(undefined)
	const lastReportingAutoLoadKey = useRef<string | undefined>(undefined)
	const lastQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastImmediateQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastLiquidationOutcomeRefreshKey = useRef<string | undefined>(undefined)
	const lastExecutedOperationRefreshHash = useRef<string | undefined>(undefined)
	const queuedVaultOperation = getQueuedVaultOperation({
		pendingOperation: currentPoolOracleManagerDetails?.pendingOperation,
		selectedVaultAddress,
		securityVaultResult: currentSecurityVaultResult,
	})
	const liquidationNoticeState = getLiquidationNoticeState({
		currentPoolOracleManagerDetails,
		liquidationTargetVault,
		loadingPoolOracleManager,
		securityPoolOverviewResult,
	})
	const loadedSelectedPool = selectedPool
	const selectedPoolOracleMetricValues = loadedSelectedPool === undefined ? undefined : getSelectedPoolOracleMetricValues(loadedSelectedPool)
	const requestPriceGuardMessage = getVaultRequestPriceGuardMessage({
		accountAddress: accountState.address,
		hasLoadedSelectedPool: loadedSelectedPool !== undefined,
		isMainnet,
		pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
		requestPriceEthCost: currentPoolOracleManagerDetails?.requestPriceEthCost,
		walletEthBalance: accountState.ethBalance,
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
		if ((view !== 'reporting' && view !== 'withdraw-escalation-deposits') || !reportingReady || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) {
			lastReportingAutoLoadKey.current = undefined
			return
		}
		if (sameAddress(reporting.reportingDetails?.securityPoolAddress, normalizedSelectedPoolAddress)) return
		if (normalizedReportingFormPoolAddress === undefined || normalizedReportingFormPoolAddress !== normalizedSelectedPoolAddress) return
		if (reporting.loadingReportingDetails) return
		const reportingAutoLoadKey = `${normalizedSelectedPoolAddress}:${normalizedReportingFormPoolAddress}`
		if (lastReportingAutoLoadKey.current === reportingAutoLoadKey) return
		lastReportingAutoLoadKey.current = reportingAutoLoadKey
		void reporting.onLoadReporting()
	}, [normalizedReportingFormPoolAddress, normalizedSelectedPoolAddress, reporting.loadingReportingDetails, reporting.onLoadReporting, reporting.reportingDetails?.securityPoolAddress, reportingReady, showSelectedPoolWorkflowDetails, view])

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (view !== 'fork' || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) return
		if (sameAddress(forkAuction.forkAuctionDetails?.securityPoolAddress, normalizedSelectedPoolAddress)) return
		if (forkAuction.loadingForkAuctionDetails) return
		void forkAuction.onLoadForkAuction()
	}, [forkAuction.forkAuctionDetails?.securityPoolAddress, forkAuction.loadingForkAuctionDetails, forkAuction.onLoadForkAuction, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])

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
							<SecurityPoolSummaryMetrics className='selected-pool-context-grid' pool={loadedSelectedPool} repPerEthPrice={repPerEthPrice} repPerEthSource={repPerEthSource} repPerEthSourceUrl={repPerEthSourceUrl} showTotalBacking>
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
									</>
								)}
								{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
									<MetricField label='Pending Request'>
										<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
											Report #{currentPoolOracleManagerDetails.pendingReportId.toString()}
										</button>
									</MetricField>
								)}
							</SecurityPoolSummaryMetrics>
						</div>
						{marketDetails === undefined ? undefined : (
							<SectionBlock headingLevel={3} title='Question' variant='embedded'>
								<Question question={marketDetails} />
							</SectionBlock>
						)}
					</div>
				)}
			</StickyObjectContext>

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
											{vaultView === 'selected-vault' && selectedVaultDetails !== undefined ? (
												<SelectedVaultSummarySection
													repPerEthPrice={repPerEthPrice}
													repPerEthSource={repPerEthSource}
													repPerEthSourceUrl={repPerEthSourceUrl}
													securityBondAllowance={selectedVaultDetails.securityBondAllowance}
													securityVaultDetails={selectedVaultDetails}
													selectedPoolSecurityMultiplier={securityVault.selectedPoolSecurityMultiplier}
													selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
													variant='embedded'
												/>
											) : undefined}
										</SectionBlock>

										{vaultView === 'browse-vaults' ? (
											<SectionBlock title='Vault Directory'>
												<SecurityPoolVaultDirectory
													emptyState={selectedPool === undefined ? selectedPoolBrowsePresentation === undefined ? undefined : <StateHint presentation={selectedPoolBrowsePresentation} /> : <StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No vaults in this pool yet.' }} />}
													pool={selectedPool}
													renderActions={vault => {
														if (selectedPool === undefined) return undefined
														return (
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
														)
													}}
													renderBadge={vault => (selectedVaultAddress !== '' && sameCaseInsensitiveText(selectedVaultAddress, vault.vaultAddress) ? <span className='badge ok'>Selected</span> : undefined)}
													repPerEthPrice={repPerEthPrice}
													repPerEthSource={repPerEthSource}
													repPerEthSourceUrl={repPerEthSourceUrl}
												/>
											</SectionBlock>
										) : (
											<SecurityVaultSection
												{...securityVault}
												compactLayout
												extraReadinessActions={[
													{
														actionLabel: 'Liquidate Vault',
														description: 'Queue a high-risk liquidation against the selected vault.',
														key: 'liquidate-vault',
														readiness: 'ready',
														title: 'Liquidate Vault',
														...(selectedPool === undefined || selectedVaultDetails === undefined ? { blocker: 'Refresh the selected vault first.' } : selectedVaultAddress === '' ? { blocker: 'Select a pool and vault first.' } : {}),
														...(selectedPool === undefined || selectedVaultDetails === undefined || selectedVaultAddress === ''
															? {}
															: {
																	onAction: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, selectedVaultDetails.vaultAddress, selectedVaultDetails.securityBondAllowance),
																}),
													},
												]}
												modalFirst
												onViewStagedOperations={() => onSelectedPoolViewChange('staged-operations')}
												oracleManagerDetails={currentPoolOracleManagerDetails}
												selectedPoolTotalRepDeposit={selectedPool?.totalRepDeposit}
												selectedPoolTotalSecurityBondAllowance={selectedPool?.totalSecurityBondAllowance}
												showHeader={false}
												showLookupSection={false}
												showSecurityPoolAddressInput={false}
												showSummarySection={false}
											/>
										)}
									</div>
								) : undefined}

								{view === 'trading' ? <TradingSection {...trading} embedInCard showHeader={false} showSecurityPoolAddressInput={false} /> : undefined}

								{view === 'reporting' ? (
									<ReportingSection
										{...reporting}
										currentTimestamp={currentTimestamp}
										embedInCard
										lockedReason={reportingLockedReason}
										mode='full-reporting'
										previewMarketDetails={currentReportingDetails === undefined ? marketDetails : undefined}
										reportingDetails={currentReportingDetails}
										showHeader={false}
										showSecurityPoolAddressInput={false}
									/>
								) : undefined}

								{view === 'withdraw-escalation-deposits' ? (
									<ReportingSection
										{...reporting}
										currentTimestamp={currentTimestamp}
										embedInCard
										lockedReason={reportingLockedReason}
										mode='withdraw-only'
										previewMarketDetails={currentReportingDetails === undefined ? marketDetails : undefined}
										reportingDetails={currentReportingDetails}
										showHeader={false}
										showSecurityPoolAddressInput={false}
									/>
								) : undefined}

								{view === 'fork' ? (
									<ForkAuctionSection
										{...forkAuction}
										currentTimestamp={currentTimestamp}
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
										<SectionBlock density='compact' headingLevel={4} title='Staged Operations List' variant='embedded'>
											{currentPoolOracleManagerDetails?.pendingOperation === undefined ? null : (
												<WarningSurface as='article' className='warning-entity-card' variant='compact'>
													<div className='entity-card-header'>
														<div className='entity-card-copy'>
															<h3>{getPendingOperationLabel(currentPoolOracleManagerDetails.pendingOperation.operation)}</h3>
														</div>
													</div>
													<div className='entity-card-body workflow-metric-grid'>
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
												</WarningSurface>
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
				securityPoolOverviewError={securityPoolOverviewError}
				securityPoolOverviewFeedback={securityPoolOverviewFeedback}
				securityPoolOverviewResult={securityPoolOverviewResult}
				walletEthBalance={accountState.ethBalance}
				callerVaultSummary={accountState.address === undefined ? undefined : selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))}
				targetVaultSummary={selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault))}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
