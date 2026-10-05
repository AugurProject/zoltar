import { publicDashboardError } from '@zoltar/bot-shared/dashboard/public-error'
import { dashboardJson, dashboardSecurityHeaders } from '@zoltar/bot-shared/dashboard/security'
import { browserScript } from './browser-assets.ts'
import type { ChaosDashboardController } from './dashboard-controller-contract.ts'

export async function readDashboardResource(pathname: string, directory: string, controller: ChaosDashboardController, mutationBarrier: Promise<unknown>) {
	const script = await browserScript(pathname, directory)
	if (script !== undefined) return new Response(script, { headers: dashboardSecurityHeaders('text/javascript; charset=utf-8') })
	if (pathname !== '/api/deployment-archives') return undefined
	try {
		await mutationBarrier
		return dashboardJson((await controller.getDeploymentArchives?.()) ?? [])
	} catch (error) {
		return publicDashboardError('chaos', error, 503, 'archives-read', 'Deployment archives are temporarily unavailable.')
	}
}
