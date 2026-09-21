import { element, setText } from './dom.ts'

/** One prerequisite in a readiness checklist. Advisory rows inform without blocking: the bot tolerates them, so they are not prerequisites. */
export type ReadinessRow = { advisory?: true; detail: string; label: string; ready: boolean }

/** The screen-reader status beside each row; an unmet advisory row is optional rather than a missing prerequisite. */
function readinessStatus(row: ReadinessRow) {
	if (row.ready) return ' ready'
	return row.advisory ? ' optional' : ' missing'
}

function readinessItem(row: ReadinessRow) {
	const item = document.createElement('li')
	item.dataset['ready'] = row.ready ? 'true' : 'false'
	if (row.advisory) item.dataset['advisory'] = 'true'
	const mark = document.createElement('span')
	mark.className = 'readiness-mark'
	mark.setAttribute('aria-hidden', 'true')
	mark.textContent = row.ready ? '✓' : '○'
	const label = document.createElement('span')
	label.className = 'readiness-label'
	label.textContent = row.label
	const detail = document.createElement('strong')
	// An unmet advisory row says so in text, not only in colour.
	detail.textContent = row.advisory && !row.ready ? `${row.detail} · optional` : row.detail
	const status = document.createElement('span')
	status.className = 'visually-hidden'
	status.textContent = readinessStatus(row)
	item.append(mark, label, detail, status)
	return item
}

function renderReadinessList(list: HTMLUListElement, rows: readonly ReadinessRow[]) {
	list.replaceChildren(...rows.map(readinessItem))
}

/** Every required row holds; advisory rows never block. */
function readinessSatisfied(rows: readonly ReadinessRow[]) {
	return rows.every(row => row.ready || row.advisory === true)
}

export type ExecutionModeState = {
	/** The mode saved in the operator file, which may differ from the running one while a change waits for the bot. */
	saved: boolean
	/** The mode the running bot reports. */
	live: boolean
	/** A saved change is waiting for the scan boundary. */
	queued: boolean
}

function executionModeSummary({ saved, live, queued }: ExecutionModeState, ready: boolean) {
	if (saved && queued) return 'Armed · bot paused'
	if (live) return queued ? 'Live · dry run at the next scan' : 'Live'
	return ready ? 'Dry run · ready to go live' : 'Dry run · prerequisites missing'
}

/**
 * The Execution mode panel: live execution is gated on the same prerequisites the bot enforces when it is armed, so the
 * switch cannot be flipped on until every required row is satisfied; switching a live operator back to dry run is
 * always allowed. Expects the markup from `executionModePanel`.
 */
export function renderExecutionMode(rows: readonly ReadinessRow[], mode: ExecutionModeState) {
	renderReadinessList(element('execution-checklist', HTMLUListElement), rows)
	const ready = readinessSatisfied(rows)
	setText('execution-mode-summary', executionModeSummary(mode, ready))
	const toggle = element('execution-enabled', HTMLInputElement)
	toggle.disabled = !mode.saved && !ready
	toggle.setAttribute('aria-describedby', 'execution-checklist')
	return ready
}
