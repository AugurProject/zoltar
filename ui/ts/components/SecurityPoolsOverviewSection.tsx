import { useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
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
import { zeroAddress } from 'viem'
import { isMainnetChain } from '../lib/network.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import type { ListedSecurityPool } from '../types/contracts.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'

export function SecurityPoolsOverviewSection({
	accountState,
	closeLiquidationModal,
	hasLoadedSecurityPools,
	liquidationAmount,
	liquidationMaxAmount,
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
	const [searchText, setSearchText] = useState('')
	const [systemStateFilter, setSystemStateFilter] = useState<'all' | ListedSecurityPool['systemState']>('all')
	const [vaultFilter, setVaultFilter] = useState<'all' | 'has-vaults' | 'empty'>('all')
	const registryPresentation = getPoolRegistryPresentation({
		hasLoaded: hasLoadedSecurityPools,
		isLoading: loadingSecurityPools,
		mode: 'collection',
		poolCount: securityPools.length,
	})
	const normalizedSearchText = searchText.trim().toLowerCase()
	const filteredSecurityPools = securityPools.filter(pool => {
		if (systemStateFilter !== 'all' && pool.systemState !== systemStateFilter) return false
		if (vaultFilter === 'has-vaults' && pool.vaults.length === 0) return false
		if (vaultFilter === 'empty' && pool.vaults.length > 0) return false
		if (normalizedSearchText === '') return true

		return pool.securityPoolAddress.toLowerCase().includes(normalizedSearchText) || pool.questionId.toLowerCase().includes(normalizedSearchText) || pool.marketDetails.title.toLowerCase().includes(normalizedSearchText) || pool.marketDetails.description.toLowerCase().includes(normalizedSearchText)
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
				<div className='filter-toolbar'>
					<label className='field'>
						<span>Search Pools</span>
						<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder='Search by pool address, question ID, or question text' />
					</label>
					<label className='field'>
						<span>System State</span>
						<select value={systemStateFilter} onChange={event => setSystemStateFilter(event.currentTarget.value as 'all' | ListedSecurityPool['systemState'])}>
							<option value='all'>All states</option>
							<option value='operational'>Operational</option>
							<option value='poolForked'>Pool Forked</option>
							<option value='forkMigration'>Fork Migration</option>
							<option value='forkTruthAuction'>Truth Auction</option>
						</select>
					</label>
					<label className='field'>
						<span>Vault Coverage</span>
						<select value={vaultFilter} onChange={event => setVaultFilter(event.currentTarget.value as 'all' | 'has-vaults' | 'empty')}>
							<option value='all'>All pools</option>
							<option value='has-vaults'>Has vaults</option>
							<option value='empty'>No vaults</option>
						</select>
					</label>
				</div>
				{securityPools.length > 0 ? (
					<p className='detail'>
						{filteredSecurityPools.length.toString()} of {securityPools.length.toString()} pools shown.
					</p>
				) : undefined}

				{securityPools.length === 0 ? (
					registryPresentation === undefined ? undefined : (
						<StateHint presentation={registryPresentation} />
					)
				) : filteredSecurityPools.length === 0 ? (
					<StateHint presentation={{ key: 'empty', badgeLabel: 'No matches', badgeTone: 'muted', detail: 'No pools match the current search and filter settings.' }} />
				) : (
					<div className='entity-card-list'>
						{filteredSecurityPools.map(pool => (
							<EntityCard
								key={pool.securityPoolAddress}
								title={getQuestionTitle(pool.marketDetails)}
								variant='record'
								badge={<span className={`badge ${pool.systemState === 'operational' ? 'ok' : 'warning'}`}>{pool.systemState}</span>}
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
										{pool.truthAuctionAddress === zeroAddress ? undefined : (
											<MetricField label='Truth Auction'>
												<AddressValue address={pool.truthAuctionAddress} />
											</MetricField>
										)}
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
														<button className='destructive' onClick={() => onOpenLiquidationModal(pool.managerAddress, pool.securityPoolAddress, vault.vaultAddress, vault.securityBondAllowance)} disabled={accountState.address === undefined || !isMainnet}>
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
				currentPoolOracleManagerDetails={undefined}
				isMainnet={isMainnet}
				liquidationAmount={liquidationAmount}
				liquidationMaxAmount={liquidationMaxAmount}
				liquidationManagerAddress={liquidationManagerAddress}
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				loadingPoolOracleManager={false}
				liquidationTargetVault={liquidationTargetVault}
				onSelectedPoolViewChange={() => undefined}
				securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
				securityPoolOverviewResult={securityPoolOverviewResult}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onLiquidationTargetVaultChange={onLiquidationTargetVaultChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
