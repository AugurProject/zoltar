import { getZoltarViewHref } from '../lib/zoltarNavigation.js'
import type { ComponentProps } from 'preact'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { ZoltarRoutes } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/components/ZoltarRoutes.js'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import type { ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { Route } from '@zoltar/ui-zoltar-shared/types/app.js'

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	readBackendMessage: string | undefined
	route: Route
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
			return (
				<NotFoundSection
					links={[
						{ href: getZoltarViewHref('overview'), label: zoltarCopy.overview },
						{ href: getZoltarViewHref('questions'), label: marketCopy.browseQuestions },
						{ href: getZoltarViewHref('universes'), label: zoltarCopy.universesTitle },
					]}
				/>
			)
		default:
			return assertNever(route)
	}
}
