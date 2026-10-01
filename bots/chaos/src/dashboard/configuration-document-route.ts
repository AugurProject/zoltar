import { publicDashboardError } from '@zoltar/bot-shared/dashboard/public-error'
import { dashboardJson } from '@zoltar/bot-shared/dashboard/security'

export async function readDashboardConfiguration(read: () => unknown | Promise<unknown>, mutationBarrier: Promise<unknown>, complete: boolean) {
	try {
		await mutationBarrier
		return dashboardJson(await read())
	} catch (error) {
		return publicDashboardError('chaos', error, 503, complete ? 'configuration-document-read' : 'configuration-read', complete ? 'Complete configuration is temporarily unavailable.' : 'Dashboard configuration is temporarily unavailable.')
	}
}
