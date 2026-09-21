import type { ChaosDashboardController } from './dashboard-server.ts'

/** The PUT routes the dashboard exposes, mapped to the controller methods that own them; optional controls register only when present. */
export function mutationRoutes(controller: ChaosDashboardController) {
	const handlers = new Map<string, (value: unknown) => unknown | Promise<unknown>>([
		['/api/reconciliation/candidate', controller.setCandidate],
		['/api/reconciliation/cancellation', controller.setCancellation],
		['/api/reconciliation/obligation', controller.setObligation],
		['/api/paused', controller.setPaused],
		['/api/reconciliation/replacement', controller.setReplacement],
		['/api/reconciliation/workflow', controller.setWorkflow],
		['/api/settings', controller.setSettings],
		['/api/signer', controller.setSigner],
	])
	if (controller.setSchedule !== undefined) handlers.set('/api/schedule', controller.setSchedule)
	if (controller.setSelection !== undefined) handlers.set('/api/selection', controller.setSelection)
	if (controller.setOperation !== undefined) handlers.set('/api/operation', controller.setOperation)
	if (controller.setRetirement !== undefined) handlers.set('/api/retirement', controller.setRetirement)
	if (controller.setConnectivity !== undefined) handlers.set('/api/connectivity', controller.setConnectivity)
	if (controller.setExecution !== undefined) handlers.set('/api/execution', controller.setExecution)
	return handlers
}
