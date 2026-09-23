import type { Configuration } from './api-validation.ts'

/** Runtime log controls share the strategy form, but their saved values live outside strategy. */
export function strategyReviewRows(saved: Configuration, next: Record<string, string | number | boolean>) {
	return Object.entries(next).flatMap(([name, after]) => {
		let before = saved.strategy[name]
		if (name === 'logLookbackBlocks') before = saved.runtime.logLookbackBlocks
		if (name === 'historicalLogRecovery') before = saved.runtime.historicalLogRecovery
		if (String(before) === String(after)) return []
		if (name === 'logLookbackBlocks') return [{ label: 'log lookback blocks', before: `${before} blocks`, after: `${after} blocks` }]
		if (name === 'historicalLogRecovery') return [{ label: 'historical log recovery', before: before === true ? 'Enabled' : 'Disabled', after: after === true ? 'Enabled' : 'Disabled' }]
		return [{ label: name.replace(/([A-Z])/g, ' $1').toLowerCase(), before: String(before ?? '—'), after: String(after) }]
	})
}
