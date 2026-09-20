import type { DeploymentRole } from '#config/deployment-roles'
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

/** Advisory rows inform without blocking the switch: the bot tolerates them while armed, so they are not prerequisites. */
type ReadinessRow = { advisory?: true; detail: string; label: string; ready: boolean }

function executorRow(snapshot: PublicOperatorSnapshot): ReadinessRow {
	const inspected = snapshot.canonicalDeployments
	if (inspected === undefined) return { detail: 'Waiting for the first scan', label: 'Executor', ready: false }
	if (inspected.executor === 'deployed') return { detail: snapshot.executor === undefined ? 'Deployed' : shorten(snapshot.executor), label: 'Executor', ready: true }
	return { detail: inspected.executor === 'missing' ? 'Deploy it under Venues and executor' : 'Bytecode differs from the bundled executor', label: 'Executor', ready: false }
}

/** Display names for the deployment roles the bot inspects. */
const contractRoleNames: Record<DeploymentRole, string> = {
	'open-oracle': 'OpenOracle',
	'security-pool-factory': 'security-pool factory',
	'uniswap-factory': 'Uniswap V3 factory',
	'uniswap-quoter': 'Uniswap V3 quoter',
	'uniswap-router': 'Uniswap V3 router',
	'uniswap-v2-router': 'Uniswap V2 router',
	'uniswap-v4-pool-manager': 'Uniswap V4 pool manager',
	'uniswap-v4-quoter': 'Uniswap V4 quoter',
	weth: 'WETH',
}

function canonicalContractsRow(snapshot: PublicOperatorSnapshot): ReadinessRow {
	const inspected = snapshot.canonicalDeployments
	if (inspected === undefined) return { detail: 'Waiting for the first scan', label: 'Canonical contracts', ready: false }
	const missing = inspected.contracts.filter(contract => !contract.deployed)
	if (missing.length === 0) return { detail: `${inspected.contracts.length.toString()} verified`, label: 'Canonical contracts', ready: true }
	return { detail: `Missing ${missing.map(contract => contractRoleNames[contract.role]).join(', ')}`, label: 'Canonical contracts', ready: false }
}

function readinessRows(snapshot: PublicOperatorSnapshot, configuration: GoLiveConfiguration): ReadinessRow[] {
	const signer = snapshot.queuedWallet === null ? undefined : (snapshot.queuedWallet ?? snapshot.wallet)
	const requiredQuorumRpcs = configuration.rpcQuorum === 2 ? 2 : 0
	const quorumRpcs = configuration.deployment.quorumRpcUrls.length
	const venueEnabled = configuration.deployment.uniswapV3Enabled || configuration.deployment.uniswapV4Enabled || (configuration.deployment.uniswapV2Enabled && snapshot.network === 'mainnet')
	const relays = configuration.relayUrls.length
	const coordinators = snapshot.coordinatorAddresses.length
	return [
		{ detail: signer === undefined ? 'Set one under Execution wallet' : shorten(signer), label: 'Execution signer', ready: signer !== undefined },
		{ detail: `${quorumRpcs.toString()} configured · ${requiredQuorumRpcs.toString()} required`, label: 'Independent quorum RPCs', ready: quorumRpcs >= requiredQuorumRpcs },
		{ detail: venueEnabled ? 'Enabled' : 'Enable a Uniswap version under Venues and executor', label: 'Trading venue', ready: venueEnabled },
		executorRow(snapshot),
		canonicalContractsRow(snapshot),
		{ detail: configuration.submissionMode === 'private' ? `Private · ${relays.toString()} relay${relays === 1 ? '' : 's'}` : 'Public mempool', label: 'Delivery', ready: configuration.submissionMode === 'public' || relays > 0 },
		{ advisory: true, detail: coordinators === 0 ? 'None discovered · not required to arm' : `${coordinators.toString()} discovered`, label: 'Pool coordinators', ready: coordinators > 0 },
	]
}

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
	detail.textContent = row.detail
	const status = document.createElement('span')
	status.className = 'visually-hidden'
	status.textContent = readinessStatus(row)
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
	const ready = rows.every(row => row.ready || row.advisory === true)
	// The snapshot keeps reporting live until the boundary, so the saved mode decides whether a queued change arms or disarms.
	setText('execution-mode-summary', executionSummary(configuration.execute, snapshot.execute, snapshot.queuedSettings.includes('execution'), ready))
	const toggle = element('execution-enabled', HTMLInputElement)
	toggle.disabled = !configuration.execute && !ready
	toggle.setAttribute('aria-describedby', 'execution-checklist')
}
