import type { ComponentProps } from 'preact'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { ZoltarRoutes } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/components/ZoltarRoutes.js'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import type { ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'

/** Recovery links lead back into the application; deployment is a setup flow, not a recovery destination. */
const ZOLTAR_NOT_FOUND_LINKS = [
	{ href: '#/zoltar', label: zoltarCopy.overview },
	{ href: '#/zoltar?zoltarView=questions', label: marketCopy.browseQuestions },
	{ href: '#/zoltar?zoltarView=universes', label: zoltarCopy.universesTitle },
] as const

type AppRoute = 'deploy' | 'not-found' | 'zoltar'

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	readBackendMessage: string | undefined
	route: AppRoute
	zoltarView: ZoltarView
}

export function AppRouteContent({ deploy, readBackendMessage, route, zoltarView }: Props) {
	if (!shouldRenderAppRouteContent(route, readBackendMessage)) return null

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
		case 'zoltar':
			return <ZoltarRoutes view={zoltarView} />
		case 'not-found':
			return <NotFoundSection links={ZOLTAR_NOT_FOUND_LINKS} />
		default:
			return assertNever(route)
	}
}
