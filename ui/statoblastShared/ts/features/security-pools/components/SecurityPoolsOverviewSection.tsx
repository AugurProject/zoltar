import { formatSecurityPoolPageSummary } from '../lib/securityPoolLabels.js'
import { PoolDirectoryRow } from './PoolDirectoryRow.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { getWalletScopedAccountAddress } from '@zoltar/ui-core-shared/wallet/network.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex, SECURITY_POOL_PAGE_SIZE } from '@zoltar/ui-core-shared/lib/pagination.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { calculateMintingCapacityAttoEth } from '../../markets/lib/trading.js'
import { getPoolRegistryPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import type { SecurityPoolsOverviewSectionProps } from '../../types.js'
import { resolveRepPrice } from '../lib/uiPriceOracle.js'

export function SecurityPoolsOverviewSection({
	accountState,
	activeUniverseId,
	currentTimestamp,
	environmentRefreshKey,
	hasLoadedSecurityPoolPage,
	loadingSecurityPoolPage,
	onCreateSecurityPool,
	onLoadSecurityPoolPage,
	onSelectSecurityPool,
	securityPoolBrowseCount,
	securityPoolPage,
	securityPoolOverviewError,
	repPerEthPrice,
	uiPriceOracle,
}: SecurityPoolsOverviewSectionProps) {
	const [pageIndex, setPageIndex] = useState(0)
	const [activePageRequestKey, setActivePageRequestKey] = useState<string | undefined>(undefined)
	const [pageLoadError, setPageLoadError] = useState<string | undefined>(undefined)
	const [searchText, setSearchText] = useState('')
	const [systemStateFilter, setSystemStateFilter] = useState<'all' | SecurityPoolLifecycleState>('all')
	const loadSecurityPoolPageRef = useRef(onLoadSecurityPoolPage)
	loadSecurityPoolPageRef.current = onLoadSecurityPoolPage
	const requestedPoolCount = securityPoolPage?.poolCount ?? securityPoolBrowseCount
	const requestedPoolPageCount = getPaginationPageCount(requestedPoolCount, SECURITY_POOL_PAGE_SIZE)
	const resolvedPageIndex = resolvePaginationPageIndex(pageIndex, requestedPoolPageCount)
	const scopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId)
	const accountRequestKey = scopedAccountAddress?.toLowerCase() ?? 'no-account'
	const currentPageRequestKey = `${environmentRefreshKey}:${resolvedPageIndex}:${SECURITY_POOL_PAGE_SIZE}:${accountRequestKey}`
	const hasCurrentPageData = securityPoolPage?.requestKey === currentPageRequestKey && securityPoolPage.pageIndex === resolvedPageIndex && securityPoolPage.pageSize === SECURITY_POOL_PAGE_SIZE
	const currentPoolCount = hasCurrentPageData ? securityPoolPage.poolCount : undefined
	const poolPageCount = getPaginationPageCount(currentPoolCount, SECURITY_POOL_PAGE_SIZE)
	const pagedSecurityPools = hasCurrentPageData ? securityPoolPage.pools : []
	const isWaitingForPageData = activePageRequestKey === currentPageRequestKey
	const hasLoadedCurrentPage = hasLoadedSecurityPoolPage && hasCurrentPageData
	const effectiveSecurityPoolOverviewError = securityPoolOverviewError ?? pageLoadError
	const loadingCurrentPage = loadingSecurityPoolPage || isWaitingForPageData || (!hasLoadedCurrentPage && effectiveSecurityPoolOverviewError === undefined)
	const registryPresentation = getPoolRegistryPresentation({
		hasLoaded: hasLoadedCurrentPage,
		isLoading: loadingCurrentPage && !hasLoadedCurrentPage,
		mode: 'collection',
		poolCount: pagedSecurityPools.length,
	})
	const securityPoolsWithState = pagedSecurityPools.map(pool => ({
		pool,
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
	const normalizedSearchText = searchText.trim().toLowerCase()
	const hasPreviousPage = resolvedPageIndex > 0
	const hasNextPage = hasCurrentPageData && getHasNextPaginationPage(resolvedPageIndex, poolPageCount)
	const retryPoolRegistryLoad = () => {
		setPageLoadError(undefined)
		setActivePageRequestKey(currentPageRequestKey)
		void Promise.resolve(onLoadSecurityPoolPage(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE, currentPageRequestKey))
			.catch(() => {
				setPageLoadError(securityPoolCopy.poolPageLoadError)
			})
			.finally(() => {
				setActivePageRequestKey(current => (current === currentPageRequestKey ? undefined : current))
			})
	}
	useEffect(() => {
		if (resolvedPageIndex === pageIndex) return
		setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])
	useEffect(() => {
		let cancelled = false
		setPageLoadError(undefined)
		setActivePageRequestKey(currentPageRequestKey)
		void Promise.resolve(loadSecurityPoolPageRef.current(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE, currentPageRequestKey))
			.catch(() => {
				if (cancelled) return
				setPageLoadError(securityPoolCopy.poolPageLoadError)
			})
			.finally(() => {
				if (cancelled) return
				setActivePageRequestKey(current => (current === currentPageRequestKey ? undefined : current))
			})
		return () => {
			cancelled = true
		}
	}, [currentPageRequestKey, environmentRefreshKey, resolvedPageIndex])
	const filteredSecurityPools = securityPoolsWithState.filter(({ pool, poolState }) => {
		const displayState = poolState.lifecycleState
		if (pool.universeId !== activeUniverseId) return false
		if (systemStateFilter !== 'all' && displayState !== systemStateFilter) return false
		if (normalizedSearchText === '') return true
		return pool.securityPoolAddress.toLowerCase().includes(normalizedSearchText) || pool.questionId.toLowerCase().includes(normalizedSearchText) || pool.marketDetails.title.toLowerCase().includes(normalizedSearchText) || pool.marketDetails.description.toLowerCase().includes(normalizedSearchText)
	})
	const hasActiveFilters = normalizedSearchText !== '' || systemStateFilter !== 'all' || filteredSecurityPools.length !== pagedSecurityPools.length
	return (
		<SectionBlock
			density='compact'
			variant='plain'
			actions={
				<PaginationControls
					hasNextPage={hasNextPage}
					hasPreviousPage={hasPreviousPage}
					loading={loadingCurrentPage}
					onNextPage={() => {
						setPageIndex(current => current + 1)
					}}
					onPreviousPage={() => {
						setPageIndex(current => Math.max(0, current - 1))
					}}
					summary={hasCurrentPageData ? formatPaginationSummary(resolvedPageIndex, poolPageCount) : undefined}
				/>
			}
		>
			<ErrorNotice message={effectiveSecurityPoolOverviewError} />
			{effectiveSecurityPoolOverviewError === undefined ? undefined : (
				<div className='actions pool-registry-recovery-actions'>
					<button className='secondary' type='button' onClick={retryPoolRegistryLoad} disabled={loadingCurrentPage}>
						{loadingCurrentPage ? <LoadingText>{securityPoolCopy.retryingSecurityPoolsTruncated}</LoadingText> : securityPoolCopy.retryLoadingPools}
					</button>
				</div>
			)}
			<div className='filter-toolbar'>
				<label className='field'>
					<span>{securityPoolCopy.searchLoadedPage}</span>
					<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder={securityPoolCopy.poolSearchPlaceholder} />
				</label>
				<label className='field'>
					<span>{securityPoolCopy.systemState}</span>
					<select value={systemStateFilter} onChange={event => setSystemStateFilter(event.currentTarget.value as 'all' | SecurityPoolLifecycleState)}>
						<option value='all'>{securityPoolCopy.allStates}</option>
						<option value='operational'>{commonCopy.operational}</option>
						<option value='ended'>{securityPoolCopy.ended}</option>
						<option value='poolForked'>{securityPoolCopy.poolForked}</option>
						<option value='forkMigration'>{securityPoolCopy.forkMigration}</option>
						<option value='forkTruthAuction'>{commonCopy.truthAuction}</option>
					</select>
				</label>
			</div>
			{hasActiveFilters && pagedSecurityPools.length > 0 ? <p className='detail'>{formatSecurityPoolPageSummary(filteredSecurityPools.length, pagedSecurityPools.length)}</p> : undefined}

			{(() => {
				if (pagedSecurityPools.length === 0) {
					if (registryPresentation === undefined || (effectiveSecurityPoolOverviewError !== undefined && !loadingCurrentPage)) return undefined
					const isEmptyRegistry = registryPresentation.key === 'empty'
					const registryActions = (() => {
						if (isEmptyRegistry && onCreateSecurityPool !== undefined)
							return (
								<button className='primary' type='button' onClick={onCreateSecurityPool}>
									{commonCopy.createSecurityPoolAction}
								</button>
							)
						return undefined
					})()

					if (isEmptyRegistry) return <EmptyState title={securityPoolCopy.noSecurityPools} detail={registryPresentation.detail} actions={registryActions} />
					return <StateHint presentation={registryPresentation} actions={registryActions} />
				}
				if (filteredSecurityPools.length === 0) return <EmptyState title={commonCopy.noMatches} detail={securityPoolCopy.poolFiltersEmpty} />

				return (
					<div className='comparison-record-list'>
						{filteredSecurityPools.map(({ pool, poolState }) => {
							const repPrice = resolveRepPrice({ now: currentTimestamp, poolOracle: { price: pool.lastOraclePrice, settlementTimestamp: pool.lastOracleSettlementTimestamp }, setting: uiPriceOracle, uniswapPrice: repPerEthPrice })
							const capacity = calculateMintingCapacityAttoEth(pool.totalCapacityOwnershipAttoRep, repPrice.price, pool.statoblastSecurityMultiplierBps)
							return <PoolDirectoryRow key={pool.securityPoolAddress} pool={pool} activeUniverseId={activeUniverseId} lifecycleState={poolState.lifecycleState} capacity={capacity} currentTimestamp={currentTimestamp} onSelect={onSelectSecurityPool} repPrice={repPrice} />
						})}
					</div>
				)
			})()}
		</SectionBlock>
	)
}
