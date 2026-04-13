import { useState } from 'preact/hooks'
import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import { resolveFirstMatchingValue } from '../lib/viewState.js'
import type { SecurityPoolsSectionProps } from '../types/components.js'

type SecurityPoolsView = 'browse' | 'create' | 'operate'

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

	return (
		<section className='panel market-panel'>
			<div className='subtab-nav' role='tablist' aria-label='Security Pools views'>
				<button className={`subtab-link ${view === 'browse' ? 'active' : ''}`} type='button' onClick={() => setView('browse')} aria-pressed={view === 'browse'}>
					Browse Pools
				</button>
				<button className={`subtab-link ${view === 'create' ? 'active' : ''}`} type='button' onClick={() => setView('create')} aria-pressed={view === 'create'}>
					Create Pool
				</button>
				<button className={`subtab-link ${view === 'operate' ? 'active' : ''}`} type='button' onClick={() => setView('operate')} aria-pressed={view === 'operate'}>
					Selected Pool
				</button>
			</div>

			{view === 'browse' ? (
				<SecurityPoolsOverviewSection
					{...overview}
					onSelectSecurityPool={securityPoolAddress => {
						workflow.onSecurityPoolAddressChange(securityPoolAddress)
						setView('operate')
					}}
				/>
			) : undefined}

			{view === 'create' ? <SecurityPoolSection {...createPool} showHeader={false} /> : undefined}

			{view === 'operate' ? <SecurityPoolWorkflowSection {...workflow} showHeader={false} /> : undefined}
		</section>
	)
}
