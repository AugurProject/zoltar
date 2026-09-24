import type { NetworkRecord } from './browser-types.ts'
import { exactNumber } from './format.ts'
import { indexerConnectionStatus, indexerHeadFreshness, indexerLagLabel } from './live-update.ts'

export const networkIndicator = (input: {
	readonly network?: NetworkRecord
	readonly demo: boolean
	readonly streamState: 'closed' | 'connecting' | 'open'
	readonly failed: boolean
	readonly streamHasOpened: boolean
	readonly now: number
	readonly freshnessThresholdMs: number
}): { tone: string; label: string; title: string } => {
	const { network } = input
	const stale = network !== undefined && (indexerHeadFreshness(network, input.now).stale || !network.last_success_at || input.now - new Date(network.last_success_at).getTime() > input.freshnessThresholdMs)
	const title = network === undefined ? 'Network status unavailable' : `${network.name} · ${network.phase} · indexed block #${exactNumber(network.indexed_block)} · observed block #${exactNumber(network.observed_block)} · ${indexerLagLabel(network)}`
	if (input.demo) {
		if (input.failed) return { tone: 'error', label: 'Demo · unavailable', title: 'Demo fixture network status unavailable' }
		if (network === undefined) return { tone: 'live', label: 'Demo · loading', title: 'Demo fixture status loading' }
		const phase = stale ? 'stale' : network.phase
		const displayPhase = phase === 'backfilling' ? 'syncing' : phase
		return {
			tone: stale ? 'error' : 'live',
			label: `Demo · ${displayPhase}${network.indexed_block ? ` · #${exactNumber(network.indexed_block)}` : ''}`,
			title: `Demo fixture · ${stale ? 'stale · ' : ''}${title}`,
		}
	}
	const status = indexerConnectionStatus(network, input.streamState, input.failed, input.streamHasOpened)
	return {
		tone: stale ? 'error' : status.tone,
		label: network?.indexed_block ? `${stale ? 'Stale' : status.label} · #${exactNumber(network.indexed_block)}` : status.label,
		title,
	}
}
