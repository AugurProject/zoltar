import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { OpenOracleSection } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/OpenOracleSection.js'
import { SecurityPoolsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsSection.js'
import type { StatoblastRoute } from '@zoltar/ui-statoblast-shared/types/app.js'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { buildPoolsRouteHash } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'

const STATOBLAST_NOT_FOUND_LINKS = [
	{ href: statoblastRouting.getHash('pools'), label: statoblastAppCopy.pools },
	{ href: buildPoolsRouteHash({ view: 'universes' }), label: zoltarCopy.universesTitle },
	{ href: statoblastRouting.getHash('open-oracle'), label: statoblastAppCopy.openOracle },
	{ href: statoblastRouting.getHash('deploy'), label: commonCopy.deploy },
] as const

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	openOracle: ComponentProps<typeof OpenOracleSection>
	readBackendMessage: string | undefined
	route: StatoblastRoute
	securityPools: ComponentProps<typeof SecurityPoolsSection>
}

function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	return shouldRenderAppRouteContent(route, readBackendMessage)
}

export function AppRouteContent({ deploy, openOracle, readBackendMessage, route, securityPools }: Props) {
	if (!shouldRenderRouteContent({ readBackendMessage, route })) return null

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
		case 'pools':
			return <SecurityPoolsSection {...securityPools} />
		case 'open-oracle':
			return <OpenOracleSection {...openOracle} />
		case 'not-found':
			return <NotFoundSection links={STATOBLAST_NOT_FOUND_LINKS} />
		default:
			return assertNever(route)
	}
}
