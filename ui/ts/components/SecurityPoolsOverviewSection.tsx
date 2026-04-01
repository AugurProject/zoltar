import { EntityCard } from './EntityCard.js'
import { LiquidationModal } from './LiquidationModal.js'
import { QuestionSummaryHeader } from './QuestionSummary.js'
import { UniverseLink } from './UniverseLink.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import { formatOpenInterestFeePerYearPercent } from '../lib/retentionRate.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'

export function SecurityPoolsOverviewSection({ accountState, closeLiquidationModal, liquidationAmount, liquidationManagerAddress, liquidationModalOpen, liquidationSecurityPoolAddress, liquidationTargetVault, loadingSecurityPools, onLiquidationAmountChange, onLiquidationTargetVaultChange, onLoadSecurityPools, onOpenLiquidationModal, onQueueLiquidation, onSelectSecurityPool, securityPoolOverviewError, securityPoolOverviewResult, securityPools }: SecurityPoolsOverviewSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)

	return (
		<section className="panel market-panel">
			<div className="workflow-stack">
				<EntityCard
					title="Pool Registry"
					badge={<span className="badge muted">{securityPools.length} loaded</span>}
					actions={
						<button className="secondary" onClick={onLoadSecurityPools} disabled={loadingSecurityPools}>
							{loadingSecurityPools ? 'Loading Pools...' : 'Refresh Pool Registry'}
						</button>
					}
				>
					<></>
				</EntityCard>

				{securityPoolOverviewResult === undefined ? undefined : (
					<p className="notice success">
						Queued liquidation for {securityPoolOverviewResult.securityPoolAddress}: {securityPoolOverviewResult.hash}
					</p>
				)}
				{securityPoolOverviewError === undefined ? undefined : <p className="notice error">{securityPoolOverviewError}</p>}

				{securityPools.length === 0 ? (
					<EntityCard title="No pools loaded" badge={<span className="badge pending">Registry empty</span>}>
						<p className="detail">Use Refresh Pool Registry.</p>
					</EntityCard>
				) : (
					<div className="entity-card-list">
						{securityPools.map(pool => (
							<EntityCard
								key={pool.securityPoolAddress}
								title={pool.marketDetails.title === '' ? pool.questionId : pool.marketDetails.title}
								badge={<span className="badge ok">{pool.systemState}</span>}
								actions={
									onSelectSecurityPool === undefined ? undefined : (
										<button className="secondary" onClick={() => onSelectSecurityPool(pool.securityPoolAddress)}>
											Open Pool
										</button>
									)
								}
							>
								<div className="entity-card-subsection">
									<div className="entity-card-subsection-header">
										<h4>Question</h4>
										<span className="badge muted">{pool.marketDetails.marketType}</span>
									</div>
									<QuestionSummaryHeader description={pool.marketDetails.description.trim() === '' ? 'No description provided.' : pool.marketDetails.description} questionId={pool.questionId} title={pool.marketDetails.title.trim() === '' ? 'Untitled question' : pool.marketDetails.title} />
								</div>

								<div className="entity-card-subsection">
									<div className="entity-card-subsection-header">
										<h4>Pool</h4>
										<span className="badge muted">{pool.vaultCount.toString()} vaults</span>
									</div>
									<div className="workflow-metric-grid">
										<div>
											<span className="metric-label">Pool Address</span>
											<strong>{pool.securityPoolAddress}</strong>
										</div>
										<div>
											<span className="metric-label">Universe</span>
											<strong>
												<UniverseLink universeId={pool.universeId} />
											</strong>
										</div>
										<div>
											<span className="metric-label">Security Multiplier</span>
											<strong>{pool.securityMultiplier.toString()}</strong>
										</div>
										<div>
											<span className="metric-label">Open Interest Fee / Year</span>
											<strong>{formatOpenInterestFeePerYearPercent(pool.currentRetentionRate)}</strong>
										</div>
										<div>
											<span className="metric-label">Manager</span>
											<strong>{pool.managerAddress}</strong>
										</div>
										<div>
											<span className="metric-label">Truth Auction</span>
											<strong>{pool.truthAuctionAddress}</strong>
										</div>
									</div>
								</div>

								<div className="entity-card-subsection">
									<div className="entity-card-subsection-header">
										<h4>Vaults</h4>
									</div>
									{pool.vaults.length === 0 ? (
										<p className="detail">No vaults</p>
									) : (
										<div className="entity-card-list">
											{pool.vaults.map(vault => (
												<EntityCard
													key={`${ pool.securityPoolAddress }-${ vault.vaultAddress }`}
													className="compact"
													title={vault.vaultAddress}
													badge={<span className="badge muted">Vault</span>}
													actions={
														<button className="secondary" onClick={() => onOpenLiquidationModal(pool.managerAddress, pool.securityPoolAddress, vault.vaultAddress)} disabled={accountState.address === undefined || !isMainnet}>
															Liquidate Vault
														</button>
													}
												>
													<div className="workflow-vault-grid">
														<div>
															<span className="metric-label">REP Deposit Share</span>
															<strong>{formatCurrencyBalance(vault.repDepositShare)}</strong>
														</div>
														<div>
															<span className="metric-label">Pool Ownership</span>
															<strong>{vault.poolOwnership.toString()}</strong>
														</div>
														<div>
															<span className="metric-label">Security Bond Allowance</span>
															<strong>{formatCurrencyBalance(vault.securityBondAllowance)}</strong>
														</div>
														<div>
															<span className="metric-label">Unpaid ETH Fees</span>
															<strong>{formatCurrencyBalance(vault.unpaidEthFees)}</strong>
														</div>
													</div>
												</EntityCard>
											))}
										</div>
									)}
								</div>
							</EntityCard>
						))}
					</div>
				)}
			</div>

			<LiquidationModal accountAddress={accountState.address} closeLiquidationModal={closeLiquidationModal} isMainnet={isMainnet} liquidationAmount={liquidationAmount} liquidationManagerAddress={liquidationManagerAddress} liquidationModalOpen={liquidationModalOpen} liquidationSecurityPoolAddress={liquidationSecurityPoolAddress} liquidationTargetVault={liquidationTargetVault} onLiquidationAmountChange={onLiquidationAmountChange} onLiquidationTargetVaultChange={onLiquidationTargetVaultChange} onQueueLiquidation={onQueueLiquidation} />
		</section>
	)
}
