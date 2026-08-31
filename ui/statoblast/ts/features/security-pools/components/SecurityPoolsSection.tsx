import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js'
import type { SecurityPoolsSectionProps, SecurityPoolsView } from '../../types.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'

export function shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolHasLoadedDetails }: { currentSecurityPoolAddress: string; nextSecurityPoolAddress?: string | undefined; nextView: SecurityPoolsView; selectedPoolHasLoadedDetails: boolean }) {
	if (nextView !== 'operate') return false
	const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? currentSecurityPoolAddress
	return resolvedSecurityPoolAddress.trim() !== '' && !selectedPoolHasLoadedDetails
}

function getSecurityPoolsRouteHeader(view: SecurityPoolsView) {
	if (view === 'browse') return { description: securityPoolCopy.browsePoolsDescription, title: commonCopy.browsePools }
	if (view === 'create') return { description: securityPoolCopy.createPoolDescription, title: commonCopy.createPool }
	return { description: securityPoolCopy.managePoolDescription, title: commonCopy.managePool }
}

export function SecurityPoolsSection({ activeView, createPool, onActiveUniverseChange, onActiveViewChange, overview, workflow }: SecurityPoolsSectionProps) {
	const view = activeView
	const routeHeader = getSecurityPoolsRouteHeader(view)

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
			<RouteHeader description={routeHeader.description} eyebrow={commonCopy.securityPools} title={routeHeader.title} />
			{view === 'browse' ? (
				<SecurityPoolsOverviewSection
					{...overview}
					onSelectSecurityPool={(securityPoolAddress, universeId) => {
						onActiveUniverseChange?.(universeId)
						workflow.onSecurityPoolAddressChange(securityPoolAddress)
						openView('operate', securityPoolAddress)
					}}
				/>
			) : undefined}

			{view === 'create' ? (
				<SecurityPoolSection
					{...createPool}
					activeUniverseId={overview.activeUniverseId}
					onReturnToBrowse={() => openView('browse')}
					showHeader={false}
					onOpenCreatedPool={(securityPoolAddress, universeId) => {
						onActiveUniverseChange?.(universeId)
						workflow.onSecurityPoolAddressChange(securityPoolAddress)
						openView('operate', securityPoolAddress)
					}}
				/>
			) : undefined}

			{view === 'operate' ? <SecurityPoolWorkflowSection {...workflow} showHeader={false} /> : undefined}
		</div>
	)
}
