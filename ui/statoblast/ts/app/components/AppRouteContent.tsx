import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/statoblastShell.js'
import type { RegisterStatoblastPageRefresh } from '@zoltar/ui-statoblast-shared/features/useStatoblastPageRefresh.js'
import { StatoblastWatchlist } from './StatoblastWatchlist.js'
import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SecurityPoolsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsSection.js'
import { ZoltarMigrationWorkflow } from '@zoltar/ui-zoltar-shared/features/universes/components/ZoltarMigrationWorkflow.js'
import { statoblastPageHref, type StatoblastPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { SecurityPoolQuestionWorkspace } from './SecurityPoolQuestionWorkspace.js'

type Props = {
	page: StatoblastPage
	registerPageRefresh: RegisterStatoblastPageRefresh
	contractsMissing: boolean
	deploy: ComponentProps<typeof DeploymentRouteContent>
	securityPools: ComponentProps<typeof SecurityPoolsSection>
	questions: Omit<ComponentProps<typeof SecurityPoolQuestionWorkspace>, 'entry'>
	migration: ComponentProps<typeof ZoltarMigrationWorkflow>
}

export function AppRouteContent({ page, registerPageRefresh, contractsMissing, deploy, securityPools, questions, migration }: Props) {
	if (contractsMissing)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={pageCopy.contractsMissingTitle} description={pageCopy.contractsMissingDetail} />
				<DeploymentRouteContent {...deploy} />
			</div>
		)
	switch (page.kind) {
		case 'watchlist':
			return <StatoblastWatchlist registerPageRefresh={registerPageRefresh} onReadStatus={questions.onReadStatus} enabled={questions.enabled} universe={questions.universeId} owner={questions.parameters.accountAddress} environmentKey={questions.environmentKey} />
		case 'question':
			return <SecurityPoolQuestionWorkspace {...questions} registerPageRefresh={registerPageRefresh} entry={page} />
		case 'pool':
			return <SecurityPoolsSection key={page.pool} {...securityPools} registerPageRefresh={registerPageRefresh} page={page} />
		case 'deploy-pool':
			return <SecurityPoolsSection key='deploy-pool' {...securityPools} deploying />
		case 'migrate-rep':
			return <ZoltarMigrationWorkflow {...migration} singleForm />
		default:
			return <NotFoundSection links={[{ href: statoblastPageHref({ kind: 'watchlist' }), label: pageCopy.watchlist }]} />
	}
}
