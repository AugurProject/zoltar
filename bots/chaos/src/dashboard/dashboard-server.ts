import { publicChaosState, publicChaosConfiguration, publicRpcHealth, publicSubmissionHealth, publicSubmissionHealthMaximumAgeSeconds } from './public-state.ts'
export { publicChaosState, publicChaosConfiguration } from './public-state.ts'
import type { ChaosDashboardController } from './dashboard-controller-contract.ts'
import { logDashboardFailure, publicDashboardError } from '@zoltar/bot-shared/dashboard/public-error'
import { boundedDashboardJson, dashboardJson as json, dashboardSecurityHeaders as securityHeaders } from '@zoltar/bot-shared/dashboard/security'
import { startBotDashboardServer } from '@zoltar/bot-shared/dashboard/server'
import { CONFIGURATION_COMMIT_INDETERMINATE } from '../runtime/configuration-commit.ts'
import { requiredLiveInventory } from '../runtime/live-readiness.ts'
import { readDashboardResource } from './dashboard-read-routes.ts'
import { operatorHeader } from './header.ts'
import { readDashboardConfiguration } from './configuration-document-route.ts'
import { mutationRoutes } from './mutation-routes.ts'
import { settingsPageMarkup } from './settings-page.ts'
import { record, stringField } from './public-fields.ts'
import { indeterminateConfigurationFailure, publicFailure } from './public-failure.ts'

export type { ChaosDashboardController } from './dashboard-controller-contract.ts'

type ChaosReadinessCheck = {
	detail?: string | undefined
	ready: boolean
}

function decimalAtto(value: unknown) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) return undefined
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

function inventoryReadyForLiveExecution(state: Record<string, unknown>, settings: Record<string, unknown>) {
	const inventory = record(state['inventory'])
	const strategy = record(settings['strategy'])
	if (inventory === undefined || strategy === undefined) return false
	const eth = typeof inventory['eth'] === 'string' && /^\d+$/.test(inventory['eth']) ? BigInt(inventory['eth']) : undefined
	const maximumEthPerOperationAttoEth = decimalAtto(strategy['maximumEthPerOperation'])
	const maximumGasCostAttoEth = decimalAtto(strategy['maximumGasCostEth'])
	const maximumRepPerOperationAttoRep = decimalAtto(strategy['maximumRepPerOperation'])
	const minimumEthReserveAttoEth = decimalAtto(strategy['minimumEthReserve'])
	const minimumRepReserveAttoRep = decimalAtto(strategy['minimumRepReserve'])
	if (eth === undefined || maximumEthPerOperationAttoEth === undefined || maximumGasCostAttoEth === undefined || maximumRepPerOperationAttoRep === undefined || minimumEthReserveAttoEth === undefined || minimumRepReserveAttoRep === undefined) {
		return false
	}
	const required = requiredLiveInventory({ maximumEthPerOperationAttoEth, maximumGasCostAttoEth, maximumRepPerOperationAttoRep, minimumEthReserveAttoEth, minimumRepReserveAttoRep })
	if (eth < required.ethAttoEth) return false
	if (!Array.isArray(inventory['rep'])) return false
	return inventory['rep'].some(candidate => {
		const balance = record(candidate)?.['balance']
		return typeof balance === 'string' && /^\d+$/.test(balance) && BigInt(balance) >= required.repAttoRep
	})
}

function readinessCheck(ready: boolean, detail?: string): ChaosReadinessCheck {
	return detail === undefined ? { ready } : { detail, ready }
}

export function publicChaosReadiness(stateValue: unknown, configurationValue: unknown, nowMilliseconds = Date.now()) {
	const state = record(stateValue)
	const configuration = record(configurationValue)
	const settings = record(configuration?.['settings']) ?? configuration
	if (state === undefined || settings === undefined) {
		return {
			blockers: ['runtime_snapshot_unavailable'],
			checkedAt: new Date(nowMilliseconds).toISOString(),
			checks: { storage: readinessCheck(false, 'Runtime or configuration snapshot is unavailable') },
			ready: false,
		}
	}
	const runtime = record(settings['runtime']) ?? settings
	const execute = runtime['execute'] === true
	const configured = settings['networkConfigured'] === true
	const paused = settings['paused'] === true || state['paused'] === true
	const safetyPaused = state['safetyPaused'] === true
	const signerReady = configuration?.['hasSigner'] === true || (settings['privateKey'] !== undefined && settings['privateKey'] !== null)
	const lastScanAt = typeof state['lastScanAt'] === 'string' && Number.isFinite(Date.parse(state['lastScanAt'])) ? state['lastScanAt'] : undefined
	const maximumScanAgeSeconds = publicSubmissionHealthMaximumAgeSeconds(configurationValue)
	const scanAgeSeconds = lastScanAt === undefined ? undefined : Math.max(0, Math.floor((nowMilliseconds - Date.parse(lastScanAt)) / 1_000))
	const topology = record(state['topology'])
	const scanReady = lastScanAt !== undefined && scanAgeSeconds !== undefined && scanAgeSeconds <= maximumScanAgeSeconds && topology?.['complete'] === true
	const pendingCount = Array.isArray(state['pendingTransactions']) ? state['pendingTransactions'].length : 0
	const activeWorkflows = Array.isArray(state['workflows'])
		? state['workflows'].filter(candidate => {
				const status = record(candidate)?.['status']
				return status === 'running' || status === 'waiting-continuation' || status === 'waiting-obligation' || status === 'waiting-transaction'
			}).length
		: 0
	const obligations = Array.isArray(state['obligations'])
		? state['obligations'].flatMap(candidate => {
				const obligation = record(candidate)
				return obligation === undefined ? [] : [obligation]
			})
		: []
	const failedObligationCount = obligations.filter(candidate => candidate['status'] === 'failed').length
	const blockedObligationCount = obligations.filter(candidate => candidate['status'] === 'blocked').length
	const pendingObligationCount = obligations.filter(candidate => candidate['status'] === 'pending' || candidate['status'] === 'executing').length
	const automaticRetryObligationCount = obligations.filter(candidate => candidate['status'] === 'deferred' && typeof candidate['notBefore'] === 'string').length
	const lifecyclePresenceBlocked = record(state['lifecyclePresenceBlocker']) !== undefined
	const recoveryReady = pendingCount === 0 && activeWorkflows === 0 && failedObligationCount === 0 && blockedObligationCount === 0 && pendingObligationCount === 0 && automaticRetryObligationCount === 0 && !lifecyclePresenceBlocked
	const inventoryReady = !execute || inventoryReadyForLiveExecution(state, settings)
	const rpcHealth = publicRpcHealth(state['rpcEndpointHealth'], configurationValue)
	const rpcReady = !configured || rpcHealth['chainReady'] === true
	const submissionHealth = publicSubmissionHealth(state['rpcEndpointHealth'], configurationValue, nowMilliseconds, maximumScanAgeSeconds)
	const submissionReady = !execute || submissionHealth['ready'] === true
	const status = stringField(state, 'status')
	const runtimeReady = state['error'] === undefined
	const storageReady = status !== 'error'
	let pauseDetail: string | undefined
	if (safetyPaused) pauseDetail = 'Durable safety pause is latched'
	else if (paused) pauseDetail = 'Operator is intentionally paused'
	let scanDetail: string | undefined
	if (!scanReady) scanDetail = lastScanAt === undefined ? 'No complete canonical scan is available' : 'Canonical scan is incomplete or stale'
	const checks: Record<string, ChaosReadinessCheck> = {
		configuration: readinessCheck(configured, configured ? undefined : 'Network deployment and connectivity are not configured'),
		inventory: readinessCheck(inventoryReady, inventoryReady ? undefined : 'Live inventory does not cover the ETH reserve, maximum ETH principal, maximum gas budget, REP reserve, and maximum REP principal'),
		paused: readinessCheck(!paused, pauseDetail),
		recovery: readinessCheck(recoveryReady, recoveryReady ? undefined : 'A transaction, workflow, lifecycle obligation, or lifecycle-presence guard prevents scheduled novelty'),
		rpc: readinessCheck(rpcReady, rpcReady ? undefined : 'Read RPC quorum is not currently healthy'),
		runtime: readinessCheck(runtimeReady, runtimeReady ? undefined : 'Runtime reports an active error that must be reconciled'),
		scan: readinessCheck(scanReady, scanDetail),
		signer: readinessCheck(!execute || signerReady, !execute || signerReady ? undefined : 'Live execution has no configured signer'),
		storage: readinessCheck(storageReady, storageReady ? 'Runtime and configuration snapshots are readable' : 'Runtime reports a storage or fatal error'),
		submission: readinessCheck(submissionReady, submissionReady ? undefined : 'Live submission endpoint evidence is missing, stale, failed, or below its required healthy-origin threshold'),
	}
	const blockers = Object.entries(checks)
		.filter(([, check]) => !check.ready)
		.map(([name]) => name)
	return {
		activeWorkflowCount: activeWorkflows,
		automaticRetryObligationCount,
		blockers,
		blockedObligationCount,
		checkedAt: new Date(nowMilliseconds).toISOString(),
		checks,
		failedObligationCount,
		lifecyclePresenceBlocked,
		maximumScanAgeSeconds,
		mode: execute ? 'live' : 'dry-run',
		paused,
		pendingObligationCount,
		pendingTransactionCount: pendingCount,
		ready: blockers.length === 0,
		safetyPaused,
		scanAgeSeconds,
	}
}

function chaosReadinessMetrics(readiness: ReturnType<typeof publicChaosReadiness>) {
	const readinessChecks = record(readiness.checks) ?? {}
	const lines = [
		'# HELP zoltar_chaos_ready Whether the chaos operator is ready for scheduled work.',
		'# TYPE zoltar_chaos_ready gauge',
		`zoltar_chaos_ready ${readiness.ready ? '1' : '0'}`,
		'# HELP zoltar_chaos_readiness_check Whether one named readiness condition is satisfied.',
		'# TYPE zoltar_chaos_readiness_check gauge',
		...['configuration', 'inventory', 'paused', 'recovery', 'rpc', 'runtime', 'scan', 'signer', 'storage', 'submission'].map(name => `zoltar_chaos_readiness_check{check="${name}"} ${record(readinessChecks[name])?.['ready'] === true ? '1' : '0'}`),
		'# HELP zoltar_chaos_paused Whether the operator is intentionally paused.',
		'# TYPE zoltar_chaos_paused gauge',
		`zoltar_chaos_paused ${readiness.paused === true ? '1' : '0'}`,
		'# HELP zoltar_chaos_safety_paused Whether the durable safety pause is latched.',
		'# TYPE zoltar_chaos_safety_paused gauge',
		`zoltar_chaos_safety_paused ${readiness.safetyPaused === true ? '1' : '0'}`,
		'# HELP zoltar_chaos_pending_transactions Transactions awaiting recovery or finality.',
		'# TYPE zoltar_chaos_pending_transactions gauge',
		`zoltar_chaos_pending_transactions ${readiness.pendingTransactionCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_active_workflows Durable workflows that have not reached a terminal state.',
		'# TYPE zoltar_chaos_active_workflows gauge',
		`zoltar_chaos_active_workflows ${readiness.activeWorkflowCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_pending_obligations Lifecycle obligations that are pending or executing.',
		'# TYPE zoltar_chaos_pending_obligations gauge',
		`zoltar_chaos_pending_obligations ${readiness.pendingObligationCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_automatic_retry_obligations Lifecycle obligations waiting for bounded automatic retry.',
		'# TYPE zoltar_chaos_automatic_retry_obligations gauge',
		`zoltar_chaos_automatic_retry_obligations ${readiness.automaticRetryObligationCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_blocked_obligations Lifecycle obligations blocked on operator or protocol recovery.',
		'# TYPE zoltar_chaos_blocked_obligations gauge',
		`zoltar_chaos_blocked_obligations ${readiness.blockedObligationCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_failed_obligations Lifecycle obligations in a failed state.',
		'# TYPE zoltar_chaos_failed_obligations gauge',
		`zoltar_chaos_failed_obligations ${readiness.failedObligationCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_lifecycle_presence_blocker Whether unrepresented canonical lifecycle presence blocks novelty.',
		'# TYPE zoltar_chaos_lifecycle_presence_blocker gauge',
		`zoltar_chaos_lifecycle_presence_blocker ${readiness.lifecyclePresenceBlocked === true ? '1' : '0'}`,
		'# HELP zoltar_chaos_scan_age_seconds Age of the last complete canonical scan in seconds.',
		'# TYPE zoltar_chaos_scan_age_seconds gauge',
		`zoltar_chaos_scan_age_seconds ${readiness.scanAgeSeconds?.toString() ?? 'NaN'}`,
	]
	return `${lines.join('\n')}\n`
}

export function startDashboardServer(port: number, controller: ChaosDashboardController) {
	const directory = import.meta.dir
	let configurationCommitIndeterminate = false
	let mutationBarrier = Promise.resolve()
	const enqueueMutation = (operation: () => Promise<Response>) => {
		const predecessor = mutationBarrier
		let release: () => void = () => undefined
		mutationBarrier = new Promise<void>(resolve => {
			release = resolve
		})
		return (async () => {
			await predecessor
			try {
				return await operation()
			} finally {
				release()
			}
		})()
	}
	return startBotDashboardServer({
		directory,
		exposure: { passwordlessExposureError: 'Non-loopback chaos dashboard exposure is disabled; bind to 127.0.0.1 or publish a 0.0.0.0 container listener through a host-loopback-only port' },
		hostname: controller.hostname,
		loopbackPublished: controller.loopbackPublished,
		pages: ['overview', 'catalog', 'ecosystem', 'workflows', 'recovery', 'settings'],
		pageSlots: [
			['<!-- operator-header -->', operatorHeader],
			['<!-- settings-page -->', settingsPageMarkup],
		],
		port,
		route: async (request, { url }) => {
			if (request.method === 'GET') {
				if (url.pathname === '/readyz' || url.pathname === '/metrics') {
					try {
						await mutationBarrier
						const [state, configuration] = await Promise.all([controller.getState(), controller.getConfiguration()])
						const readiness = publicChaosReadiness(state, configuration)
						if (url.pathname === '/metrics') {
							return new Response(chaosReadinessMetrics(readiness), { headers: securityHeaders('text/plain; version=0.0.4; charset=utf-8'), status: 200 })
						}
						return json(readiness, readiness.ready ? 200 : 503)
					} catch (error) {
						logDashboardFailure('chaos', 'readiness-read', error)
						return json({ blockers: ['runtime_snapshot_unavailable'], ready: false }, 503)
					}
				}
				const resource = await readDashboardResource(url.pathname, directory, controller, mutationBarrier)
				if (resource !== undefined) return resource
				if (url.pathname === '/api/state') {
					try {
						await mutationBarrier
						const [stateResult, configurationResult] = await Promise.allSettled([controller.getState(), controller.getConfiguration()])
						if (stateResult.status === 'rejected') throw stateResult.reason
						if (configurationResult.status === 'rejected') logDashboardFailure('chaos', 'configuration-read-for-health', 'configuration unavailable')
						return json(publicChaosState(stateResult.value, configurationResult.status === 'fulfilled' ? configurationResult.value : undefined))
					} catch (error) {
						return publicDashboardError('chaos', error, 503, 'state-read', 'Dashboard state is temporarily unavailable. Automatic recovery remains active.')
					}
				}
				if (url.pathname === '/api/configuration-document' && controller.getConfigurationDocument !== undefined) return readDashboardConfiguration(controller.getConfigurationDocument, mutationBarrier, true)
				if (url.pathname === '/api/configuration')
					return readDashboardConfiguration(
						async () => ({ ...publicChaosConfiguration(await controller.getConfiguration()), configurationCommitIndeterminate, completeConfigurationAvailable: controller.getConfigurationDocument !== undefined && controller.setConfigurationDocument !== undefined }),
						mutationBarrier,
						false,
					)
			}
			if (request.method === 'PUT') {
				// The shared server has already rejected cross-origin non-GET requests.
				const handler = mutationRoutes(controller).get(url.pathname)
				if (handler !== undefined) {
					return await enqueueMutation(async () => {
						if (configurationCommitIndeterminate) return indeterminateConfigurationFailure()
						try {
							const value = await boundedDashboardJson(request)
							const result = await handler(value)
							return json(url.pathname === '/api/operation' ? result : { saved: true })
						} catch (error) {
							if (error instanceof Error && error.name === CONFIGURATION_COMMIT_INDETERMINATE) configurationCommitIndeterminate = true
							return publicFailure(`mutation:${url.pathname}`, error)
						}
					})
				}
			}
			return undefined
		},
	})
}
