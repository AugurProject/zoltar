import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { SecurityPoolsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsSection.js'
import { PriceRequestStatusSection } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/PriceRequestStatusSection.js'
import { SecurityPoolQuestionWorkspace } from './SecurityPoolQuestionWorkspace.js'
import { UniversePoolDirectorySection } from '@zoltar/ui-statoblast-shared/features/question-ledgers/components/UniversePoolDirectorySection.js'
import { ZoltarMigrationWorkflow } from '@zoltar/ui-zoltar-shared/features/universes/components/ZoltarMigrationWorkflow.js'
import type { QuestionLedgersView } from '@zoltar/ui-statoblast-shared/features/types.js'
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
	{ href: statoblastRouting.getHash('pools'), label: statoblastAppCopy.questions },
	{ href: statoblastRouting.getHash('security-pools'), label: statoblastAppCopy.securityPools },
	{ href: buildPoolsRouteHash({ view: 'universes' }), label: zoltarCopy.universesTitle },
	{ href: statoblastRouting.getHash('open-oracle'), label: openOracleCopy.priceReports },
	{ href: statoblastRouting.getHash('deploy'), label: commonCopy.deploy },
] as const

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	openOracle: ComponentProps<typeof PriceRequestStatusSection>
	securityPools: ComponentProps<typeof SecurityPoolsSection>
	readBackendMessage: string | undefined
	route: StatoblastRoute
	questions: ComponentProps<typeof SecurityPoolQuestionWorkspace>
	questionView: QuestionLedgersView
	universeDirectory: ComponentProps<typeof UniversePoolDirectorySection>
	migration: ComponentProps<typeof ZoltarMigrationWorkflow>
}

function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	return shouldRenderAppRouteContent(route, readBackendMessage)
}

export function AppRouteContent({ deploy, openOracle, securityPools, readBackendMessage, route, questions, questionView, universeDirectory, migration }: Props) {
	if (!shouldRenderRouteContent({ readBackendMessage, route })) return undefined

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
		case 'pools':
			if (questionView === 'universes') return <UniversePoolDirectorySection {...universeDirectory} />
			if (questionView === 'migrate') return <ZoltarMigrationWorkflow {...migration} />
			return <SecurityPoolQuestionWorkspace {...questions} />
		case 'security-pools':
			return <SecurityPoolsSection {...securityPools} />
		case 'open-oracle':
			return <PriceRequestStatusSection {...openOracle} />
		case 'not-found':
			return <NotFoundSection links={STATOBLAST_NOT_FOUND_LINKS} />
		default:
			return assertNever(route)
	}
}
