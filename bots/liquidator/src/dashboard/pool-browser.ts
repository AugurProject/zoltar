import { clearPoolDate, renderPoolDate } from './pool-dates.ts'
import { botVaultState, poolStatusText, publicFailure, type MonitoredPool } from './pool-presentation.ts'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'
import type { CatalogPool, PoolCatalogPage } from '../monitoring/pool-catalog.ts'

type Context = { chainId: number | undefined; enabled: boolean; selected: ReadonlySet<string>; approved: ReadonlySet<string>; monitored: readonly MonitoredPool[] }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
	const result = document.createElement(tag)
	result.textContent = text
	result.className = className
	return result
}

export function createPoolBrowser(root: HTMLElement, save: (address: string, supported: boolean, chainId: number) => Promise<void>) {
	let context: Context = { chainId: undefined, enabled: false, selected: new Set(), approved: new Set(), monitored: [] }
	let scope: 'all' | 'monitored' = 'all'
	let page = 0
	let epoch = 0
	let data: PoolCatalogPage | undefined
	let loading = false
	let saving = false
	let error: string | undefined
	let searchError: string | undefined
	let renderedKey: string | undefined
	let renderedChain: number | undefined
	const expanded = new Set<string>()
	let dateFields: { root: HTMLElement; timestamp: string | undefined }[] = []
	const heading = node('div', '', 'section-heading')
	heading.append(node('h2', 'Pools'))
	const navigation = node('div', '', 'catalog-pagination')
	const previous = node('button', 'Previous', 'secondary')
	const next = node('button', 'Next', 'secondary')
	const summary = node('span', '', 'muted')
	navigation.append(previous, summary, next)
	heading.append(navigation)
	const status = node('p', '', 'muted')
	status.setAttribute('role', 'status')
	status.setAttribute('aria-atomic', 'true')
	const refreshButton = node('button', 'Refresh', 'secondary')
	const snapshot = node('div', '', 'catalog-snapshot muted')
	const snapshotDate = node('span')
	snapshot.append(node('span', 'Catalog snapshot'), snapshotDate)
	const toolbar = node('div', '', 'catalog-toolbar')
	toolbar.append(refreshButton, snapshot)
	const tabs = node('div', '', 'pool-tabs')
	tabs.setAttribute('role', 'tablist')
	tabs.setAttribute('aria-label', 'Pool scope')
	const monitoredTab = node('button', 'Monitored pools', 'secondary')
	const allTab = node('button', 'All pools', 'secondary')
	for (const [tab, id] of [
		[monitoredTab, 'monitored'],
		[allTab, 'all'],
	] as const) {
		tab.id = `pool-tab-${id}`
		tab.setAttribute('role', 'tab')
		tab.setAttribute('aria-controls', 'pool-results')
		tab.addEventListener('click', () => selectScope(id))
		tab.addEventListener('keydown', event => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
			event.preventDefault()
			let target = tab === allTab ? monitoredTab : allTab
			if (event.key === 'Home') target = monitoredTab
			if (event.key === 'End') target = allTab
			target.click()
			target.focus()
		})
	}
	tabs.append(monitoredTab, allTab)
	const searchLabel = node('label', 'Search by pool address', 'catalog-search')
	const search = node('input')
	search.type = 'search'
	search.placeholder = '0x…'
	search.autocomplete = 'off'
	search.spellcheck = false
	searchLabel.append(search)
	const cards = node('div', '', 'pool-catalog-list')
	const panel = node('div')
	panel.id = 'pool-results'
	panel.setAttribute('role', 'tabpanel')
	panel.append(searchLabel, toolbar, status, cards)
	root.append(heading, tabs, panel)

	function listing() {
		if (scope === 'all') return data
		const monitored = context.chainId === undefined || searchError !== undefined ? [] : context.monitored.filter(pool => search.value.trim() === '' || pool.address.toLowerCase() === search.value.trim().toLowerCase())
		const pools: CatalogPool[] = monitored.slice(page * 12, (page + 1) * 12).map(pool => ({
			...data?.pools.find(candidate => candidate.address.toLowerCase() === pool.address.toLowerCase()),
			address: pool.address,
			questionId: pool.questionId,
			universeId: pool.universeId,
			multiplierBps: pool.multiplierBps,
			...(pool.parent === undefined ? {} : { parent: pool.parent }),
		}))
		return { pools, total: String(monitored.length), pageCount: String(Math.ceil(monitored.length / 12)) }
	}

	function statusMessage() {
		if (context.chainId === undefined) return 'Configure the chain and RPC endpoints in Settings to browse pools.'
		if (searchError !== undefined) return searchError
		if (error !== undefined) return error
		if (saving) return 'Saving pool selection…'
		if (loading) return search.value.trim() === '' ? 'Discovering pools…' : 'Searching pools…'
		if (listing()?.total === '0') {
			if (scope === 'monitored') return search.value.trim() === '' ? 'No monitored pools yet. Find a pool in All pools to add support.' : 'No matching monitored pool.'
			return search.value.trim() === '' ? 'No pools have been deployed on this chain.' : 'No matching pool on this chain.'
		}
		if (scope === 'all' && data === undefined) return 'Waiting for connection…'
		return ''
	}

	function render() {
		const key = JSON.stringify([context.chainId, context.enabled, [...context.selected], [...context.approved], data, scope, context.monitored, page, loading, saving, error, search.value, searchError])
		const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
		renderPoolDate(snapshotDate, data?.snapshotTimestamp, currentTimestamp)
		if (key === renderedKey) {
			for (const field of dateFields) renderPoolDate(field.root, field.timestamp, currentTimestamp)
			return
		}
		renderedKey = key
		const focusedAction = document.activeElement instanceof HTMLButtonElement && cards.contains(document.activeElement) ? document.activeElement.getAttribute('data-record-key') : undefined
		if (renderedChain !== context.chainId) expanded.clear()
		else {
			for (const details of cards.querySelectorAll<HTMLDetailsElement>('details[data-pool-address]')) {
				const address = details.dataset['poolAddress']
				if (address === undefined) continue
				if (details.open) expanded.add(address)
				else expanded.delete(address)
			}
		}
		renderedChain = context.chainId
		const monitoredAddresses = new Set(context.monitored.map(pool => pool.address.toLowerCase()))
		for (const address of expanded) if (!monitoredAddresses.has(address)) expanded.delete(address)
		for (const [tab, id] of [
			[monitoredTab, 'monitored'],
			[allTab, 'all'],
		] as const) {
			tab.setAttribute('aria-selected', String(scope === id))
			tab.tabIndex = scope === id ? 0 : -1
			tab.disabled = saving
		}
		panel.setAttribute('aria-labelledby', `pool-tab-${scope}`)
		search.disabled = !context.enabled || saving
		search.setAttribute('aria-invalid', String(searchError !== undefined))
		navigation.hidden = search.value.trim() !== ''
		const visible = listing()
		refreshButton.disabled = loading || saving || !context.enabled || searchError !== undefined
		previous.disabled = loading || saving || !context.enabled || page === 0
		next.disabled = loading || saving || !context.enabled || visible === undefined || BigInt(page + 1) >= BigInt(visible.pageCount)
		summary.textContent = visible === undefined ? '' : `${visible.total} pools · Page ${page + 1} of ${visible.pageCount === '0' ? '1' : visible.pageCount}`
		const failed = error !== undefined || searchError !== undefined
		status.className = failed ? 'notice error' : 'muted'
		status.setAttribute('role', failed ? 'alert' : 'status')
		status.setAttribute('aria-live', failed ? 'assertive' : 'polite')
		const message = statusMessage()
		if (status.textContent !== message) status.textContent = message
		status.hidden = status.textContent === ''
		cards.setAttribute('aria-busy', String(loading))
		for (const field of dateFields) clearPoolDate(field.root)
		dateFields = []
		cards.replaceChildren(
			...(visible?.pools ?? []).map(pool => {
				// Match Statoblast's ComparisonRecord: identity and action, metric grid, then details.
				const card = node('article', '', 'catalog-record')
				const header = node('header', '', 'catalog-record-header')
				const title = node('h3', `Question ${pool.questionId}`)
				const supported = context.selected.has(pool.address.toLowerCase())
				const action = node('button', supported ? 'Remove from supported' : 'Add to supported', supported ? 'secondary' : '')
				action.disabled = !context.enabled || loading || saving
				action.dataset['recordKey'] = `pool:${pool.address.toLowerCase()}`
				action.setAttribute('aria-label', `${action.textContent}: ${pool.address}`)
				const chainId = context.chainId
				action.addEventListener('click', async () => {
					if (saving || !context.enabled || chainId === undefined || chainId !== context.chainId) return
					saving = true
					error = undefined
					render()
					let saveError: string | undefined
					try {
						await save(pool.address, !supported, chainId)
					} catch (cause) {
						saveError = publicFailure(cause, 'Could not save pool selection. Retry the pool action.')
					} finally {
						saving = false
						await refresh()
						if (saveError !== undefined) error = saveError
						render()
					}
				})
				header.append(title, action)
				const monitored = context.monitored.find(observation => observation.address.toLowerCase() === pool.address.toLowerCase())
				const currentMetrics = monitored === undefined ? pool.metrics : { systemState: monitored.systemState, totalPoolHeldRep: monitored.totalPoolHeldRep, vaultCount: monitored.knownVaultCount }
				const badges = node('div', '', 'catalog-badges')
				badges.append(node('span', supported ? 'Supported' : 'Not supported', `badge ${supported ? 'ok' : ''}`))
				const operationalStatus = currentMetrics?.systemState === '0' ? 'Operational' : 'Inactive'
				badges.append(node('span', currentMetrics === undefined ? 'Metrics unavailable' : operationalStatus, 'badge'))
				badges.append(node('span', context.approved.has(pool.universeId) ? 'Universe approved' : 'Universe approval required', `badge ${context.approved.has(pool.universeId) ? 'ok' : 'warning'}`))
				const metrics = node('dl', '', 'catalog-metrics')
				const multiplier = BigInt(pool.multiplierBps)
				for (const [label, value] of [
					['Universe', pool.universeId],
					['Security multiplier', `${multiplier / 10000n}.${(multiplier % 10000n).toString().padStart(4, '0').replace(/0+$/, '') || '0'}×`],
					['Pool-held REP', currentMetrics?.totalPoolHeldRep ?? '—'],
					['Vaults', currentMetrics?.vaultCount ?? '—'],
				]) {
					const metric = node('div', '', label === 'Pool-held REP' ? 'catalog-balance' : '')
					metric.append(node('dt', label), node('dd', value))
					metrics.append(metric)
				}
				const dates = node('dl', '', 'catalog-dates')
				dates.setAttribute('aria-label', 'Pool and question dates (UTC)')
				for (const [label, timestamp] of [
					['Pool deployment date', pool.deploymentDate],
					['Question start date', pool.questionDates?.startTime],
					['Question end date', pool.questionDates?.endTime],
				]) {
					const field = node('div')
					const value = node('dd')
					renderPoolDate(value, timestamp, currentTimestamp)
					dateFields.push({ root: value, timestamp })
					field.append(node('dt', label), value)
					dates.append(field)
				}
				const address = node('code', pool.address, 'catalog-address')
				card.append(header, badges, dates, metrics, address)
				if (pool.parent !== undefined && BigInt(pool.parent) !== 0n) card.append(node('p', `Parent ${pool.parent}`, 'catalog-address muted'))
				if (monitored !== undefined) {
					const details = node('details', '', 'catalog-monitoring')
					details.dataset['poolAddress'] = pool.address.toLowerCase()
					details.open = expanded.has(pool.address.toLowerCase())
					details.append(node('summary', 'Monitoring details'))
					const values = node('dl', '', 'catalog-metrics')
					for (const [label, value] of [
						['Eligibility', poolStatusText({ ...monitored, selected: supported }) || 'Not supported'],
						['Oracle', `${monitored.isPriceValid ? 'Fresh' : 'Stale'} · ${monitored.lastPrice} REP / ETH${monitored.centralizedPriceDeviationBps === undefined ? '' : ` · ${monitored.centralizedPriceDeviationBps} bps from reference`}`],
						['Capacity ownership', `${monitored.totalCapacityOwnershipRep} REP`],
						['Bot vault', botVaultState(monitored.botVault)],
						['Vault backing', `${monitored.botVault.vaultRepBacking} REP`],
						['Vault capacity ownership', `${monitored.botVault.capacityOwnershipRep} REP`],
						['Open interest', `${monitored.botVault.openInterestDisplay} ETH`],
						['Claimable fees', `${monitored.botVault.claimableFeesEth} ETH`],
						['Targets', `${monitored.candidateCount}${monitored.bestCandidateBonusValueEth === undefined ? ' · No executable target' : ` · ${monitored.bestCandidateBonusValueEth} ETH best bonus`}`],
					]) {
						const field = node('div')
						field.append(node('dt', label), node('dd', value))
						values.append(field)
					}
					details.append(values)
					card.append(details)
				}
				return card
			}),
		)
		if (focusedAction !== undefined) [...cards.querySelectorAll('button')].find(button => button.getAttribute('data-record-key') === focusedAction)?.focus()
	}

	async function refresh() {
		if (!context.enabled || saving || searchError !== undefined) return
		const requestEpoch = ++epoch
		loading = true
		error = undefined
		render()
		try {
			const result: PoolCatalogPage = await requestWithTimeout(
				async signal => {
					const response = await fetch(`/api/pool-catalog?page=${page}&scope=${scope}${search.value.trim() === '' ? '' : `&address=${encodeURIComponent(search.value.trim())}`}`, { signal })
					if (!response.ok) throw new Error('Pool discovery failed')
					return await response.json()
				},
				30_000,
				'Pool discovery timed out',
			)
			if (requestEpoch !== epoch) return
			if (result.chainId !== context.chainId) throw new Error('Pool page belongs to a different chain')
			if (scope === 'all' && page > 0 && BigInt(page) >= BigInt(result.pageCount)) {
				page = Math.max(0, Number(result.pageCount) - 1)
				data = undefined
				await refresh()
				return
			}
			data = result
		} catch (cause) {
			if (requestEpoch === epoch) {
				error = publicFailure(cause, 'Pool discovery failed. Check RPC connectivity and retry.')
			}
		} finally {
			if (requestEpoch === epoch) {
				loading = false
				render()
			}
		}
	}
	function selectScope(next: 'all' | 'monitored') {
		if (saving || next === scope) return
		scope = next
		epoch += 1
		page = 0
		data = undefined
		loading = false
		error = undefined
		render()
		void refresh()
	}
	search.addEventListener('input', () => {
		epoch += 1
		page = 0
		data = undefined
		loading = false
		error = undefined
		searchError = undefined
		if (search.value.trim() !== '') {
			try {
				getAddress(search.value.trim())
			} catch (cause) {
				searchError = publicFailure(cause, 'Enter a complete pool address to search.')
			}
		}
		render()
		void refresh()
	})
	previous.addEventListener('click', () => {
		page -= 1
		data = undefined
		void refresh()
	})
	next.addEventListener('click', () => {
		page += 1
		data = undefined
		void refresh()
	})
	refreshButton.addEventListener('click', () => {
		void refresh()
	})
	return {
		update(nextContext: Context) {
			const changedChain = context.chainId !== nextContext.chainId
			const changedMonitored = context.monitored.map(pool => pool.address).join() !== nextContext.monitored.map(pool => pool.address).join()
			const becameEnabled = !context.enabled && nextContext.enabled
			context = nextContext
			if (scope === 'monitored' && changedMonitored) page = 0
			if (changedChain) {
				search.value = ''
				searchError = undefined
				epoch += 1
				data = undefined
				page = 0
				loading = false
				error = undefined
			}
			render()
			if (context.enabled && (((changedChain || becameEnabled) && !loading) || (scope === 'monitored' && changedMonitored))) void refresh()
		},
	}
}
