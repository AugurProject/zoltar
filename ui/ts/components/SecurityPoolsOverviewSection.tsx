import { AddressValue } from './AddressValue.js'
import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { Question, getQuestionTitle } from './Question.js'
import { StateHint } from './StateHint.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'

export function SecurityPoolsOverviewSection({
	accountState,
	closeLiquidationModal,
	hasLoadedSecurityPools,
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
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityPoolOverviewError,
	securityPoolOverviewResult,
	securityPools,
}: SecurityPoolsOverviewSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const registryPresentation = getPoolRegistryPresentation({
		hasLoaded: hasLoadedSecurityPools,
		isLoading: loadingSecurityPools,
		mode: 'collection',
		poolCount: securityPools.length,
	})

	return (
		<section className='panel market-panel'>
			<div className='workflow-stack'>
				<EntityCard
					title='Pool Registry'
					badge={<span className='badge muted'>{securityPools.length} loaded</span>}
					actions={
						<button className='secondary' onClick={onLoadSecurityPools} disabled={loadingSecurityPools}>
							{loadingSecurityPools ? <LoadingText>Loading pools...</LoadingText> : 'Refresh pools'}
						</button>
					}
				>
					<p className='detail'>Browse pools and inspect vaults.</p>
				</EntityCard>

				{securityPoolOverviewResult === undefined ? undefined : (
					<p className='notice success'>
						Queued liquidation for <AddressValue address={securityPoolOverviewResult.securityPoolAddress} />: <TransactionHashLink hash={securityPoolOverviewResult.hash} />
					</p>
				)}
				<ErrorNotice message={securityPoolOverviewError} />

				{securityPools.length === 0 ? (
					<EntityCard title='Pools'>{registryPresentation === undefined ? undefined : <StateHint presentation={registryPresentation} />}</EntityCard>
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
										<OpenInterestCapacityMetrics
											completeSetCollateralAmount={pool.completeSetCollateralAmount}
											repPerEthPrice={repPerEthPrice}
											repPerEthSource={repPerEthSource}
											repPerEthSourceUrl={repPerEthSourceUrl}
											securityMultiplier={pool.securityMultiplier}
											totalRepDeposit={pool.totalRepDeposit}
											totalSecurityBondAllowance={pool.totalSecurityBondAllowance}
										/>
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
										<StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No vaults in this pool yet.' }} />
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
														<MetricField label='Rep Deposit'>
															<CurrencyValue value={vault.repDepositShare} suffix='REP' />
														</MetricField>
														<MetricField label='Security Bond Allowance'>
															<CurrencyValue value={vault.securityBondAllowance} suffix='ETH' />
														</MetricField>
														<CollateralizationMetricField
															collateralizationPercent={getVaultCollateralizationPercent(vault.repDepositShare, vault.securityBondAllowance, repPerEthPrice)}
															repPerEthSource={repPerEthSource}
															repPerEthSourceUrl={repPerEthSourceUrl}
															securityBondAllowance={vault.securityBondAllowance}
															securityMultiplier={pool.securityMultiplier}
														/>
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
