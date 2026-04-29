import { useState } from 'preact/hooks'
import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { resolveFirstMatchingValue } from '../lib/viewState.js'
import type { SecurityPoolsSectionProps } from '../types/components.js'

type SecurityPoolsView = 'browse' | 'create' | 'operate'

export function shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress, nextSecurityPoolAddress, nextView }: { currentSecurityPoolAddress: string; nextSecurityPoolAddress?: string | undefined; nextView: SecurityPoolsView }) {
	if (nextView !== 'operate') return false
	const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? currentSecurityPoolAddress
	if (resolvedSecurityPoolAddress.trim() === '') return false
	return sameCaseInsensitiveText(currentSecurityPoolAddress, resolvedSecurityPoolAddress)
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
		if (
			!shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress: workflow.securityPoolAddress,
				nextSecurityPoolAddress,
				nextView,
			})
		) {
			return
		}
		workflow.onRefreshSelectedPoolData()
	}

	return (
		<section className='panel market-panel'>
			<div className='subtab-nav' role='tablist' aria-label='Security Pools views'>
				<button className={`subtab-link ${view === 'browse' ? 'active' : ''}`} type='button' onClick={() => openView('browse')} aria-pressed={view === 'browse'}>
					Browse Pools
				</button>
				<button className={`subtab-link ${view === 'create' ? 'active' : ''}`} type='button' onClick={() => openView('create')} aria-pressed={view === 'create'}>
					Create Pool
				</button>
				<button className={`subtab-link ${view === 'operate' ? 'active' : ''}`} type='button' onClick={() => openView('operate')} aria-pressed={view === 'operate'}>
					Selected Pool
				</button>
			</div>

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

			{view === 'operate' ? <SecurityPoolWorkflowSection {...workflow} showHeader={false} /> : undefined}
		</section>
	)
}
