import { assertNever } from './assert.js'
import type { ReportingOutcomeKey, SecurityPoolSystemState } from '../types/contracts.js'

export type SecurityPoolDisplayState = SecurityPoolSystemState | 'ended'

export function isSecurityPoolEnded({ questionOutcome, systemState }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined }) {
	return systemState === 'operational' && questionOutcome !== undefined && questionOutcome !== 'none'
}

export function getSecurityPoolDisplayState({ questionOutcome, systemState }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined }): SecurityPoolDisplayState | undefined {
	if (systemState === undefined) return undefined
	if (isSecurityPoolEnded({ questionOutcome, systemState })) return 'ended'
	return systemState
}

export function getSecurityPoolDisplayStateLabel(state: SecurityPoolDisplayState) {
	switch (state) {
		case 'operational':
			return 'Operational'
		case 'ended':
			return 'Ended'
		case 'poolForked':
			return 'Pool Forked'
		case 'forkMigration':
			return 'Fork Migration'
		case 'forkTruthAuction':
			return 'Truth Auction'
		default:
			return assertNever(state)
	}
}
