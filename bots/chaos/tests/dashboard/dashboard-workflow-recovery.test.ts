import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS } from '../support/chromium.ts'
import type { connectToChromium } from '../support/dashboard-harness.ts'
import { openWorkflowRecoveryBrowser, startWorkflowRecoveryDashboard, WORKFLOW_VIEWPORTS } from '../support/workflow-recovery-harness.ts'
import { startWorkflowRenderingStage, verifyDeploymentCheckBeforeCompleteScan, verifyOverviewHealthAndWorkflow, verifySafetyPauseOverview, verifyStaleRecoveryScenarios } from '../support/workflow-recovery-overview-steps.ts'
import { verifyDegradedSubmissionReadiness, verifyMobileSettingsLayout, verifyResumeScope, verifySectionNavigation } from '../support/workflow-recovery-readiness-steps.ts'
import { verifyEcosystemTopology, verifyOperationCatalog, verifyOverviewActivity, verifyRecoveryRoute } from '../support/workflow-recovery-route-steps.ts'
import { verifyExecutionPolicyValidation, verifySettingsConnectivityAndSigner } from '../support/workflow-recovery-settings-steps.ts'

// One browser session walks every stage in order: each stage leaves the fixture, configuration revision, and page state
// the next one starts from, so the stages run as one test rather than as independent tests.
browserTest(
	'validates stale recovery, workflow status semantics, and mobile interaction targets',
	async () => {
		const server = startWorkflowRecoveryDashboard()
		let browserSession: Awaited<ReturnType<typeof connectToChromium>> | undefined
		try {
			const context = await openWorkflowRecoveryBrowser(server, session => {
				browserSession = session
			})
			await verifyStaleRecoveryScenarios(context)
			await verifyDeploymentCheckBeforeCompleteScan(context)
			await verifySafetyPauseOverview(context)
			startWorkflowRenderingStage(context)
			for (const viewport of WORKFLOW_VIEWPORTS) {
				await verifyOverviewHealthAndWorkflow(context, viewport)
				await verifyOperationCatalog(context, viewport)
				await verifyEcosystemTopology(context, viewport)
				await verifyRecoveryRoute(context, viewport)
				await verifyOverviewActivity(context, viewport)
				await verifySettingsConnectivityAndSigner(context, viewport)
				await verifyExecutionPolicyValidation(context, viewport)
				await verifyDegradedSubmissionReadiness(context, viewport)
				await verifyResumeScope(context, viewport)
			}
			await verifyMobileSettingsLayout(context)
			await verifySectionNavigation(context)
		} finally {
			try {
				await browserSession?.close()
			} finally {
				server.dashboard.stop(true)
			}
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 60_000,
)
