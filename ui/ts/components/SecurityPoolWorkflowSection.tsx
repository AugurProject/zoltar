import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { zeroAddress } from 'viem'
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
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { getQuestionTitle } from './Question.js'
import { ReportingSection } from './ReportingSection.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { SecurityVaultSection, SelectedVaultSummarySection } from './SecurityVaultSection.js'
import { StateHint } from './StateHint.js'
import { TradingSection } from './TradingSection.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { ViewTabs } from './ViewTabs.js'
import { TimestampValue } from './TimestampValue.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { hasForkActivity } from '../lib/forkAuction.js'
import { resolveRequestedLoadableValueState, type LoadableValueState } from '../lib/loadState.js'
import { isMainnetChain } from '../lib/network.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { getSelectedVaultAddress, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'
import { formatUniverseLabel } from '../lib/universe.js'
import { readSelectedPoolViewQueryParam, writeSelectedPoolViewQueryParam } from '../lib/urlParams.js'
import { resolveEnumValue } from '../lib/viewState.js'
import { formatDuration, formatRoundedCurrencyBalance } from '../lib/formatters.js'
import { getOracleManagerPriceValidUntilTimestamp } from '../lib/securityVault.js'
import { getTimeRemaining } from '../lib/time.js'
import type { ListedSecurityPool, OracleManagerDetails, SecurityPoolSystemState } from '../types/contracts.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../types/components.js'

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
	securityPoolOverviewActiveAction,
	securityPoolAddress,
	securityPools,
	securityVault,
	modeTabs,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & { modeTabs?: ComponentChildren; showHeader?: boolean }) {
	const [view, setView] = useState<SelectedPoolView>(() => resolveSelectedPoolView(readSelectedPoolViewQueryParam(window.location.search)))
	const [vaultView, setVaultView] = useState<SelectedVaultView>('selected-vault')
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
	const selectedPoolManagerAddressKey = normalizeAddress(selectedPoolManagerAddress)
	const currentPoolOracleManagerDetails = getCurrentPoolOracleManagerDetails({
		poolOracleManagerDetails,
		selectedPoolManagerAddress,
	})
	const selectedVaultAddressInput = securityVault.securityVaultForm.selectedVaultAddress ?? ''
	const selectedVaultAddress = getSelectedVaultAddress(selectedVaultAddressInput, accountState.address) ?? ''
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultAddressInput, accountState.address)
	const selectedPoolQuestionTitle = marketDetails === undefined ? undefined : getQuestionTitle(marketDetails)
	const selectedPoolQuestionDescription = marketDetails === undefined ? undefined : marketDetails.description.trim() === '' ? 'No description provided.' : marketDetails.description
	const selectedPoolLookupDisplay = getSelectedPoolLookupDisplay({
		hasSelectedPoolAddress,
		selectedPoolLookupState,
	})
	const lastAutoLoadedManagerAddress = useRef<string | undefined>(undefined)
	const lastReportingLoadedPoolAddress = useRef<string | undefined>(undefined)
	const lastForkLoadedPoolAddress = useRef<string | undefined>(undefined)
	const lastSelectedPoolVaultDefaultKey = useRef<string | undefined>(undefined)
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

	useEffect(() => {
		if (selectedPoolManagerAddress === undefined) return
		if (sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress)) return
		if (lastAutoLoadedManagerAddress.current === selectedPoolManagerAddressKey) return
		lastAutoLoadedManagerAddress.current = selectedPoolManagerAddressKey
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [onLoadPoolOracleManager, poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress, selectedPoolManagerAddressKey])

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (normalizedSelectedPoolAddress === undefined) return
		const selectedPoolVaultDefaultKey = `${normalizedSelectedPoolAddress}:${normalizeAddress(accountState.address) ?? ''}`
		if (lastSelectedPoolVaultDefaultKey.current === selectedPoolVaultDefaultKey) return
		lastSelectedPoolVaultDefaultKey.current = selectedPoolVaultDefaultKey
		setVaultView('selected-vault')
		if (accountState.address === undefined) return
		if (isSelectedVaultOwnedByAccountHelper(securityVault.securityVaultForm.selectedVaultAddress, accountState.address)) return
		securityVault.onSecurityVaultFormChange({ selectedVaultAddress: accountState.address.toString() })
	}, [accountState.address, selectedPool?.securityPoolAddress, securityVault.onSecurityVaultFormChange, securityVault.securityVaultForm.selectedVaultAddress])

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (view !== 'reporting' || !reportingReady || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) return
		if (lastReportingLoadedPoolAddress.current === normalizedSelectedPoolAddress) return
		lastReportingLoadedPoolAddress.current = normalizedSelectedPoolAddress
		void reporting.onLoadReporting()
	}, [reporting.onLoadReporting, reportingReady, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (view !== 'fork' || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) return
		if (lastForkLoadedPoolAddress.current === normalizedSelectedPoolAddress) return
		lastForkLoadedPoolAddress.current = normalizedSelectedPoolAddress
		void forkAuction.onLoadForkAuction()
	}, [forkAuction.onLoadForkAuction, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])

	useEffect(() => {
		const nextSearch = writeSelectedPoolViewQueryParam(window.location.search, hasSelectedPoolAddress ? view : undefined)
		window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}${window.location.hash}`)
	}, [hasSelectedPoolAddress, view])

	return (
		<RouteWorkflowPanel showHeader={showHeader} title='Selected Pool'>
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
									Requested price: <TransactionHashLink hash={poolPriceOracleResult.hash} />
								</p>
							)}
							{currentPoolOracleManagerDetails === undefined ? <p className='detail'>Load the price oracle to inspect the latest settlement details.</p> : undefined}
							<div className='actions'>
								<button className='secondary' onClick={() => onLoadPoolOracleManager(loadedSelectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
									{loadingPoolOracleManager ? <LoadingText>Refreshing oracle...</LoadingText> : currentPoolOracleManagerDetails === undefined ? 'Load Price Oracle' : 'Refresh Oracle'}
								</button>
								{currentPoolOracleManagerDetails === undefined ? undefined : (
									<TransactionActionButton
										idleLabel='Request New Price'
										pendingLabel='Requesting new price...'
										onClick={() => onRequestPoolPrice(loadedSelectedPool.managerAddress)}
										pending={poolOracleActiveAction === 'requestPrice'}
										tone='secondary'
										availability={{ disabled: requestPriceGuardMessage !== undefined, reason: requestPriceGuardMessage }}
									/>
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
						<ViewTabs ariaLabel='Selected pool views' className='selected-pool-workflow-nav' orientation='vertical' size='compact' value={view} onChange={setView} options={selectedPoolViewOptions} />
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
											<SecurityVaultSection {...securityVault} autoLoadVault compactLayout oracleManagerDetails={currentPoolOracleManagerDetails} showHeader={false} showLookupSection={false} showSecurityPoolAddressInput={false} showSummarySection={false} />
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
