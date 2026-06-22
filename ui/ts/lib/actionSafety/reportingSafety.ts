import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const REPORTING_ACTION_SAFETY_ENTRIES = [
	createReasonedActionSafetyEntry('reporting.triggerZoltarFork', 'Trigger Zoltar Fork', createReasonedActionSafetyFixtures('Trigger Zoltar Fork')),
	createReasonedActionSafetyEntry('reporting.reportOutcome', 'Report Outcome', createReasonedActionSafetyFixtures('Report Outcome')),
	createReasonedActionSafetyEntry('reporting.withdrawEscalation', 'Withdraw Escalation', createReasonedActionSafetyFixtures('Withdraw Escalation')),
] as const
