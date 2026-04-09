import { useEffect, useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { Question, getQuestionTitle } from './Question.js'
import { ReportingSection } from './ReportingSection.js'
import { SecurityVaultSection } from './SecurityVaultSection.js'
import { TradingSection } from './TradingSection.js'
import { UniverseLink } from './UniverseLink.js'
import { CurrencyValue } from './CurrencyValue.js'
import { isMainnetChain } from '../lib/network.js'
import { formatOpenInterestFeePerYearPercent } from '../lib/retentionRate.js'
import { formatUniverseLabel } from '../lib/universe.js'
import { readSelectedPoolViewQueryParam, writeSelectedPoolViewQueryParam } from '../lib/urlParams.js'
import type { SecurityPoolWorkflowRouteContentProps } from '../types/components.js'

type SelectedPoolView = 'vaults' | 'trading' | 'resolution'

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
	onLiquidationAmountChange,
	onLiquidationTargetVaultChange,
	onOpenLiquidationModal,
	onQueueLiquidation,
	onSecurityPoolAddressChange,
	reporting,
	securityPoolAddress,
	securityPools,
	securityVault,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & { showHeader?: boolean }) {
	const [view, setView] = useState<SelectedPoolView>(() => getSelectedPoolView(readSelectedPoolViewQueryParam(window.location.search)))
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedPool = securityPools.find(pool => pool.securityPoolAddress.toLowerCase() === securityPoolAddress.toLowerCase())
	const marketDetails = selectedPool?.marketDetails ?? reporting.reportingDetails?.marketDetails ?? forkAuction.forkAuctionDetails?.marketDetails
	const selectedPoolState = selectedPool?.systemState ?? forkAuction.forkAuctionDetails?.systemState
	const currentTimestamp = reporting.reportingDetails?.currentTime ?? BigInt(Math.floor(Date.now() / 1000))
	const reportingReady = marketDetails !== undefined && marketDetails.endTime <= currentTimestamp
	const forkReady = selectedPoolState !== undefined && selectedPoolState !== 'operational'
	const selectedPoolUniverseMismatch = selectedPool !== undefined && selectedPool.universeId !== activeUniverseId
	const hasSelectedPoolAddress = securityPoolAddress.trim() !== ''
	const selectedPoolTitle = selectedPool !== undefined ? getQuestionTitle(selectedPool.marketDetails) : securityPoolAddress === '' ? 'Select a security pool' : <AddressValue address={securityPoolAddress} />

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
										<strong>{formatOpenInterestFeePerYearPercent(selectedPool.currentRetentionRate)}</strong>
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
								<EntityCard className='selected-pool-card' title='Your Vault'>
									<SecurityVaultSection {...securityVault} autoLoadVault compactLayout showHeader={false} showSecurityPoolAddressInput={false} />
								</EntityCard>

								<EntityCard className='selected-pool-card' title='Pool Vaults' badge={<span className='badge muted'>{selectedPool?.vaultCount.toString() ?? '0'} vaults</span>}>
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
													actions={
														<button className='destructive' onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress)} disabled={accountState.address === undefined || !isMainnet}>
															Liquidate Vault
														</button>
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
