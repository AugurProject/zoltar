import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '../../features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { ZoltarSection } from '../../features/zoltarSurface/components/ZoltarSection.js'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export const ZOLTAR_NOT_FOUND_LINKS = [
	{ href: '#/deploy', label: commonCopy.deploy },
	{ href: '#/zoltar', label: commonCopy.zoltar },
] as const

type AppRoute = 'deploy' | 'not-found' | 'zoltar'

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	zoltar: ComponentProps<typeof ZoltarSection>
	readBackendMessage: string | undefined
	route: AppRoute
}

export function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	return shouldRenderAppRouteContent(route, readBackendMessage)
}

export function AppRouteContent({ deploy, zoltar, readBackendMessage, route }: Props) {
	if (!shouldRenderRouteContent({ readBackendMessage, route })) return null

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
		case 'zoltar':
			return <ZoltarSection {...zoltar} />
		case 'not-found':
			return <NotFoundSection links={ZOLTAR_NOT_FOUND_LINKS} />
		default:
			return <NotFoundSection links={ZOLTAR_NOT_FOUND_LINKS} />
	}
}
