import { h, render } from 'preact'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { useEffect, useState } from 'preact/hooks'
import { snapshotFreshness } from './polling.ts'

export type OperatorHealth = {
	mode: 'Dry run' | 'Live armed'
	lastScanAt?: string | undefined
	capitalAtRisk: string
	recoveryItems: number
	lastAction: string
	paused: boolean
	stale: boolean
	scanStaleAfterMilliseconds?: number | undefined
	stateReceivedAt?: number | undefined
}

function healthSlot(label: string, value: string) {
	return h('div', { class: 'operator-health-slot' }, h('dt', null, label), h('dd', null, value))
}

/** Shared age ticker for all dashboard polls; a retained snapshot becomes visibly stale. */
function useSnapshotFreshness(lastScanAt: string | undefined, stateReceivedAt: number, pollFailed: boolean, scanStaleAfterMilliseconds?: number) {
	const [now, setNow] = useState(Date.now())
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1_000)
		return () => window.clearInterval(timer)
	}, [])
	return snapshotFreshness(lastScanAt, stateReceivedAt, pollFailed, now, 30_000, scanStaleAfterMilliseconds)
}

function Panel({ health, stateReceivedAt }: { health: OperatorHealth; stateReceivedAt: number }) {
	const freshness = useSnapshotFreshness(health.lastScanAt, stateReceivedAt, health.stale, health.scanStaleAfterMilliseconds)
	const modeTone = health.mode === 'Live armed' ? 'warning' : 'muted'
	return h(
		'section',
		{ class: 'operator-health', 'aria-label': 'Operator health' },
		h(
			'dl',
			{ class: 'operator-health-grid' },
			h('div', { class: 'operator-health-slot' }, h('dt', null, 'Mode'), h('dd', null, h(Badge, { tone: modeTone, children: health.mode }), health.paused ? h(Badge, { tone: 'warning', children: 'Paused' }) : undefined)),
			healthSlot('Last successful scan', freshness.age),
			healthSlot('Capital at risk / limit', health.capitalAtRisk),
			healthSlot('Open recovery items', health.recoveryItems.toString()),
			healthSlot('Last action', health.lastAction),
		),
		freshness.stale ? h('p', { class: 'operator-health-stale', role: 'status' }, health.stale ? 'Dashboard state is stale; retrying.' : 'Last successful scan is overdue.') : undefined,
	)
}

export function renderOperatorHealth(target: HTMLElement, health: OperatorHealth) {
	render(h(Panel, { health, stateReceivedAt: health.stateReceivedAt ?? Date.now() }), target)
}
