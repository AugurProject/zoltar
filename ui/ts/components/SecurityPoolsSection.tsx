import { useState } from 'preact/hooks'
import { SectionModeTabs } from './SectionModeTabs.js'
import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import { TabbedSectionBlock } from './TabbedSectionBlock.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { resolveFirstMatchingValue } from '../lib/viewState.js'
import type { SecurityPoolsSectionProps } from '../types/components.js'

type SecurityPoolsView = 'browse' | 'create' | 'operate'

export function shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolExists }: { currentSecurityPoolAddress: string; nextSecurityPoolAddress?: string | undefined; nextView: SecurityPoolsView; selectedPoolExists: boolean }) {
	if (nextView !== 'operate') return false
	const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? currentSecurityPoolAddress
	return resolvedSecurityPoolAddress.trim() !== '' && !selectedPoolExists
}

export function SecurityPoolsSection({ createPool, overview, workflow }: SecurityPoolsSectionProps) {
	const [view, setView] = useState<SecurityPoolsView>(() =>
		resolveFirstMatchingValue<SecurityPoolsView>(
			[
				[workflow.securityPoolAddress !== '', 'operate'],
				[createPool.securityPoolForm.marketId !== '' || createPool.marketDetails !== undefined || createPool.securityPoolResult !== undefined, 'create'],
			],
			'browse',
		),
	)
	const openView = (nextView: SecurityPoolsView, nextSecurityPoolAddress?: string) => {
		setView(nextView)
		const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? workflow.securityPoolAddress
		const selectedPoolExists = overview.securityPools.some(pool => sameCaseInsensitiveText(pool.securityPoolAddress, resolvedSecurityPoolAddress))
		if (!shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress: workflow.securityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolExists })) return
		workflow.onRefreshSelectedPoolData()
	}
	const renderModeTabs = () => (
		<SectionModeTabs
			ariaLabel='Security Pools views'
			className='security-pools-header-switch'
			value={view}
			onChange={openView}
			options={[
				{ label: 'Browse', value: 'browse' },
				{ label: 'Create', value: 'create' },
				{ label: 'Operate', value: 'operate' },
			]}
		/>
	)

	return (
		<div className='route-view-flow'>
			{view === 'operate' ? undefined : (
				<TabbedSectionBlock density='compact' title='Security pools' description='Browse deployed pools, create new pools, and operate on selected pool workflows.' tabs={renderModeTabs()}>
					<></>
				</TabbedSectionBlock>
			)}

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
					showHeader={false}
					onOpenCreatedPool={securityPoolAddress => {
						workflow.onSecurityPoolAddressChange(securityPoolAddress)
						openView('operate', securityPoolAddress)
					}}
				/>
			) : undefined}

			{view === 'operate' ? <SecurityPoolWorkflowSection {...workflow} modeTabs={renderModeTabs()} showHeader={false} /> : undefined}
		</div>
	)
}
