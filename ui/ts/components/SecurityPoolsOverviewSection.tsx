import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question, getQuestionTitle } from './Question.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'

export function SecurityPoolsOverviewSection({
	accountState,
	closeLiquidationModal,
	liquidationAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	loadingSecurityPools,
	onLiquidationAmountChange,
	onLiquidationTargetVaultChange,
	onLoadSecurityPools,
	onOpenLiquidationModal,
	onQueueLiquidation,
	onSelectSecurityPool,
	securityPoolOverviewError,
	securityPoolOverviewResult,
	securityPools,
}: SecurityPoolsOverviewSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)

	return (
		<section className='panel market-panel'>
			<div className='workflow-stack'>
				<EntityCard
					title='Pool Registry'
					badge={<span className='badge muted'>{securityPools.length} loaded</span>}
					actions={
						<button className='secondary' onClick={onLoadSecurityPools} disabled={loadingSecurityPools}>
							{loadingSecurityPools ? <LoadingText>Loading Pools...</LoadingText> : 'Refresh Pool Registry'}
						</button>
					}
				>
					<p className='detail'>Displays all pools loaded from the on-chain registry.</p>
				</EntityCard>

				{securityPoolOverviewResult === undefined ? undefined : (
					<p className='notice success'>
						Queued liquidation for <AddressValue address={securityPoolOverviewResult.securityPoolAddress} />: <TransactionHashLink hash={securityPoolOverviewResult.hash} />
					</p>
				)}
				{securityPoolOverviewError === undefined ? undefined : <p className='notice error'>{securityPoolOverviewError}</p>}

				{securityPools.length === 0 ? (
					<EntityCard title='No Pools Loaded' badge={<span className='badge pending'>Empty</span>}>
						<p className='detail'>No pools loaded yet. Use Refresh Pool Registry to fetch them from the chain.</p>
					</EntityCard>
				) : (
					<div className='entity-card-list'>
						{securityPools.map(pool => (
							<EntityCard
								key={pool.securityPoolAddress}
								title={getQuestionTitle(pool.marketDetails)}
								badge={<span className='badge ok'>{pool.systemState}</span>}
								actions={
									onSelectSecurityPool === undefined ? undefined : (
										<button className='primary' onClick={() => onSelectSecurityPool(pool.securityPoolAddress)}>
											Open Pool
										</button>
									)
								}
							>
								<div className='entity-card-subsection'>
									<div className='entity-card-subsection-header'>
										<h4>Question</h4>
										<span className='badge muted'>{pool.marketDetails.marketType}</span>
									</div>
									<Question question={pool.marketDetails} />
								</div>

								<div className='entity-card-subsection'>
									<div className='entity-card-subsection-header'>
										<h4>Pool</h4>
										<span className='badge muted'>{pool.vaultCount.toString()} vaults</span>
									</div>
									<div className='workflow-metric-grid'>
										<MetricField label='Pool Address'>
											<AddressValue address={pool.securityPoolAddress} />
										</MetricField>
										<MetricField label='Universe'>
											<UniverseLink universeId={pool.universeId} />
										</MetricField>
										<MetricField label='Security Multiplier'>{pool.securityMultiplier.toString()}</MetricField>
										<MetricField label='Open Interest Fee / Year'>
											<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix='%' />
										</MetricField>
										<MetricField label='Manager'>
											<AddressValue address={pool.managerAddress} />
										</MetricField>
										<MetricField label='Truth Auction'>
											<AddressValue address={pool.truthAuctionAddress} />
										</MetricField>
									</div>
								</div>

								<div className='entity-card-subsection'>
									<div className='entity-card-subsection-header'>
										<h4>Vaults</h4>
									</div>
									{pool.vaults.length === 0 ? (
										<p className='detail'>No vaults</p>
									) : (
										<div className='entity-card-list'>
											{pool.vaults.map(vault => (
												<EntityCard
													key={`${pool.securityPoolAddress}-${vault.vaultAddress}`}
													className='compact'
													title={<AddressValue address={vault.vaultAddress} />}
													actions={
														<button className='destructive' onClick={() => onOpenLiquidationModal(pool.managerAddress, pool.securityPoolAddress, vault.vaultAddress)} disabled={accountState.address === undefined || !isMainnet}>
															Liquidate Vault
														</button>
													}
												>
													<div className='workflow-vault-grid'>
														<MetricField label='REP Deposit Share'>
															<CurrencyValue value={vault.repDepositShare} suffix='REP' />
														</MetricField>
														<MetricField label='Pool Ownership'>{vault.poolOwnership.toString()}</MetricField>
														<MetricField label='Security Bond Allowance'>
															<CurrencyValue value={vault.securityBondAllowance} suffix='REP' />
														</MetricField>
														<MetricField label='Unpaid ETH Fees'>
															<CurrencyValue value={vault.unpaidEthFees} suffix='ETH' />
														</MetricField>
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
