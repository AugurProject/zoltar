import { useEffect, useRef, useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { Question, getQuestionTitle } from './Question.js'
import { ReportingSection } from './ReportingSection.js'
import { SecurityVaultSection } from './SecurityVaultSection.js'
import { StateHint } from './StateHint.js'
import { TradingSection } from './TradingSection.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { CurrencyValue } from './CurrencyValue.js'
import { TimestampValue } from './TimestampValue.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { resolveRequestedLoadableValueState, type LoadableValueState } from '../lib/loadState.js'
import { isMainnetChain } from '../lib/network.js'
import { getSelectedVaultAddress, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import { formatUniverseLabel } from '../lib/universe.js'
import { readSelectedPoolViewQueryParam, writeSelectedPoolViewQueryParam } from '../lib/urlParams.js'
import { resolveEnumValue } from '../lib/viewState.js'
import type { SecurityPoolSystemState } from '../types/contracts.js'
import type { SecurityPoolWorkflowRouteContentProps } from '../types/components.js'

type SelectedPoolView = 'vaults' | 'trading' | 'resolution'
type SelectedVaultView = 'browse-vaults' | 'selected-vault'
type SelectedPoolLookupDisplay = 'empty' | LoadableValueState

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

export function isForkWorkflowDisabled(selectedPoolState: SecurityPoolSystemState | undefined) {
	return selectedPoolState === undefined || selectedPoolState === 'operational'
}

export function getOracleLastPriceDisplay({ lastPrice, lastSettlementTimestamp }: { lastPrice: bigint; lastSettlementTimestamp: bigint }) {
	if (lastSettlementTimestamp === 0n) return '-'
	return lastPrice.toString()
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
	onRequestPoolPrice,
	onViewPendingReport,
	poolOracleManagerDetails,
	poolOracleManagerError,
	poolPriceOracleResult,
	onSecurityPoolAddressChange,
	repEthPrice,
	repEthSource,
	repEthSourceUrl,
	reporting,
	securityPoolAddress,
	securityPools,
	securityVault,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & { showHeader?: boolean }) {
	const [view, setView] = useState<SelectedPoolView>(() => resolveEnumValue<SelectedPoolView>(readSelectedPoolViewQueryParam(window.location.search), 'vaults', ['vaults', 'trading', 'resolution']))
	const [vaultView, setVaultView] = useState<SelectedVaultView>('selected-vault')
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedPool = securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, securityPoolAddress))
	const selectedPoolLookupState = resolveRequestedLoadableValueState({
		currentKey: normalizeAddress(securityPoolAddress),
		isLoading: loadingSecurityPools,
		resolvedKey: checkedSecurityPoolAddress,
		value: selectedPool,
	})
	const marketDetails = selectedPool?.marketDetails ?? reporting.reportingDetails?.marketDetails ?? forkAuction.forkAuctionDetails?.marketDetails
	const selectedPoolState = selectedPool?.systemState ?? forkAuction.forkAuctionDetails?.systemState
	const currentTimestamp = reporting.reportingDetails?.currentTime ?? BigInt(Math.floor(Date.now() / 1000))
	const reportingReady = marketDetails !== undefined && marketDetails.endTime <= currentTimestamp
	const forkWorkflowDisabled = isForkWorkflowDisabled(selectedPoolState)
	const selectedPoolUniverseMismatch = selectedPool !== undefined && selectedPool.universeId !== activeUniverseId
	const hasSelectedPoolAddress = securityPoolAddress.trim() !== ''
	const showSelectedPoolWorkflowDetails = shouldShowSelectedPoolWorkflowDetails({
		hasSelectedPoolAddress,
		selectedPoolExists: selectedPool !== undefined,
		selectedPoolUniverseMismatch,
	})
	const selectedPoolManagerAddress = selectedPool?.managerAddress
	const selectedPoolManagerAddressKey = normalizeAddress(selectedPoolManagerAddress)
	const selectedVaultAddress = getSelectedVaultAddress(securityVault.securityVaultForm.selectedVaultAddress, accountState.address) ?? ''
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultAddress, accountState.address)
	const resolvedSelectedPoolTitle = selectedPool === undefined ? undefined : getQuestionTitle(selectedPool.marketDetails)
	const selectedPoolTitle = getSelectedPoolCardTitle({
		hasSelectedPoolAddress,
		resolvedPoolTitle: resolvedSelectedPoolTitle,
	})
	const selectedPoolLookupDisplay = getSelectedPoolLookupDisplay({
		hasSelectedPoolAddress,
		selectedPoolLookupState,
	})
	const lastAutoLoadedManagerAddress = useRef<string | undefined>(undefined)
	const lastSelectedPoolVaultDefaultKey = useRef<string | undefined>(undefined)
	const selectedPoolBrowsePresentation = selectedPool === undefined ? getPoolRegistryPresentation({ mode: 'selection', state: selectedPoolLookupState }) : undefined
	const loadedSelectedPool = selectedPool

	useEffect(() => {
		if (selectedPoolManagerAddress === undefined) return
		if (sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress)) return
		if (lastAutoLoadedManagerAddress.current === selectedPoolManagerAddressKey) return
		lastAutoLoadedManagerAddress.current = selectedPoolManagerAddressKey
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress, selectedPoolManagerAddressKey])

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
		const nextSearch = writeSelectedPoolViewQueryParam(window.location.search, hasSelectedPoolAddress ? view : undefined)
		window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}${window.location.hash}`)
	}, [hasSelectedPoolAddress, view])

	return (
		<section className='panel market-panel'>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>Selected Pool</h2>
					</div>
				</div>
			) : undefined}

			<div className='workflow-stack'>
				<EntityCard className='selected-pool-card' title={selectedPoolTitle} badge={loadedSelectedPool?.systemState === undefined ? undefined : <span className='badge ok'>{loadedSelectedPool.systemState}</span>}>
					<div className='form-grid'>
						<label className='field'>
							<span>Security Pool Address</span>
							<input value={securityPoolAddress} onInput={event => onSecurityPoolAddressChange(event.currentTarget.value)} placeholder='0x...' />
						</label>
					</div>

					{selectedPoolLookupDisplay !== 'ready' ? (
						selectedPoolLookupDisplay === 'empty' ? (
							<p className='detail'>Paste a security pool address or browse pools.</p>
						) : selectedPoolLookupDisplay === 'loading' ? (
							<p className='detail'>
								<LoadingText>Checking address...</LoadingText>
							</p>
						) : selectedPoolLookupDisplay === 'missing' ? (
							<div className='notice error'>
								<p>No security pool found at this address.</p>
							</div>
						) : undefined
					) : (
						<>
							<div className='entity-card-subsection'>
								<div className='entity-card-subsection-header'>
									<h4>Pool</h4>
									<span className='badge muted'>{loadedSelectedPool?.vaultCount.toString() ?? '0'} vaults</span>
								</div>
								<div className='workflow-metric-grid'>
									<MetricField label='Security Multiplier'>{loadedSelectedPool?.securityMultiplier.toString()}</MetricField>
									<MetricField label='Open Interest Fee / Year'>
										<CurrencyValue value={openInterestFeePerYearBigint(loadedSelectedPool?.currentRetentionRate)} suffix='%' />
									</MetricField>
									<OpenInterestCapacityMetrics
										completeSetCollateralAmount={loadedSelectedPool?.completeSetCollateralAmount}
										repEthPrice={repEthPrice}
										repEthSource={repEthSource}
										repEthSourceUrl={repEthSourceUrl}
										securityMultiplier={loadedSelectedPool?.securityMultiplier}
										totalRepDeposit={loadedSelectedPool?.totalRepDeposit}
										totalSecurityBondAllowance={loadedSelectedPool?.totalSecurityBondAllowance}
									/>
									{reportingReady ? <MetricField label='Reporting'>Unlocked</MetricField> : undefined}
									<MetricField label='Manager'>
										<AddressValue address={loadedSelectedPool?.managerAddress} />
									</MetricField>
									{!forkWorkflowDisabled ? (
										<>
											<MetricField label='Fork Flow'>Forked / active</MetricField>
											<MetricField label='Truth Auction'>
												<AddressValue address={loadedSelectedPool?.truthAuctionAddress} />
											</MetricField>
											<MetricField label='Fork Mode'>{loadedSelectedPool?.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent / Zoltar fork'}</MetricField>
											<MetricField label='Fork Outcome'>{loadedSelectedPool?.forkOutcome}</MetricField>
										</>
									) : undefined}
								</div>
							</div>

							{marketDetails === undefined ? undefined : (
								<div className='entity-card-subsection'>
									<div className='entity-card-subsection-header'>
										<h4>Question</h4>
									</div>
									<Question question={marketDetails} />
								</div>
							)}

							<div className='entity-card-subsection'>
								<div className='entity-card-subsection-header'>
									<h4>Price Oracle</h4>
									{poolOracleManagerDetails === undefined ? undefined : <span className={`badge ${poolOracleManagerDetails.isPriceValid ? 'ok' : 'error'}`}>{poolOracleManagerDetails.isPriceValid ? 'Valid' : 'Invalid'}</span>}
								</div>
								<ErrorNotice message={poolOracleManagerError} />
								{poolPriceOracleResult === undefined ? undefined : (
									<p className='notice success'>
										Requested price: <TransactionHashLink hash={poolPriceOracleResult.hash} />
									</p>
								)}
								{poolOracleManagerDetails === undefined ? (
									<p className='detail'>
										<button className='secondary' onClick={() => (loadedSelectedPool === undefined ? undefined : onLoadPoolOracleManager(loadedSelectedPool.managerAddress))} disabled={loadingPoolOracleManager || loadedSelectedPool === undefined}>
											{loadingPoolOracleManager ? <LoadingText>Loading...</LoadingText> : 'Load Price Oracle'}
										</button>
									</p>
								) : (
									<>
										<div className='workflow-metric-grid'>
											<MetricField label='Last Price'>{getOracleLastPriceDisplay(poolOracleManagerDetails)}</MetricField>
											<MetricField label='Set At'>
												<TimestampValue timestamp={poolOracleManagerDetails.lastSettlementTimestamp} zeroText='Never' />
											</MetricField>
											<MetricField label='Pending Request'>
												{poolOracleManagerDetails.pendingReportId > 0n ? (
													<button className='link' type='button' onClick={() => onViewPendingReport(poolOracleManagerDetails.pendingReportId)}>
														Report #{poolOracleManagerDetails.pendingReportId.toString()} (security pool/price)
													</button>
												) : (
													'None'
												)}
											</MetricField>
											<MetricField label='Request Cost'>
												<CurrencyValue value={poolOracleManagerDetails.requestPriceEthCost} suffix='ETH' />
											</MetricField>
										</div>
										<div className='actions'>
											<button className='secondary' onClick={() => (loadedSelectedPool === undefined ? undefined : onRequestPoolPrice(loadedSelectedPool.managerAddress))} disabled={accountState.address === undefined || !isMainnet || poolOracleManagerDetails.pendingReportId > 0n || loadedSelectedPool === undefined}>
												Request New Price
											</button>
											<button className='secondary' onClick={() => (loadedSelectedPool === undefined ? undefined : onLoadPoolOracleManager(loadedSelectedPool.managerAddress))} disabled={loadingPoolOracleManager || loadedSelectedPool === undefined}>
												{loadingPoolOracleManager ? <LoadingText>Refreshing...</LoadingText> : 'Refresh'}
											</button>
										</div>
									</>
								)}
							</div>
						</>
					)}
				</EntityCard>

				{selectedPool === undefined || !selectedPoolUniverseMismatch ? undefined : (
					<EntityCard className='selected-pool-card' title='Universe mismatch' badge={<span className='badge blocked'>Blocked</span>}>
						<div className='notice error'>
							This pool belongs to <UniverseLink universeId={selectedPool.universeId} /> but the app is currently set to {formatUniverseLabel(activeUniverseId)}.
						</div>
						<p className='detail'>Switch to the same universe before using this pool.</p>
					</EntityCard>
				)}

				{!showSelectedPoolWorkflowDetails ? undefined : (
					<>
						<div className='subtab-nav' role='tablist' aria-label='Selected pool views'>
							<button className={`subtab-link ${view === 'vaults' ? 'active' : ''}`} type='button' onClick={() => setView('vaults')} aria-pressed={view === 'vaults'}>
								Vaults
							</button>
							<button className={`subtab-link ${view === 'trading' ? 'active' : ''}`} type='button' onClick={() => setView('trading')} aria-pressed={view === 'trading'}>
								Trading
							</button>
							<button className={`subtab-link ${view === 'resolution' ? 'active' : ''}`} type='button' onClick={() => setView('resolution')} aria-pressed={view === 'resolution'}>
								Resolution
							</button>
						</div>

						{view === 'vaults' ? (
							<div className='workflow-stack'>
								<div className='subtab-nav' role='tablist' aria-label='Selected pool vault views'>
									<button className={`subtab-link ${vaultView === 'browse-vaults' ? 'active' : ''}`} type='button' onClick={() => setVaultView('browse-vaults')} aria-pressed={vaultView === 'browse-vaults'}>
										Browse Vaults
									</button>
									<button className={`subtab-link ${vaultView === 'selected-vault' ? 'active' : ''}`} type='button' onClick={() => setVaultView('selected-vault')} aria-pressed={vaultView === 'selected-vault'}>
										Selected Vault
									</button>
								</div>

								{vaultView === 'browse-vaults' ? (
									<EntityCard className='selected-pool-card' title='Browse Vaults' badge={<span className='badge muted'>{selectedPool?.vaultCount.toString() ?? '0'} vaults</span>}>
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
																<button className='destructive' onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress)} disabled={accountState.address === undefined || !isMainnet || poolOracleManagerDetails?.isPriceValid === false}>
																	Liquidate Vault
																</button>
															</div>
														}
													>
														<div className='workflow-vault-grid'>
															<MetricField label='Rep Deposit'>
																<CurrencyValue value={vault.repDepositShare} suffix='REP' />
															</MetricField>
															<MetricField label='Security Bond Allowance'>
																<CurrencyValue value={vault.securityBondAllowance} suffix='ETH' />
															</MetricField>
															<CollateralizationMetricField
																collateralizationPercent={getVaultCollateralizationPercent(vault.repDepositShare, vault.securityBondAllowance, repEthPrice)}
																repEthSource={repEthSource}
																repEthSourceUrl={repEthSourceUrl}
																securityBondAllowance={vault.securityBondAllowance}
																securityMultiplier={selectedPool.securityMultiplier}
															/>
															<MetricField label='Unpaid ETH Fees'>
																<CurrencyValue value={vault.unpaidEthFees} suffix='ETH' />
															</MetricField>
															<MetricField label='Locked REP'>
																<CurrencyValue value={vault.lockedRepInEscalationGame} suffix='REP' />
															</MetricField>
														</div>
													</EntityCard>
												))}
											</div>
										)}
									</EntityCard>
								) : (
									<EntityCard className='selected-pool-card' title='Selected Vault' badge={<span className={`badge ${selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}`}>{selectedVaultIsOwnedByAccount ? 'Owned' : 'Read only'}</span>}>
										<SecurityVaultSection {...securityVault} autoLoadVault compactLayout oracleManagerDetails={sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress) ? poolOracleManagerDetails : undefined} showHeader={false} showSecurityPoolAddressInput={false} />
									</EntityCard>
								)}
							</div>
						) : undefined}

						{view === 'trading' ? (
							<div className='workflow-stack'>
								<EntityCard className='selected-pool-card' title='Trading' badge={<span className='badge muted'>manage</span>}>
									<TradingSection {...trading} embedInCard showHeader={false} showSecurityPoolAddressInput={false} />
								</EntityCard>
							</div>
						) : undefined}

						{view === 'resolution' ? (
							<div className='workflow-stack'>
								{reportingReady ? (
									<EntityCard className='selected-pool-card' title='Reporting' badge={<span className='badge ok'>Unlocked</span>}>
										<ReportingSection {...reporting} embedInCard showHeader={false} showSecurityPoolAddressInput={false} />
									</EntityCard>
								) : undefined}

								<EntityCard className='selected-pool-card' title='Fork & Truth Auction' badge={<span className={`badge ${forkWorkflowDisabled ? 'blocked' : 'ok'}`}>{forkWorkflowDisabled ? 'Locked until fork' : 'Available'}</span>}>
									<ForkAuctionSection {...forkAuction} disabled={forkWorkflowDisabled} disabledMessage={forkWorkflowDisabled ? 'This pool is currently operational, so fork and truth auction actions are read only.' : undefined} previewPool={selectedPool} showHeader={false} showSecurityPoolAddressInput={false} />
								</EntityCard>
							</div>
						) : undefined}
					</>
				)}
			</div>

			<LiquidationModal
				accountAddress={accountState.address}
				closeLiquidationModal={closeLiquidationModal}
				isMainnet={isMainnet}
				liquidationAmount={liquidationAmount}
				liquidationManagerAddress={liquidationManagerAddress}
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				liquidationTargetVault={liquidationTargetVault}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onLiquidationTargetVaultChange={onLiquidationTargetVaultChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</section>
	)
}
