import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js'
import type { SecurityPoolsSectionProps, SecurityPoolsView } from '../../types.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { UniversePoolDirectorySection } from './UniversePoolDirectorySection.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { securityPoolTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { SelectedPoolRepPriceContext } from './RepPriceStatusLabel.js'
import { FirstRunRoleGuide } from './FirstRunRoleGuide.js'
import { GlossaryTerm } from '../../glossary/components/GlossaryTerm.js'
import * as glossaryCopy from '../../../copy/glossary.js'

function getSecurityPoolsRouteHeader(view: SecurityPoolsView) {
	if (view === 'browse') return { description: undefined, title: commonCopy.browsePools }
	if (view === 'create')
		return {
			description: (
				<>
					{securityPoolCopy.createPoolDescriptionLead}
					<GlossaryTerm id='security-pool'>{glossaryCopy.securityPoolTerm.toLowerCase()}</GlossaryTerm>
					{securityPoolCopy.createPoolDescriptionTail}
				</>
			),
			title: commonCopy.createPool,
		}
	if (view === 'migrate') return { description: zoltarCopy.migrateRouteDescription, title: zoltarCopy.migrateRep }
	if (view === 'universes') return { description: undefined, title: commonCopy.universe }
	return { description: undefined, title: statoblastAppCopy.poolPageTitle }
}

export function SecurityPoolsSection({ activeView, migration, createPool, onActiveViewChange, onOpenSecurityPool, overview, selectedPoolRepPrice, workflow, zoltarUniverse, universeMissing, universeError, onRetryUniverse }: SecurityPoolsSectionProps) {
	const view = activeView
	const routeHeader = getSecurityPoolsRouteHeader(view)
	const hasSelectedPool = workflow.securityPools.some(pool => sameCaseInsensitiveText(pool.securityPoolAddress, workflow.securityPoolAddress))

	return (
		<div className='route-view-flow'>
			{view === 'operate' && hasSelectedPool ? undefined : <RouteHeader description={routeHeader.description} eyebrow={statoblastAppCopy.pools} title={routeHeader.title} />}
			{view === 'browse' ? <FirstRunRoleGuide /> : undefined}
			{view === 'browse' ? <SecurityPoolsOverviewSection {...overview} onSelectSecurityPool={onOpenSecurityPool} /> : undefined}

			{view === 'create' ? (
				<SecurityPoolSection
					{...createPool}
					activeUniverseId={overview.activeUniverseId}
					onReturnToBrowse={() => onActiveViewChange('browse')}
					showHeader={false}
					// Like Browse, one navigation moves both the universe and the pool, so Back returns to the create view.
					onOpenCreatedPool={onOpenSecurityPool}
				/>
			) : undefined}

			{view === 'universes' ? <UniversePoolDirectorySection onMigrateRep={() => onActiveViewChange('migrate')} activeUniverseId={overview.activeUniverseId} zoltarUniverse={zoltarUniverse} universeMissing={universeMissing} universeError={universeError} onRetryUniverse={onRetryUniverse} /> : undefined}

			{view === 'migrate' ? migration : undefined}

			{/* A pending transaction on this pool locks only this pool's actions. */}
			{view === 'operate' ? (
				<TransactionScopeProvider scope={securityPoolTransactionScope(workflow.securityPoolAddress)}>
					<SelectedPoolRepPriceContext.Provider value={selectedPoolRepPrice}>
						<SecurityPoolWorkflowSection {...workflow} showHeader={false} />
					</SelectedPoolRepPriceContext.Provider>
				</TransactionScopeProvider>
			) : undefined}
		</div>
	)
}
