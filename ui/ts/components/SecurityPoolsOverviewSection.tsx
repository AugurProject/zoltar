import { useEffect, useRef, useState } from 'preact/hooks'
import { zeroAddress } from 'viem'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LiquidationModal } from './LiquidationModal.js'
import { PaginationControls } from './PaginationControls.js'
import { Question, getQuestionTitle } from './Question.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolVaultDirectory } from './SecurityPoolVaultDirectory.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { sameAddress } from '../lib/address.js'
import { isMainnetChain } from '../lib/network.js'
import { SECURITY_POOL_PAGE_SIZE } from '../lib/pagination.js'
import { getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'

export function SecurityPoolsOverviewSection({
	accountState,
	closeLiquidationModal,
	hasLoadedSecurityPoolPage,
	liquidationAmount,
	liquidationMaxAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	liquidationTimeoutMinutes,
	loadingPoolOracleManager,
	loadingSecurityPoolPage,
	onLiquidationAmountChange,
	onLiquidationTimeoutMinutesChange,
	onLoadPoolOracleManager,
	onLoadSecurityPoolPage,
	onOpenLiquidationModal,
	onQueueLiquidation,
	onSelectSecurityPool,
	poolOracleManagerDetails,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityPoolBrowseCount,
	securityPoolPage,
	securityPoolOverviewActiveAction,
	securityPoolOverviewError,
	securityPoolOverviewResult,
}: SecurityPoolsOverviewSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const [pageIndex, setPageIndex] = useState(0)
	const [activePageRequestKey, setActivePageRequestKey] = useState<string | undefined>(undefined)
	const [searchText, setSearchText] = useState('')
	const [systemStateFilter, setSystemStateFilter] = useState<'all' | SecurityPoolLifecycleState>('all')
	const [vaultFilter, setVaultFilter] = useState<'all' | 'has-vaults' | 'empty'>('all')
	const loadSecurityPoolPageRef = useRef(onLoadSecurityPoolPage)
	loadSecurityPoolPageRef.current = onLoadSecurityPoolPage
	const effectivePoolCount = securityPoolPage?.poolCount ?? securityPoolBrowseCount
	let poolPageCount: number | undefined
	if (effectivePoolCount === undefined) {
		poolPageCount = undefined
	} else if (effectivePoolCount === 0n) {
		poolPageCount = 0
	} else {
		poolPageCount = Math.ceil(Number(effectivePoolCount) / SECURITY_POOL_PAGE_SIZE)
	}
	let resolvedPageIndex = pageIndex
	if (poolPageCount === 0) {
		resolvedPageIndex = 0
	} else if (poolPageCount !== undefined) {
		resolvedPageIndex = Math.min(pageIndex, poolPageCount - 1)
	}
	const currentPageRequestKey = `${resolvedPageIndex}:${SECURITY_POOL_PAGE_SIZE}`
	const hasCurrentPageData = securityPoolPage?.pageIndex === resolvedPageIndex && securityPoolPage.pageSize === SECURITY_POOL_PAGE_SIZE
	const pagedSecurityPools = hasCurrentPageData ? securityPoolPage.pools : []
	const isWaitingForPageData = activePageRequestKey === currentPageRequestKey
	const registryPresentation = getPoolRegistryPresentation({
		hasLoaded: hasLoadedSecurityPoolPage && hasCurrentPageData,
		isLoading: loadingSecurityPoolPage || isWaitingForPageData,
		mode: 'collection',
		poolCount: pagedSecurityPools.length,
	})
	const securityPoolsWithState = pagedSecurityPools.map(pool => ({
		pool,
		hasKnownForkActivity: pool.hasForkActivity,
		poolState: evaluateSecurityPoolState({
			lifecycleState: deriveSecurityPoolLifecycleState({
				hasForkActivity: pool.hasForkActivity,
				isChildPool: pool.parent !== zeroAddress,
				questionOutcome: pool.questionOutcome,
				systemState: pool.systemState,
				universeHasForked: pool.universeHasForked,
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
	const hasPreviousPage = resolvedPageIndex > 0
	const hasNextPage = poolPageCount === undefined ? false : resolvedPageIndex + 1 < poolPageCount
	useEffect(() => {
		if (resolvedPageIndex === pageIndex) return
		setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])
	useEffect(() => {
		let cancelled = false
		setActivePageRequestKey(currentPageRequestKey)
		void Promise.resolve(loadSecurityPoolPageRef.current(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE))
			.catch(() => undefined)
			.finally(() => {
				if (cancelled) return
				setActivePageRequestKey(current => (current === currentPageRequestKey ? undefined : current))
			})
		return () => {
			cancelled = true
		}
	}, [currentPageRequestKey, resolvedPageIndex])
	const filteredSecurityPools = securityPoolsWithState.filter(({ pool, poolState }) => {
		const displayState = poolState.lifecycleState
		if (systemStateFilter !== 'all' && displayState !== systemStateFilter) return false
		if (vaultFilter === 'has-vaults' && pool.vaultCount === 0n) return false
		if (vaultFilter === 'empty' && pool.vaultCount > 0n) return false
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
					<PaginationControls
						hasNextPage={hasNextPage}
						hasPreviousPage={hasPreviousPage}
						loading={loadingSecurityPoolPage}
						onNextPage={() => {
							setPageIndex(current => current + 1)
						}}
						onPreviousPage={() => {
							setPageIndex(current => Math.max(0, current - 1))
						}}
						summary={securityPoolPage === undefined || poolPageCount === undefined ? undefined : `Page ${resolvedPageIndex + 1} of ${Math.max(poolPageCount, 1)}`}
					/>
				}
			>
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
				{pagedSecurityPools.length > 0 ? (
					<p className='detail'>
						{filteredSecurityPools.length.toString()} of {pagedSecurityPools.length.toString()} pools shown on this page.
					</p>
				) : undefined}

				{(() => {
					if (pagedSecurityPools.length === 0) {
						if (registryPresentation === undefined) return undefined

						return <StateHint presentation={registryPresentation} />
					}
					if (filteredSecurityPools.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: 'No matches', badgeTone: 'muted', detail: 'No pools match the current search and filter settings.' }} />

					return (
						<div className='entity-card-list'>
							{filteredSecurityPools.map(({ hasKnownForkActivity, pool, poolState }) => {
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
										badge={
											<span className={`badge ${badgeTone}`}>
												{getSecurityPoolStatusBadgeLabel({
													hasForkActivity: hasKnownForkActivity,
													questionOutcome: pool.questionOutcome,
													lifecycleState: displayState,
												})}
											</span>
										}
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
											{pool.hasLoadedVaults === false ? (
												<StateHint
													presentation={{
														key: 'action_needed',
														badgeLabel: 'Deferred',
														badgeTone: 'muted',
														detail: `Open this pool to load ${pool.vaultCount.toString()} vault${pool.vaultCount === 1n ? '' : 's'}.`,
													}}
												/>
											) : (
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
											)}
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
				liquidationTimeoutMinutes={liquidationTimeoutMinutes}
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
				securityPoolOverviewResult={securityPoolOverviewResult}
				callerVaultSummary={callerVaultSummary}
				targetVaultSummary={targetVaultSummary}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onLiquidationTimeoutMinutesChange={onLiquidationTimeoutMinutesChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
