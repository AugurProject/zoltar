import { useState } from 'preact/hooks'
import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import type { SecurityPoolsSectionProps } from '../types/components.js'

type SecurityPoolsView = 'browse' | 'create' | 'operate'

function getInitialSecurityPoolsView({ createPool, workflow }: SecurityPoolsSectionProps): SecurityPoolsView {
	if (workflow.securityPoolAddress !== '') return 'operate'
	if (createPool.securityPoolForm.marketId !== '' || createPool.marketDetails !== undefined || createPool.securityPoolResult !== undefined) return 'create'
	return 'browse'
}

export function SecurityPoolsSection({ createPool, overview, workflow }: SecurityPoolsSectionProps) {
	const [view, setView] = useState<SecurityPoolsView>(() => getInitialSecurityPoolsView({ createPool, overview, workflow }))

	return (
		<section className="panel market-panel">
			<div className="market-header">
				<div>
					<h2>Security Pools</h2>
				</div>
			</div>

			<div className="subtab-nav" role="tablist" aria-label="Security Pools views">
				<button className={`subtab-link ${ view === 'browse' ? 'active' : '' }`} type="button" onClick={() => setView('browse')} aria-pressed={view === 'browse'}>
					Browse Pools
				</button>
				<button className={`subtab-link ${ view === 'create' ? 'active' : '' }`} type="button" onClick={() => setView('create')} aria-pressed={view === 'create'}>
					Create Pool
				</button>
				<button className={`subtab-link ${ view === 'operate' ? 'active' : '' }`} type="button" onClick={() => setView('operate')} aria-pressed={view === 'operate'}>
					Selected Pool
				</button>
			</div>

			{view === 'browse' ? (
				<SecurityPoolsOverviewSection
					{...overview}
					showHeader={false}
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
