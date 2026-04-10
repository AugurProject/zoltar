import { useEffect, useRef, useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LoadingText } from './LoadingText.js'
import { Question, getQuestionTitle } from './Question.js'
import { ReportingSection } from './ReportingSection.js'
import { SecurityVaultSection } from './SecurityVaultSection.js'
import { TradingSection } from './TradingSection.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { CurrencyValue } from './CurrencyValue.js'
import { isMainnetChain } from '../lib/network.js'
import { formatTimestamp } from '../lib/formatters.js'
import { getSelectedVaultAddress, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { formatUniverseLabel } from '../lib/universe.js'
import { readSelectedPoolViewQueryParam, writeSelectedPoolViewQueryParam } from '../lib/urlParams.js'
import type { SecurityPoolWorkflowRouteContentProps } from '../types/components.js'

type SelectedPoolView = 'vaults' | 'trading' | 'resolution'
type SelectedVaultView = 'browse-vaults' | 'selected-vault'

function getSelectedPoolView(value: string | undefined): SelectedPoolView {
	switch (value) {
		case 'vaults':
		case 'trading':
		case 'resolution':
			return value
		default:
			return 'vaults'
	}
}

export function SecurityPoolWorkflowSection({
	accountState,
	activeUniverseId,
	closeLiquidationModal,
	forkAuction,
	liquidationAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	loadingPoolOracleManager,
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
	reporting,
	securityPoolAddress,
	securityPools,
	securityVault,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & { showHeader?: boolean }) {
	const [view, setView] = useState<SelectedPoolView>(() => getSelectedPoolView(readSelectedPoolViewQueryParam(window.location.search)))
	const [vaultView, setVaultView] = useState<SelectedVaultView>('selected-vault')
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedPool = securityPools.find(pool => pool.securityPoolAddress.toLowerCase() === securityPoolAddress.toLowerCase())
	const marketDetails = selectedPool?.marketDetails ?? reporting.reportingDetails?.marketDetails ?? forkAuction.forkAuctionDetails?.marketDetails
	const selectedPoolState = selectedPool?.systemState ?? forkAuction.forkAuctionDetails?.systemState
	const currentTimestamp = reporting.reportingDetails?.currentTime ?? BigInt(Math.floor(Date.now() / 1000))
	const reportingReady = marketDetails !== undefined && marketDetails.endTime <= currentTimestamp
	const forkReady = selectedPoolState !== undefined && selectedPoolState !== 'operational'
	const selectedPoolUniverseMismatch = selectedPool !== undefined && selectedPool.universeId !== activeUniverseId
	const hasSelectedPoolAddress = securityPoolAddress.trim() !== ''
	const selectedPoolManagerAddress = selectedPool?.managerAddress
	const selectedPoolManagerAddressKey = selectedPoolManagerAddress?.toLowerCase()
	const selectedVaultAddress = getSelectedVaultAddress(securityVault.securityVaultForm.selectedVaultAddress, accountState.address) ?? ''
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultAddress, accountState.address)
	const selectedPoolTitle = selectedPool !== undefined ? getQuestionTitle(selectedPool.marketDetails) : securityPoolAddress === '' ? 'Select a security pool' : <AddressValue address={securityPoolAddress} />
	const lastAutoLoadedManagerAddress = useRef<string | undefined>(undefined)
	const lastSelectedPoolVaultDefaultKey = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (selectedPoolManagerAddress === undefined) return
		if (poolOracleManagerDetails?.managerAddress.toLowerCase() === selectedPoolManagerAddressKey) return
		if (lastAutoLoadedManagerAddress.current === selectedPoolManagerAddressKey) return
		lastAutoLoadedManagerAddress.current = selectedPoolManagerAddressKey
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress, selectedPoolManagerAddressKey])

	useEffect(() => {
		const normalizedSelectedPoolAddress = selectedPool?.securityPoolAddress.toLowerCase()
		if (normalizedSelectedPoolAddress === undefined) return
		const selectedPoolVaultDefaultKey = `${normalizedSelectedPoolAddress}:${accountState.address?.toLowerCase() ?? ''}`
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
				<EntityCard className='selected-pool-card' title={selectedPoolTitle} badge={selectedPoolState === undefined ? undefined : <span className='badge ok'>{selectedPoolState}</span>}>
					<div className='form-grid'>
						<label className='field'>
							<span>Security Pool Address</span>
							<input value={securityPoolAddress} onInput={event => onSecurityPoolAddressChange(event.currentTarget.value)} placeholder='0x...' />
						</label>
					</div>

					{!hasSelectedPoolAddress ? (
						<p className='detail'>Browse Pools to pick one, or paste an address above.</p>
					) : selectedPool === undefined ? (
						<p className='detail'>Pool metadata unavailable. Refresh Pool Registry in the Browse tab to load metadata for this address.</p>
					) : (
						<>
							<div className='entity-card-subsection'>
								<div className='entity-card-subsection-header'>
									<h4>Pool</h4>
									<span className='badge muted'>{selectedPool.vaultCount.toString()} vaults</span>
								</div>
								<div className='workflow-metric-grid'>
									<div>
										<span className='metric-label'>Security Multiplier</span>
										<strong>{selectedPool.securityMultiplier.toString()}</strong>
									</div>
									<div>
										<span className='metric-label'>Open Interest Fee / Year</span>
										<strong>
											<CurrencyValue value={openInterestFeePerYearBigint(selectedPool.currentRetentionRate)} suffix='%' />
										</strong>
									</div>
									{reportingReady ? (
										<div>
											<span className='metric-label'>Reporting</span>
											<strong>Unlocked</strong>
										</div>
									) : undefined}
									<div>
										<span className='metric-label'>Manager</span>
										<strong>
											<AddressValue address={selectedPool.managerAddress} />
										</strong>
									</div>
									{forkReady ? (
										<>
											<div>
												<span className='metric-label'>Fork Flow</span>
												<strong>Forked / active</strong>
											</div>
											<div>
												<span className='metric-label'>Truth Auction</span>
												<strong>
													<AddressValue address={selectedPool.truthAuctionAddress} />
												</strong>
											</div>
											<div>
												<span className='metric-label'>Fork Mode</span>
												<strong>{selectedPool.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent / Zoltar fork'}</strong>
											</div>
											<div>
												<span className='metric-label'>Fork Outcome</span>
												<strong>{selectedPool.forkOutcome}</strong>
											</div>
										</>
									) : undefined}
								</div>
							</div>

							{marketDetails === undefined ? undefined : (
								<div className='entity-card-subsection'>
									<div className='entity-card-subsection-header'>
										<h4>Question</h4>
										<span className='badge muted'>{marketDetails.marketType}</span>
									</div>
									<Question question={marketDetails} />
								</div>
							)}

							<div className='entity-card-subsection'>
								<div className='entity-card-subsection-header'>
									<h4>Price Oracle</h4>
									{poolOracleManagerDetails === undefined ? undefined : <span className={`badge ${poolOracleManagerDetails.isPriceValid ? 'ok' : 'error'}`}>{poolOracleManagerDetails.isPriceValid ? 'Valid' : 'Invalid'}</span>}
								</div>
								{poolOracleManagerError === undefined ? undefined : <p className='notice error'>{poolOracleManagerError}</p>}
								{poolPriceOracleResult === undefined ? undefined : (
									<p className='notice success'>
										Requested price: <TransactionHashLink hash={poolPriceOracleResult.hash} />
									</p>
								)}
								{poolOracleManagerDetails === undefined ? (
									<p className='detail'>
										<button className='secondary' onClick={() => onLoadPoolOracleManager(selectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
											{loadingPoolOracleManager ? <LoadingText>Loading...</LoadingText> : 'Load Price Oracle'}
										</button>
									</p>
								) : (
									<>
										<div className='workflow-metric-grid'>
											<div>
												<span className='metric-label'>Last Price</span>
												<strong>{poolOracleManagerDetails.lastPrice.toString()}</strong>
											</div>
											<div>
												<span className='metric-label'>Set At</span>
												<strong>{poolOracleManagerDetails.lastSettlementTimestamp === 0n ? 'Never' : formatTimestamp(poolOracleManagerDetails.lastSettlementTimestamp)}</strong>
											</div>
											<div>
												<span className='metric-label'>Pending Request</span>
												<strong>
													{poolOracleManagerDetails.pendingReportId > 0n ? (
														<button className='link' type='button' onClick={() => onViewPendingReport(poolOracleManagerDetails.pendingReportId)}>
															Report #{poolOracleManagerDetails.pendingReportId.toString()} (security pool/price)
														</button>
													) : (
														'None'
													)}
												</strong>
											</div>
											<div>
												<span className='metric-label'>Request Cost</span>
												<strong>
													<CurrencyValue value={poolOracleManagerDetails.requestPriceEthCost} suffix='ETH' />
												</strong>
											</div>
										</div>
										<div className='actions'>
											<button className='secondary' onClick={() => onRequestPoolPrice(selectedPool.managerAddress)} disabled={accountState.address === undefined || !isMainnet || poolOracleManagerDetails.pendingReportId > 0n}>
												Request New Price
											</button>
											<button className='secondary' onClick={() => onLoadPoolOracleManager(selectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
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
						<p className='detail'>Switch the application universe to match this pool before using Vaults, Trading, or Resolution.</p>
					</EntityCard>
				)}

				{!hasSelectedPoolAddress || selectedPoolUniverseMismatch ? undefined : (
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
											<p className='detail'>No pool metadata</p>
										) : selectedPool.vaults.length === 0 ? (
											<p className='detail'>No vaults</p>
										) : (
											<div className='entity-card-list'>
												{selectedPool.vaults.map(vault => (
													<EntityCard
														key={`${selectedPool.securityPoolAddress}-${vault.vaultAddress}`}
														className='compact'
														title={<AddressValue address={vault.vaultAddress} />}
														badge={selectedVaultAddress !== '' && selectedVaultAddress.toLowerCase() === vault.vaultAddress.toLowerCase() ? <span className='badge ok'>Selected</span> : undefined}
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
															<div>
																<span className='metric-label'>REP Deposit Share</span>
																<strong>
																	<CurrencyValue value={vault.repDepositShare} suffix='REP' />
																</strong>
															</div>
															<div>
																<span className='metric-label'>Pool Ownership</span>
																<strong>{vault.poolOwnership.toString()}</strong>
															</div>
															<div>
																<span className='metric-label'>Security Bond Allowance</span>
																<strong>
																	<CurrencyValue value={vault.securityBondAllowance} suffix='REP' />
																</strong>
															</div>
															<div>
																<span className='metric-label'>Unpaid ETH Fees</span>
																<strong>
																	<CurrencyValue value={vault.unpaidEthFees} suffix='ETH' />
																</strong>
															</div>
															<div>
																<span className='metric-label'>Locked REP</span>
																<strong>
																	<CurrencyValue value={vault.lockedRepInEscalationGame} suffix='REP' />
																</strong>
															</div>
															<div>
																<span className='metric-label'>Fee Index</span>
																<strong>{vault.feeIndex.toString()}</strong>
															</div>
														</div>
													</EntityCard>
												))}
											</div>
										)}
									</EntityCard>
								) : (
									<EntityCard className='selected-pool-card' title='Selected Vault' badge={<span className={`badge ${selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}`}>{selectedVaultIsOwnedByAccount ? 'Owned' : 'Read only'}</span>}>
										<SecurityVaultSection {...securityVault} autoLoadVault compactLayout showHeader={false} showSecurityPoolAddressInput={false} />
									</EntityCard>
								)}
							</div>
						) : undefined}

						{view === 'trading' ? (
							<div className='workflow-stack'>
								<EntityCard className='selected-pool-card' title='Trading' badge={<span className='badge muted'>manage</span>}>
									<TradingSection {...trading} showHeader={false} showSecurityPoolAddressInput={false} />
								</EntityCard>
							</div>
						) : undefined}

						{view === 'resolution' ? (
							<div className='workflow-stack'>
								{reportingReady ? (
									<EntityCard className='selected-pool-card' title='Reporting' badge={<span className='badge ok'>Unlocked</span>}>
										<ReportingSection {...reporting} showHeader={false} showSecurityPoolAddressInput={false} />
									</EntityCard>
								) : undefined}

								<EntityCard className='selected-pool-card' title='Fork & Truth Auction' badge={<span className={`badge ${forkReady ? 'ok' : 'blocked'}`}>{forkReady ? 'Available' : 'Locked until fork'}</span>}>
									{forkReady ? (
										<ForkAuctionSection {...forkAuction} showHeader={false} showSecurityPoolAddressInput={false} />
									) : (
										<EntityCard title='Fork flow is locked' badge={<span className='badge blocked'>Operational</span>}>
											<p className='detail'>The pool must enter a non-operational state (forked or in escalation) before the fork & auction flow becomes available.</p>
										</EntityCard>
									)}
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
