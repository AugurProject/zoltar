import type { NetworkRecord } from './browser-types.ts'
import { exactNumber } from './format.ts'
import { type IndexerProgressSample, indexerConnectionStatus, indexerHeadFreshness, indexerLagLabel, indexerProgressEstimate, indexerTimeLagLabel } from './network-freshness.ts'

export const networkIndicator = (input: {
	readonly network?: NetworkRecord | undefined
	readonly demo: boolean
	readonly streamState: 'closed' | 'connecting' | 'open'
	readonly failed: boolean
	readonly streamHasOpened: boolean
	readonly now: number
	readonly freshnessThresholdMs: number
	readonly progressSample?: IndexerProgressSample | undefined
}): { tone: string; label: string; statusLabel: string; blockLabel: string; title: string } => {
	const { network } = input
	const stale = network !== undefined && (indexerHeadFreshness(network, input.now).stale || !network.last_success_at || input.now - new Date(network.last_success_at).getTime() > input.freshnessThresholdMs)
	const title = network === undefined ? 'Network status unavailable' : `${network.name} · ${network.phase} · indexed block #${exactNumber(network.indexed_block)} · observed block #${exactNumber(network.observed_block)} · ${indexerLagLabel(network)}`
	if (input.demo) {
		if (input.failed) return { tone: 'error', label: 'Demo · unavailable', statusLabel: 'Demo · unavailable', blockLabel: '', title: 'Demo fixture network status unavailable' }
		if (network === undefined) return { tone: 'live', label: 'Demo · loading', statusLabel: 'Demo · loading', blockLabel: '', title: 'Demo fixture status loading' }
		const phase = stale ? 'stale' : network.phase
		const displayPhase = phase === 'backfilling' ? 'syncing' : phase
		const statusLabel = `Demo · ${displayPhase}`
		const blockLabel = network.indexed_block ? ` · #${exactNumber(network.indexed_block)}` : ''
		return {
			tone: stale ? 'error' : 'live',
			label: `${statusLabel}${blockLabel}`,
			statusLabel,
			blockLabel,
			title: `Demo fixture · ${stale ? 'stale · ' : ''}${title}`,
		}
	}
	const status = indexerConnectionStatus(network, input.streamState, input.failed, input.streamHasOpened)
	// Per-block progress is reported apart from the status that assistive technology announces.
	const statusLabel = network?.indexed_block && stale ? 'Stale' : status.label
	let blockLabel = network?.indexed_block ? ` · #${exactNumber(network.indexed_block)}` : ''
	if (network?.phase === 'backfilling' && network.indexed_block) {
		const progress = indexerProgressEstimate(network, input.progressSample, input.now)
		const details = [indexerTimeLagLabel(network, input.now), indexerLagLabel(network), progress.percentage === undefined ? undefined : `${progress.percentage}% complete`, progress.eta]
		blockLabel = ` · ${details.filter(detail => detail !== undefined).join(' · ')}`
	}
	return {
		tone: stale ? 'error' : status.tone,
		label: `${statusLabel}${blockLabel}`,
		statusLabel,
		blockLabel,
		title,
	}
}
