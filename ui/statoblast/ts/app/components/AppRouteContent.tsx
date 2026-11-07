import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { PortfoliosSection } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfoliosSection.js'
import { PriceRequestStatusSection } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/PriceRequestStatusSection.js'
import { PortfolioQuestionWorkspace } from './PortfolioQuestionWorkspace.js'
import { UniversePoolDirectorySection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/UniversePoolDirectorySection.js'
import { ZoltarMigrationWorkflow } from '@zoltar/ui-zoltar-shared/features/universes/components/ZoltarMigrationWorkflow.js'
import type { SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { StatoblastRoute } from '@zoltar/ui-statoblast-shared/types/app.js'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { buildPoolsRouteHash } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'

const STATOBLAST_NOT_FOUND_LINKS = [
	{ href: statoblastRouting.getHash('pools'), label: statoblastAppCopy.pools },
	{ href: buildPoolsRouteHash({ view: 'universes' }), label: zoltarCopy.universesTitle },
	{ href: statoblastRouting.getHash('open-oracle'), label: openOracleCopy.priceReports },
	{ href: statoblastRouting.getHash('deploy'), label: commonCopy.deploy },
] as const

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	openOracle: ComponentProps<typeof PriceRequestStatusSection>
	portfolios: ComponentProps<typeof PortfoliosSection>
	readBackendMessage: string | undefined
	route: StatoblastRoute
	questions: ComponentProps<typeof PortfolioQuestionWorkspace>
	questionView: SecurityPoolsView
	universeDirectory: ComponentProps<typeof UniversePoolDirectorySection>
	migration: ComponentProps<typeof ZoltarMigrationWorkflow>
}

function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	return shouldRenderAppRouteContent(route, readBackendMessage)
}

export function AppRouteContent({ deploy, openOracle, portfolios, readBackendMessage, route, questions, questionView, universeDirectory, migration }: Props) {
	if (!shouldRenderRouteContent({ readBackendMessage, route })) return null

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
		case 'pools':
			if (questionView === 'universes') return <UniversePoolDirectorySection {...universeDirectory} />
			if (questionView === 'migrate') return <ZoltarMigrationWorkflow {...migration} />
			return <PortfolioQuestionWorkspace {...questions} />
		case 'portfolios':
			return <PortfoliosSection {...portfolios} />
		case 'open-oracle':
			return <PriceRequestStatusSection {...openOracle} />
		case 'not-found':
			return <NotFoundSection links={STATOBLAST_NOT_FOUND_LINKS} />
		default:
			return assertNever(route)
	}
}
