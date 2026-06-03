import { useState } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LoadingText } from './LoadingText.js'
import { Question, getQuestionTitle } from './Question.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolVaultDirectory } from './SecurityPoolVaultDirectory.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { TransactionStatusCard } from './TransactionStatusCard.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { sameAddress } from '../lib/address.js'
import { isMainnetChain } from '../lib/network.js'
import { getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
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
	loadingPoolOracleManager,
	loadingSecurityPools,
	onLiquidationAmountChange,
	onLoadPoolOracleManager,
	onLoadSecurityPools,
	onOpenLiquidationModal,
	onQueueLiquidation,
	onSelectSecurityPool,
	poolOracleManagerDetails,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityPoolOverviewActiveAction,
	securityPoolOverviewError,
	securityPoolOverviewFeedback,
	securityPoolOverviewResult,
	securityPools,
}: SecurityPoolsOverviewSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const [searchText, setSearchText] = useState('')
	const [systemStateFilter, setSystemStateFilter] = useState<'all' | SecurityPoolLifecycleState>('all')
	const [vaultFilter, setVaultFilter] = useState<'all' | 'has-vaults' | 'empty'>('all')
	const registryPresentation = getPoolRegistryPresentation({
		hasLoaded: hasLoadedSecurityPools,
		isLoading: loadingSecurityPools,
		mode: 'collection',
		poolCount: securityPools.length,
	})
	const securityPoolsWithState = securityPools.map(pool => ({
		pool,
		poolState: evaluateSecurityPoolState({
			lifecycleState: deriveSecurityPoolLifecycleState({
				questionOutcome: pool.questionOutcome,
				systemState: pool.systemState,
			}),
			universeHasForked: pool.universeHasForked,
		}),
	}))
	const selectedPoolWithState = securityPoolsWithState.find(({ pool }) => sameAddress(pool.securityPoolAddress, liquidationSecurityPoolAddress))
	const selectedPool = selectedPoolWithState?.pool
	const currentPoolOracleManagerDetails = selectedPool === undefined || liquidationManagerAddress === undefined || !sameAddress(poolOracleManagerDetails?.managerAddress, liquidationManagerAddress) ? undefined : poolOracleManagerDetails
	const targetVaultSummary = selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault))
	const callerVaultSummary = accountState.address === undefined ? undefined : selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const normalizedSearchText = searchText.trim().toLowerCase()
	const filteredSecurityPools = securityPoolsWithState.filter(({ pool, poolState }) => {
		const displayState = poolState.lifecycleState
		if (systemStateFilter !== 'all' && displayState !== systemStateFilter) return false
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
					<TransactionStatusCard
						title='Liquidation Submitted'
						badge={<span className='badge warn'>Check State</span>}
						detail={
							<>
								Queued liquidation for <AddressValue address={securityPoolOverviewResult.securityPoolAddress} />. Transaction: <TransactionHashLink hash={securityPoolOverviewResult.hash} />
							</>
						}
					/>
				)}
				<ErrorNotice message={securityPoolOverviewError} />
				<div className='filter-toolbar'>
					<label className='field'>
						<span>Search Pools</span>
						<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder='Search by pool address, question ID, or question text' />
					</label>
					<label className='field'>
						<span>System State</span>
						<select value={systemStateFilter} onChange={event => setSystemStateFilter(event.currentTarget.value as 'all' | SecurityPoolLifecycleState)}>
							<option value='all'>All states</option>
							<option value='operational'>Operational</option>
							<option value='ended'>Ended</option>
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

				{(() => {
					if (securityPools.length === 0) {
						if (registryPresentation === undefined) return undefined

						return <StateHint presentation={registryPresentation} />
					}
					if (filteredSecurityPools.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: 'No matches', badgeTone: 'muted', detail: 'No pools match the current search and filter settings.' }} />

					return (
						<div className='entity-card-list'>
							{filteredSecurityPools.map(({ pool, poolState }) => {
								const displayState = poolState.lifecycleState
								const liquidationEnabled = poolState.actions.queueLiquidation.enabled
								const badgeTone = (() => {
									if (displayState === 'operational') return 'ok'
									if (displayState === undefined) return 'muted'

									return 'warning'
								})()
								return (
									<EntityCard
										key={pool.securityPoolAddress}
										title={getQuestionTitle(pool.marketDetails)}
										variant='record'
										badge={<span className={`badge ${badgeTone}`}>{getSecurityPoolStatusBadgeLabel({ hasForkActivity: pool.hasForkActivity, lifecycleState: displayState })}</span>}
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
											<SecurityPoolSummaryMetrics pool={pool} repPerEthPrice={repPerEthPrice} repPerEthSource={repPerEthSource} repPerEthSourceUrl={repPerEthSourceUrl} showPoolAddress showUniverse />
										</WorkflowSubsection>

										<WorkflowSubsection title='Vaults'>
											<SecurityPoolVaultDirectory
												emptyState={<StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No vaults in this pool yet.' }} />}
												pool={pool}
												renderActions={vault => (
													<button className='destructive' onClick={() => onOpenLiquidationModal(pool.managerAddress, pool.securityPoolAddress, vault.vaultAddress, vault.securityBondAllowance)} disabled={accountState.address === undefined || !isMainnet || !liquidationEnabled}>
														Liquidate Vault
													</button>
												)}
												repPerEthPrice={repPerEthPrice}
												repPerEthSource={repPerEthSource}
												repPerEthSourceUrl={repPerEthSourceUrl}
											/>
										</WorkflowSubsection>
									</EntityCard>
								)
							})}
						</div>
					)
				})()}
			</SectionBlock>

			<LiquidationModal
				accountAddress={accountState.address}
				closeLiquidationModal={closeLiquidationModal}
				currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
				isMainnet={isMainnet}
				liquidationAmount={liquidationAmount}
				liquidationMaxAmount={liquidationMaxAmount}
				liquidationManagerAddress={liquidationManagerAddress}
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				loadingPoolOracleManager={loadingPoolOracleManager}
				liquidationTargetVault={liquidationTargetVault}
				onLoadPoolOracleManager={onLoadPoolOracleManager}
				onSelectedPoolViewChange={() => undefined}
				poolState={selectedPoolWithState?.poolState}
				repPerEthPrice={repPerEthPrice}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				selectedPool={selectedPool}
				securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
				securityPoolOverviewError={securityPoolOverviewError}
				securityPoolOverviewFeedback={securityPoolOverviewFeedback}
				securityPoolOverviewResult={securityPoolOverviewResult}
				callerVaultSummary={callerVaultSummary}
				targetVaultSummary={targetVaultSummary}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
