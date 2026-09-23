import { element } from '@zoltar/bot-shared/dashboard/dom'
import { formatDate, setBadge } from './dom.js'
import type { Snapshot, SubmissionHealth } from './dashboard.ts'

const rpcHealthStatus = element('rpc-health-status', HTMLSpanElement)
const rpcConfiguredTotal = element('rpc-configured-total', HTMLElement)
const rpcHealthyCount = element('rpc-healthy-count', HTMLElement)
const rpcRequiredQuorum = element('rpc-required-quorum', HTMLElement)
const rpcChainReadiness = element('rpc-chain-readiness', HTMLElement)
const rpcLastCheck = element('rpc-last-check', HTMLElement)
const rpcHealthRetryButton = element('rpc-health-retry-button', HTMLButtonElement)
const submissionHealthStatus = element('submission-health-status', HTMLSpanElement)
const submissionMode = element('submission-mode', HTMLElement)
const submissionHealthyCount = element('submission-healthy-count', HTMLElement)
const submissionRequiredThreshold = element('submission-required-threshold', HTMLElement)
const submissionFreshness = element('submission-freshness', HTMLElement)
const submissionSignerProof = element('submission-signer-proof', HTMLElement)
const submissionLastCheck = element('submission-last-check', HTMLElement)

export function renderRpcHealth(value: Snapshot) {
	rpcHealthRetryButton.classList.add('hidden')
	const health = value.rpcHealth
	if (health.status === 'ready') setBadge(rpcHealthStatus, 'Quorum ready', 'success')
	else if (health.status === 'degraded') setBadge(rpcHealthStatus, 'Quorum blocked', 'error')
	else if (health.status === 'not-checked') setBadge(rpcHealthStatus, 'Awaiting health check', 'warning')
	else setBadge(rpcHealthStatus, 'Health unavailable', 'warning')
	const configured = health.configuredReadEndpointCount
	rpcConfiguredTotal.textContent = configured === undefined ? '—' : `${configured.toString()} endpoint${configured === 1 ? '' : 's'}`
	const healthy = health.healthyReadEndpointCount
	if (healthy === undefined) rpcHealthyCount.textContent = '—'
	else rpcHealthyCount.textContent = configured === undefined ? healthy.toString() : `${healthy.toString()} of ${configured.toString()}`
	const quorum = health.requiredReadQuorum
	rpcRequiredQuorum.textContent = quorum === undefined ? '—' : `${quorum.toString()} endpoint${quorum === 1 ? '' : 's'}`
	const chain = value.chainId === undefined ? 'configured chain' : `chain ${String(value.chainId)}`
	if (health.chainReady === true) rpcChainReadiness.textContent = `Ready for ${chain}`
	else if (health.chainReady === false) rpcChainReadiness.textContent = `Not ready for ${chain}`
	else rpcChainReadiness.textContent = 'Not yet verified'
	rpcLastCheck.textContent = health.lastCheckedAt === undefined ? 'No completed check' : formatDate(health.lastCheckedAt)
}

export function renderUnavailableRpcHealth(previousResultIsStale: boolean) {
	rpcHealthRetryButton.classList.remove('hidden')
	setBadge(rpcHealthStatus, 'Health unavailable', 'warning')
	rpcConfiguredTotal.textContent = '—'
	rpcHealthyCount.textContent = '—'
	rpcRequiredQuorum.textContent = '—'
	rpcChainReadiness.textContent = 'Unavailable until state refresh succeeds'
	rpcLastCheck.textContent = previousResultIsStale ? 'Previous health result is stale' : 'No current health result'
}

function originCount(value: number | undefined) {
	return value === undefined ? '—' : `${value.toString()} origin${value === 1 ? '' : 's'}`
}

export function renderSubmissionHealth(health: SubmissionHealth) {
	if (health.status === 'ready') setBadge(submissionHealthStatus, 'Path ready', 'success')
	else if (health.status === 'degraded') setBadge(submissionHealthStatus, 'Path blocked', 'error')
	else if (health.status === 'stale') setBadge(submissionHealthStatus, 'Evidence stale', 'warning')
	else if (health.status === 'not-checked') setBadge(submissionHealthStatus, 'Awaiting path check', 'warning')
	else setBadge(submissionHealthStatus, 'Path not configured', 'neutral')
	if (health.mode === 'private') submissionMode.textContent = 'Private relay'
	else if (health.mode === 'public') submissionMode.textContent = 'Public RPC'
	else submissionMode.textContent = '—'
	const configured = health.configuredOriginCount
	const healthy = health.healthyOriginCount
	if (healthy === undefined) submissionHealthyCount.textContent = '—'
	else if (configured === undefined) submissionHealthyCount.textContent = originCount(healthy)
	else submissionHealthyCount.textContent = `${healthy.toString()} of ${configured.toString()} origins`
	submissionRequiredThreshold.textContent = originCount(health.requiredHealthyOriginCount)
	const checked = health.checkedOriginCount
	const fresh = health.freshOriginCount
	submissionFreshness.textContent = checked === undefined || fresh === undefined ? 'Not yet verified' : `${fresh.toString()} fresh of ${checked.toString()} checked`
	if (health.mode !== 'private') submissionSignerProof.textContent = 'Not required'
	else if (health.proofMatchesSigner === true) submissionSignerProof.textContent = 'Matches current signer'
	else if (health.proofMatchesSigner === false) submissionSignerProof.textContent = 'Does not match current signer'
	else submissionSignerProof.textContent = 'Not yet proven'
	submissionLastCheck.textContent = health.lastCheckedAt === undefined ? 'No completed check' : formatDate(health.lastCheckedAt)
}

export function renderUnavailableSubmissionHealth(previousResultIsStale: boolean) {
	setBadge(submissionHealthStatus, 'Path unavailable', 'warning')
	submissionMode.textContent = '—'
	submissionHealthyCount.textContent = '—'
	submissionRequiredThreshold.textContent = '—'
	submissionFreshness.textContent = previousResultIsStale ? 'Previous readiness is stale' : 'Unavailable until state refresh succeeds'
	submissionSignerProof.textContent = 'Not yet proven'
	submissionLastCheck.textContent = 'No current path result'
}
