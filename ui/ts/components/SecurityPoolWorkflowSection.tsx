import { useEffect, useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { Question } from './Question.js'
import { ReportingSection } from './ReportingSection.js'
import { SecurityVaultSection } from './SecurityVaultSection.js'
import { TradingSection } from './TradingSection.js'
import { UniverseLink } from './UniverseLink.js'
import { CurrencyValue } from './CurrencyValue.js'
import { isMainnetChain } from '../lib/network.js'
import { formatOpenInterestFeePerYearPercent } from '../lib/retentionRate.js'
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
	const hasSelectedPoolAddress = securityPoolAddress.trim() !== ''
	const selectedPoolTitle = securityPoolAddress === '' ? 'Select a security pool' : <AddressValue address={securityPoolAddress} />

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
				<EntityCard title={selectedPoolTitle} badge={selectedPoolState === undefined ? undefined : <span className='badge ok'>{selectedPoolState}</span>}>
					<div className='form-grid'>
						<label className='field'>
							<span>Security Pool Address</span>
							<input value={securityPoolAddress} onInput={event => onSecurityPoolAddressChange(event.currentTarget.value)} placeholder='0x...' />
						</label>
					</div>

					{!hasSelectedPoolAddress ? (
						<p className='detail'>Select a pool.</p>
					) : selectedPool === undefined ? (
						<p className='detail'>Pool metadata unavailable.</p>
					) : (
						<>
							<div className='entity-card-subsection'>
								<div className='entity-card-subsection-header'>
									<h4>Pool</h4>
									<span className='badge muted'>{selectedPool.vaultCount.toString()} vaults</span>
								</div>
								<div className='workflow-metric-grid'>
									<div>
										<span className='metric-label'>Universe</span>
										<strong>
											<UniverseLink universeId={selectedPool.universeId} />
										</strong>
									</div>
									<div>
										<span className='metric-label'>Security Multiplier</span>
										<strong>{selectedPool.securityMultiplier.toString()}</strong>
									</div>
									<div>
										<span className='metric-label'>Open Interest Fee / Year</span>
										<strong>{formatOpenInterestFeePerYearPercent(selectedPool.currentRetentionRate)}</strong>
									</div>
									<div>
										<span className='metric-label'>Reporting</span>
										<strong>{reportingReady ? 'Unlocked' : 'Locked until question end'}</strong>
									</div>
									<div>
										<span className='metric-label'>Fork Flow</span>
										<strong>{forkReady ? 'Forked / active' : 'Not forked'}</strong>
									</div>
									<div>
										<span className='metric-label'>Manager</span>
										<strong>
											<AddressValue address={selectedPool.managerAddress} />
										</strong>
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

				{!hasSelectedPoolAddress ? undefined : (
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
								<div className='workflow-section'>
									<div className='workflow-section-header'>
										<div>
											<h3>Your Vault</h3>
										</div>
										<span className='badge ok'>Wallet owned</span>
									</div>
									<SecurityVaultSection {...securityVault} showHeader={false} showSecurityPoolAddressInput={false} />
								</div>

								<div className='workflow-section'>
									<div className='workflow-section-header'>
										<div>
											<h3>Pool Vaults</h3>
										</div>
										<span className='badge muted'>{selectedPool?.vaultCount.toString() ?? '0'} vaults</span>
									</div>
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
													badge={<span className='badge muted'>Vault</span>}
													actions={
														<button className='secondary' onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress)} disabled={accountState.address === undefined || !isMainnet}>
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
								</div>
							</div>
						) : undefined}

						{view === 'trading' ? (
							<div className='workflow-stack'>
								<div className='workflow-section'>
									<div className='workflow-section-header'>
										<div>
											<h3>Trading</h3>
										</div>
									</div>
									<TradingSection {...trading} showHeader={false} showSecurityPoolAddressInput={false} />
								</div>
							</div>
						) : undefined}

						{view === 'resolution' ? (
							<div className='workflow-stack'>
								<div className='workflow-section'>
									<div className='workflow-section-header'>
										<div>
											<h3>Reporting</h3>
										</div>
										<span className={`badge ${reportingReady ? 'ok' : 'blocked'}`}>{reportingReady ? 'Unlocked' : 'Locked until question end'}</span>
									</div>
									{reportingReady ? (
										<ReportingSection {...reporting} showHeader={false} showSecurityPoolAddressInput={false} />
									) : (
										<EntityCard title='Reporting is locked' badge={<span className='badge blocked'>Waiting</span>}>
											<p className='detail'>Wait for question end.</p>
										</EntityCard>
									)}
								</div>

								<div className='workflow-section'>
									<div className='workflow-section-header'>
										<div>
											<h3>Fork & Truth Auction</h3>
										</div>
										<span className={`badge ${forkReady ? 'ok' : 'blocked'}`}>{forkReady ? 'Available' : 'Locked until fork'}</span>
									</div>
									{forkReady ? (
										<ForkAuctionSection {...forkAuction} showHeader={false} showSecurityPoolAddressInput={false} />
									) : (
										<EntityCard title='Fork flow is locked' badge={<span className='badge blocked'>Operational</span>}>
											<p className='detail'>Not forked.</p>
										</EntityCard>
									)}
								</div>
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
