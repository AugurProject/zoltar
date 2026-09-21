/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldShowDeploymentTab } from '@zoltar/ui-zoltar-shared/features/appShell/lib/deploymentTab.js'

void describe('shouldShowDeploymentTab', () => {
	void test('hides the tab only once every step is deployed and nothing is failing', () => {
		const deployed = [{ deployed: true }, { deployed: true }]
		expect(shouldShowDeploymentTab({ applicationDeploymentMissing: false, deploymentStatusError: undefined, deploymentStatuses: deployed, hasLoadedDeploymentStatuses: true })).toBe(false)
		expect(shouldShowDeploymentTab({ applicationDeploymentMissing: false, deploymentStatusError: undefined, deploymentStatuses: deployed, hasLoadedDeploymentStatuses: false })).toBe(false)
	})

	void test('shows the tab for errors, missing application contracts, or undeployed steps', () => {
		expect(shouldShowDeploymentTab({ applicationDeploymentMissing: false, deploymentStatusError: 'RPC failed', deploymentStatuses: [], hasLoadedDeploymentStatuses: false })).toBe(true)
		expect(shouldShowDeploymentTab({ applicationDeploymentMissing: true, deploymentStatusError: undefined, deploymentStatuses: [], hasLoadedDeploymentStatuses: true })).toBe(true)
		expect(shouldShowDeploymentTab({ applicationDeploymentMissing: false, deploymentStatusError: undefined, deploymentStatuses: [{ deployed: true }, { deployed: false }], hasLoadedDeploymentStatuses: true })).toBe(true)
	})
})
