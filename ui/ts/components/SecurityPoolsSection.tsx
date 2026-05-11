import { useEffect, useRef } from 'preact/hooks'
import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import type { SecurityPoolsSectionProps, SecurityPoolsView } from '../types/components.js'

export function shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolExists }: { currentSecurityPoolAddress: string; nextSecurityPoolAddress?: string | undefined; nextView: SecurityPoolsView; selectedPoolExists: boolean }) {
	if (nextView !== 'operate') return false
	const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? currentSecurityPoolAddress
	return resolvedSecurityPoolAddress.trim() !== '' && !selectedPoolExists
}

export function SecurityPoolsSection({ activeView, createPool, onActiveViewChange, overview, workflow }: SecurityPoolsSectionProps) {
	const view = activeView
	const autoLoadedBrowsePools = useRef(false)

	useEffect(() => {
		if (view !== 'browse') return
		if (overview.loadingSecurityPools) return
		if (overview.hasLoadedSecurityPools) return
		if (autoLoadedBrowsePools.current) return
		autoLoadedBrowsePools.current = true
		void Promise.resolve(overview.onLoadSecurityPools()).catch(() => {
			autoLoadedBrowsePools.current = false
		})
	}, [overview.hasLoadedSecurityPools, overview.loadingSecurityPools, overview.onLoadSecurityPools, view])

	const openView = (nextView: SecurityPoolsView, nextSecurityPoolAddress?: string) => {
		onActiveViewChange(nextView)
		const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? workflow.securityPoolAddress
		const selectedPoolExists = overview.securityPools.some(pool => sameCaseInsensitiveText(pool.securityPoolAddress, resolvedSecurityPoolAddress))
		if (!shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress: workflow.securityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolExists })) return
		workflow.onRefreshSelectedPoolData(resolvedSecurityPoolAddress)
	}

	return (
		<div className='route-view-flow'>
			{view === 'browse' ? (
				<SecurityPoolsOverviewSection
					{...overview}
					onSelectSecurityPool={securityPoolAddress => {
						workflow.onSecurityPoolAddressChange(securityPoolAddress)
						openView('operate', securityPoolAddress)
					}}
				/>
			) : undefined}

			{view === 'create' ? (
				<SecurityPoolSection
					{...createPool}
					onReturnToBrowse={() => openView('browse')}
					showHeader={false}
					onOpenCreatedPool={securityPoolAddress => {
						workflow.onSecurityPoolAddressChange(securityPoolAddress)
						openView('operate', securityPoolAddress)
					}}
				/>
			) : undefined}

			{view === 'operate' ? <SecurityPoolWorkflowSection {...workflow} showHeader={false} /> : undefined}
		</div>
	)
}
