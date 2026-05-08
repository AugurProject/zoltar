import type { ListedSecurityPool, OracleManagerDetails } from '../types/contracts.js'
import type { LifecycleStagePresentation } from '../types/components.js'

export function getSecurityPoolStagePresentation({ activeUniverseId, pool, poolOracleManagerDetails, reportingReady }: { activeUniverseId: bigint; pool: ListedSecurityPool | undefined; poolOracleManagerDetails: OracleManagerDetails | undefined; reportingReady: boolean }): LifecycleStagePresentation | undefined {
	if (pool === undefined) return undefined
	if (pool.universeId !== activeUniverseId) {
		return {
			availableActions: [],
			blockedActions: ['Vault actions', 'Trading', 'Reporting', 'Fork'],
			detail: 'This pool belongs to a different universe than the one currently selected in the app.',
			key: 'universe-mismatch',
			label: 'Universe Mismatch',
			tone: 'critical',
		}
	}
	if (pool.systemState !== 'operational') {
		return {
			availableActions: ['Fork workflow'],
			blockedActions: ['Routine operational workflows may be limited'],
			detail: 'This pool is no longer in routine operational mode. Fork and auction work is now the primary lifecycle.',
			key: 'fork-active',
			label: 'Fork Workflow Active',
			tone: 'warning',
		}
	}
	if (poolOracleManagerDetails?.pendingReportId !== undefined && poolOracleManagerDetails.pendingReportId > 0n) {
		return {
			availableActions: ['View pending report', 'Execute staged operation when price is valid'],
			blockedActions: ['Request another price'],
			detail: 'A price report is already pending for this pool. Resolve the pending report before requesting another one.',
			key: 'pending-report',
			label: 'Pending Oracle Report',
			tone: 'warning',
		}
	}
	if (reportingReady) {
		return {
			availableActions: ['Vaults', 'Trading', 'Reporting'],
			blockedActions: ['Fork actions until fork state exists'],
			detail: 'Reporting is unlocked for this pool and routine operations remain available.',
			key: 'reporting-open',
			label: 'Reporting Open',
			tone: 'success',
		}
	}
	return {
		availableActions: ['Vaults', 'Trading'],
		blockedActions: ['Reporting until market end'],
		detail: 'This pool is operational. Vault and trading workflows are available while reporting remains time-locked.',
		key: 'operational',
		label: 'Operational',
		tone: 'default',
	}
}
