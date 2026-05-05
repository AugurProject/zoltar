import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { Question, getQuestionTitle } from './Question.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { isMainnetChain } from '../lib/network.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
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
	securityPoolOverviewActiveAction,
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
		<RouteWorkflowPanel showHeader={false} title='Pool Registry'>
			<SectionBlock
				density='compact'
				title='Pool Registry'
				description='Browse deployed pools, inspect their vaults, and open a selected pool workflow.'
				actions={
					<button className='secondary' onClick={onLoadSecurityPools} disabled={loadingSecurityPools}>
						{loadingSecurityPools ? <LoadingText>Loading pools...</LoadingText> : 'Refresh pools'}
					</button>
				}
			>
				{securityPoolOverviewResult === undefined ? undefined : (
					<p className='notice success'>
						Queued liquidation for <AddressValue address={securityPoolOverviewResult.securityPoolAddress} />: <TransactionHashLink hash={securityPoolOverviewResult.hash} />
					</p>
				)}
				<ErrorNotice message={securityPoolOverviewError} />

				{securityPools.length === 0 ? (
					registryPresentation === undefined ? undefined : (
						<StateHint presentation={registryPresentation} />
					)
				) : (
					<div className='entity-card-list'>
						{securityPools.map(pool => (
							<EntityCard
								key={pool.securityPoolAddress}
								title={getQuestionTitle(pool.marketDetails)}
								variant='record'
								badge={<span className='badge ok'>{pool.systemState}</span>}
								actions={
									onSelectSecurityPool === undefined ? undefined : (
										<button className='primary' onClick={() => onSelectSecurityPool(pool.securityPoolAddress)}>
											Open Pool
										</button>
									)
								}
							>
								<WorkflowSubsection title='Question'>
									<Question question={pool.marketDetails} />
								</WorkflowSubsection>

								<WorkflowSubsection title='Pool'>
									<div className='workflow-metric-grid'>
										<MetricField label='Pool Address'>
											<AddressValue address={pool.securityPoolAddress} />
										</MetricField>
										<MetricField label='Universe'>
											<UniverseLink universeId={pool.universeId} />
										</MetricField>
										<MetricField label='Vaults'>{pool.vaultCount.toString()}</MetricField>
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
								</WorkflowSubsection>

								<WorkflowSubsection title='Vaults'>
									{pool.vaults.length === 0 ? (
										<StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No vaults in this pool yet.' }} />
									) : (
										<div className='entity-card-list'>
											{pool.vaults.map(vault => (
												<EntityCard
													key={`${pool.securityPoolAddress}-${vault.vaultAddress}`}
													className='compact'
													title={<AddressValue address={vault.vaultAddress} />}
													variant='compact'
													actions={
														<button className='destructive' onClick={() => onOpenLiquidationModal(pool.managerAddress, pool.securityPoolAddress, vault.vaultAddress)} disabled={accountState.address === undefined || !isMainnet}>
															Liquidate Vault
														</button>
													}
												>
													<VaultMetricGrid
														className='workflow-vault-grid'
														repDepositShare={vault.repDepositShare}
														repPerEthPrice={repPerEthPrice}
														repPerEthSource={repPerEthSource}
														repPerEthSourceUrl={repPerEthSourceUrl}
														selectedPoolSecurityMultiplier={pool.securityMultiplier}
														securityBondAllowance={vault.securityBondAllowance}
														unpaidEthFees={vault.unpaidEthFees}
														variant='embedded'
													/>
												</EntityCard>
											))}
										</div>
									)}
								</WorkflowSubsection>
							</EntityCard>
						))}
					</div>
				)}
			</SectionBlock>

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
