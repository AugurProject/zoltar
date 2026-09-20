import type { PublicOperatorSnapshot } from '#state/operator-state'
import type { DashboardDeployment } from './api-validation.ts'
import { element, setText, shorten } from './dom.js'

/** The parts of the loaded configuration the readiness checklist needs beside the live snapshot. */
export type GoLiveConfiguration = {
	deployment: DashboardDeployment
	execute: boolean
	relayUrls: readonly string[]
	rpcQuorum: 1 | 2
	submissionMode: 'private' | 'public'
}

type ReadinessRow = { detail: string; label: string; ready: boolean }

function readinessRows(snapshot: PublicOperatorSnapshot, configuration: GoLiveConfiguration): ReadinessRow[] {
	const signer = snapshot.queuedWallet === null ? undefined : (snapshot.queuedWallet ?? snapshot.wallet)
	const requiredQuorumRpcs = configuration.rpcQuorum === 2 ? 2 : 0
	const quorumRpcs = configuration.deployment.quorumRpcUrls.length
	const venueEnabled = configuration.deployment.uniswapV3Enabled || configuration.deployment.uniswapV4Enabled || (configuration.deployment.uniswapV2Enabled && snapshot.network === 'mainnet')
	const relays = configuration.relayUrls.length
	return [
		{ detail: signer === undefined ? 'Set one under Execution wallet' : shorten(signer), label: 'Execution signer', ready: signer !== undefined },
		{ detail: `${quorumRpcs.toString()} configured · ${requiredQuorumRpcs.toString()} required`, label: 'Independent quorum RPCs', ready: quorumRpcs >= requiredQuorumRpcs },
		{ detail: venueEnabled ? 'Enabled' : 'Enable a Uniswap version under Venues and executor', label: 'Trading venue', ready: venueEnabled },
		{ detail: configuration.submissionMode === 'private' ? `Private · ${relays.toString()} relay${relays === 1 ? '' : 's'}` : 'Public mempool', label: 'Delivery', ready: configuration.submissionMode === 'public' || relays > 0 },
	]
}

function readinessItem(row: ReadinessRow) {
	const item = document.createElement('li')
	item.dataset['ready'] = row.ready ? 'true' : 'false'
	const mark = document.createElement('span')
	mark.className = 'readiness-mark'
	mark.setAttribute('aria-hidden', 'true')
	mark.textContent = row.ready ? '✓' : '○'
	const label = document.createElement('span')
	label.className = 'readiness-label'
	label.textContent = row.label
	const detail = document.createElement('strong')
	detail.textContent = row.detail
	const status = document.createElement('span')
	status.className = 'visually-hidden'
	status.textContent = row.ready ? ' ready' : ' missing'
	item.append(mark, label, detail, status)
	return item
}

function executionSummary(saved: boolean, live: boolean, queued: boolean, ready: boolean) {
	if (saved && queued) return 'Armed · bot paused'
	if (live) return queued ? 'Live · dry run at the next scan' : 'Live'
	return ready ? 'Dry run · ready to go live' : 'Dry run · prerequisites missing'
}

/**
 * Live execution is gated on the same prerequisites the bot enforces when it is armed, so the switch cannot be flipped on
 * until every row is satisfied; switching a live operator back to dry run is always allowed.
 */
export function renderGoLive(snapshot: PublicOperatorSnapshot, configuration: GoLiveConfiguration) {
	const rows = readinessRows(snapshot, configuration)
	element('execution-checklist', HTMLUListElement).replaceChildren(...rows.map(readinessItem))
	const ready = rows.every(row => row.ready)
	// The snapshot keeps reporting live until the boundary, so the saved mode decides whether a queued change arms or disarms.
	setText('execution-mode-summary', executionSummary(configuration.execute, snapshot.execute, snapshot.queuedSettings.includes('execution'), ready))
	const toggle = element('execution-enabled', HTMLInputElement)
	toggle.disabled = !configuration.execute && !ready
	toggle.setAttribute('aria-describedby', 'execution-checklist')
}
