import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import type { SecurityPoolsSectionProps, SecurityPoolsView } from '../types/components.js'

export function shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolHasLoadedDetails }: { currentSecurityPoolAddress: string; nextSecurityPoolAddress?: string | undefined; nextView: SecurityPoolsView; selectedPoolHasLoadedDetails: boolean }) {
	if (nextView !== 'operate') return false
	const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? currentSecurityPoolAddress
	return resolvedSecurityPoolAddress.trim() !== '' && !selectedPoolHasLoadedDetails
}

export function SecurityPoolsSection({ activeView, createPool, onActiveViewChange, overview, workflow }: SecurityPoolsSectionProps) {
	const view = activeView

	const openView = (nextView: SecurityPoolsView, nextSecurityPoolAddress?: string) => {
		onActiveViewChange(nextView)
		const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? workflow.securityPoolAddress
		const selectedPool = overview.securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, resolvedSecurityPoolAddress))
		const selectedPoolHasLoadedDetails = selectedPool !== undefined && selectedPool.hasLoadedVaults !== false
		if (!shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress: workflow.securityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolHasLoadedDetails })) return
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
