import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { optionalRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import { node, setBadge } from './dom.ts'
import { put, requestJson } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import type { ReconcileUnknownMutation } from './dashboard-refresh.ts'

type Archive = {
	id: string
	active: boolean
	revision?: string | undefined
	profileId?: string | undefined
	network?: string | undefined
	chainId?: number | undefined
	wallet?: string | undefined
	status?: string | undefined
	error?: string | undefined
	addresses: { name: string; address: string }[]
}

function parseArchives(value: unknown): Archive[] {
	if (!Array.isArray(value)) throw new Error('Deployment archive response is invalid.')
	return value.map(entry => {
		const source = optionalRecord(entry)
		if (source === undefined || typeof source['id'] !== 'string' || typeof source['active'] !== 'boolean') throw new Error('Deployment archive response is invalid.')
		const string = (key: string) => (typeof source[key] === 'string' ? source[key] : undefined)
		return {
			id: source['id'],
			active: source['active'],
			revision: string('revision'),
			profileId: string('profileId'),
			network: string('network'),
			chainId: typeof source['chainId'] === 'number' ? source['chainId'] : undefined,
			wallet: string('wallet'),
			status: string('status'),
			error: string('error'),
			addresses: Array.isArray(source['addresses'])
				? source['addresses'].flatMap(value => {
						const address = optionalRecord(value)
						return typeof address?.['name'] === 'string' && typeof address['address'] === 'string' ? [{ name: address['name'], address: address['address'] }] : []
					})
				: [],
		}
	})
}

function element<T extends HTMLElement>(id: string, constructor: { new (): T }) {
	const value = document.getElementById(id)
	if (!(value instanceof constructor)) throw new Error(`Missing deployment archive control ${id}`)
	return value
}

export function createDeploymentArchives(state: DashboardState, reconcile: ReconcileUnknownMutation) {
	const list = element('deployment-archive-list', HTMLElement)
	const status = element('deployment-archive-status', HTMLElement)
	const retry = element('deployment-archive-retry', HTMLButtonElement)
	let signature = ''
	let busy = false
	let switchingTo: string | undefined
	let selectionOutcomeUnknown = false
	let inFlight: Promise<void> | undefined
	let available = false

	function updateControls() {
		status.parentElement?.toggleAttribute('hidden', status.textContent === '' && retry.hidden)
		const disabled =
			busy || switchingTo !== undefined || !available || !state.selectionControlsAvailable || state.configurationCommitIndeterminate || state.settingsMutationUnreconciled || state.snapshotStale || state.snapshot?.paused !== true || state.configuration?.paused !== true || state.snapshot.pendingTransactions.length > 0
		for (const button of list.querySelectorAll('button')) button.disabled = disabled
	}

	async function select(archive: Archive) {
		if (busy || switchingTo !== undefined || archive.revision === undefined) return
		const revision = state.configuration?.revision
		const phrase = `OPEN RECOVERY ${archive.id}`
		busy = true
		updateControls()
		try {
			if (
				!(await confirmOperatorAction({
					title: 'Open deployment recovery',
					description: 'Switch to this deployment paused with live execution off. Review Drain & Retire before enabling live execution and resuming recovery. The current deployment remains saved.',
					phrase,
					confirmLabel: 'Open recovery',
					evidence: [
						{ label: 'Deployment', value: archive.profileId ?? archive.id },
						{ label: 'Chain', value: `${archive.network ?? 'Unknown'} (${archive.chainId?.toString() ?? '?'})` },
						{ label: 'Signer', value: archive.wallet ?? 'Not configured' },
					],
				}))
			)
				return
			switchingTo = archive.id
			status.textContent = 'Switching deployment. Reconnecting…'
			updateControls()
			await put('/api/deployment-archive', { id: archive.id, archiveRevision: archive.revision, revision, confirmation: phrase }, 30_000)
		} catch (error) {
			const result = await reconcile(error, status, 'configuration and state', 'settings')
			selectionOutcomeUnknown = result.handled && !result.reconciled && !state.configurationCommitIndeterminate
			if (!result.handled || result.reconciled) {
				switchingTo = undefined
				status.textContent = error instanceof Error ? error.message : 'Could not open deployment recovery.'
			}
		} finally {
			busy = false
			updateControls()
		}
	}

	async function read() {
		try {
			const archives = parseArchives(await requestJson('/api/deployment-archives', 5_000))
			available = true
			retry.hidden = true
			if (switchingTo !== undefined && archives.some(archive => archive.id === switchingTo && archive.active)) {
				window.location.reload()
				return
			}
			if (selectionOutcomeUnknown && !busy && state.selectionControlsAvailable && !state.settingsMutationUnreconciled && !state.configurationCommitIndeterminate && archives.some(archive => archive.active)) {
				// Both runtime reads and the mutation-barrier archive read now identify the active owner.
				selectionOutcomeUnknown = false
				switchingTo = undefined
			}
			const nextSignature = JSON.stringify(archives)
			if (nextSignature !== signature) {
				signature = nextSignature
				list.replaceChildren(
					...archives.map((archive, index) => {
						const row = node('div', 'stack-row')
						const copy = node('div')
						copy.append(node('strong', undefined, archive.id === 'current' ? 'Current deployment' : `Archived deployment ${index.toString()}`))
						if (archive.chainId !== undefined) copy.append(node('small', undefined, `${archive.network ?? 'Unknown network'} · chain ${archive.chainId?.toString() ?? '?'} · ${(archive.status ?? 'unavailable').replaceAll('-', ' ')}`))
						if (archive.error !== undefined) copy.append(node('p', 'action-status', archive.error))
						const details = node('details')
						details.append(node('summary', undefined, 'Addresses and signer'))
						for (const [label, value] of [['Archive', archive.id], ['Profile', archive.profileId], ['Signer', archive.wallet], ...archive.addresses.map(address => [address.name, address.address])] as const) {
							if (value !== undefined) details.append(node('p', 'identifier-line', `${label}: ${value}`))
						}
						copy.append(details)
						row.append(copy)
						if (archive.active) {
							const badge = node('span')
							setBadge(badge, 'Selected', 'info')
							row.append(badge)
						} else if (archive.error === undefined && archive.revision !== undefined) {
							const button = node('button', 'secondary', 'Open recovery')
							button.type = 'button'
							button.setAttribute('aria-label', archive.id === 'current' ? 'Open recovery for the current deployment' : `Open recovery for archived deployment ${index.toString()}`)
							button.addEventListener('click', () => void select(archive))
							row.append(button)
						}
						return row
					}),
				)
			}
			if (!busy && switchingTo === undefined) {
				if (archives.every(archive => archive.id === 'current')) status.textContent = 'No archived deployments.'
				else if (state.snapshotStale) status.textContent = 'Current bot state is unavailable. Switching is disabled.'
				else if (state.snapshot?.paused !== true) status.textContent = 'Pause the bot to open another deployment.'
				else if (state.snapshot.pendingTransactions.length > 0) status.textContent = 'Resolve pending transactions before switching deployments.'
				else status.textContent = ''
			}
		} catch (error) {
			available = false
			retry.hidden = false
			status.textContent = error instanceof Error ? error.message : 'Deployment archives are unavailable.'
		} finally {
			updateControls()
		}
	}

	function refresh() {
		updateControls()
		if (document.body.dataset['page'] !== 'recovery') return
		if (inFlight !== undefined) return
		inFlight = read().finally(() => {
			inFlight = undefined
		})
	}
	retry.addEventListener('click', refresh)
	return { refresh, updateControls }
}
