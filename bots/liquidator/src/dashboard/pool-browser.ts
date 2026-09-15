import { publicFailure } from './pool-presentation.ts'
import { requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'
import type { PoolCatalogPage } from '../monitoring/pool-catalog.ts'

type Context = { chainId: number | undefined; enabled: boolean; selected: ReadonlySet<string>; approved: ReadonlySet<string> }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
	const result = document.createElement(tag)
	result.textContent = text
	result.className = className
	return result
}

export function createPoolBrowser(root: HTMLElement, save: (address: string, supported: boolean, chainId: number) => Promise<void>) {
	let context: Context = { chainId: undefined, enabled: false, selected: new Set(), approved: new Set() }
	let page = 0
	let epoch = 0
	let data: PoolCatalogPage | undefined
	let loading = false
	let saving = false
	let error: string | undefined
	let discoveryFailed = false
	let renderedKey: string | undefined
	const heading = node('div', '', 'section-heading')
	heading.append(node('h2', 'All pools'))
	const navigation = node('div', '', 'catalog-pagination')
	const previous = node('button', 'Previous', 'secondary')
	const next = node('button', 'Next', 'secondary')
	const summary = node('span', '', 'muted')
	navigation.append(previous, summary, next)
	heading.append(navigation)
	const status = node('p', '', 'muted')
	status.setAttribute('role', 'status')
	const retry = node('button', 'Retry', 'secondary')
	const cards = node('div', '', 'pool-catalog-list')
	root.append(heading, status, retry, cards)

	function statusMessage() {
		if (context.chainId === undefined) return 'Configure the chain and RPC endpoints in Settings to browse pools.'
		if (error !== undefined) return error
		if (saving) return 'Saving pool selection…'
		if (loading) return 'Discovering pools…'
		if (data?.total === '0') return 'No pools have been deployed on this chain.'
		if (data === undefined) return 'Waiting for connection…'
		return `Block ${data.block}`
	}

	function render() {
		const key = JSON.stringify([context.chainId, context.enabled, [...context.selected], [...context.approved], data, page, loading, saving, error, discoveryFailed])
		if (key === renderedKey) return
		renderedKey = key
		const focusedAction = document.activeElement instanceof HTMLButtonElement && cards.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : undefined
		previous.disabled = loading || saving || !context.enabled || page === 0
		next.disabled = loading || saving || !context.enabled || data === undefined || BigInt(page + 1) >= BigInt(data.pageCount)
		summary.textContent = data === undefined ? '' : `${data.total} pools · Page ${page + 1} of ${data.pageCount === '0' ? '1' : data.pageCount}`
		status.textContent = statusMessage()
		retry.hidden = !discoveryFailed
		retry.disabled = loading || !context.enabled
		cards.setAttribute('aria-busy', String(loading))
		cards.replaceChildren(
			...(data?.pools ?? []).map(pool => {
				// Match Statoblast's ComparisonRecord: identity and action, metric grid, then details.
				const card = node('article', '', 'catalog-record')
				const header = node('header', '', 'catalog-record-header')
				const title = node('h3', `Question ${pool.questionId}`)
				const supported = context.selected.has(pool.address.toLowerCase())
				const action = node('button', supported ? 'Remove from supported' : 'Add to supported', supported ? 'secondary' : '')
				action.disabled = !context.enabled || loading || saving
				action.setAttribute('aria-label', `${action.textContent}: ${pool.address}`)
				const chainId = data?.chainId
				action.addEventListener('click', async () => {
					if (saving || !context.enabled || chainId === undefined || chainId !== context.chainId) return
					saving = true
					error = undefined
					render()
					try {
						await save(pool.address, !supported, chainId)
					} catch (cause) {
						error = publicFailure(cause, 'Could not save pool selection. Retry the pool action.')
					} finally {
						saving = false
						render()
					}
				})
				header.append(title, action)
				const badges = node('div', '', 'catalog-badges')
				badges.append(node('span', supported ? 'Supported' : 'Not supported', `badge ${supported ? 'ok' : ''}`))
				const operationalStatus = pool.metrics?.systemState === '0' ? 'Operational' : 'Inactive'
				badges.append(node('span', pool.metrics === undefined ? 'Metrics unavailable' : operationalStatus, 'badge'))
				badges.append(node('span', context.approved.has(pool.universeId) ? 'Universe approved' : 'Universe approval required', `badge ${context.approved.has(pool.universeId) ? 'ok' : 'warning'}`))
				const metrics = node('dl', '', 'catalog-metrics')
				const multiplier = BigInt(pool.multiplierBps)
				for (const [label, value] of [
					['Universe', pool.universeId],
					['Security multiplier', `${multiplier / 10000n}.${(multiplier % 10000n).toString().padStart(4, '0').replace(/0+$/, '') || '0'}×`],
					['Pool-held REP', pool.metrics?.totalPoolHeldRep ?? '—'],
					['Vaults', pool.metrics?.vaultCount ?? '—'],
				]) {
					const metric = node('div', '', label === 'Pool-held REP' ? 'catalog-balance' : '')
					metric.append(node('dt', label), node('dd', value))
					metrics.append(metric)
				}
				const address = node('code', pool.address, 'catalog-address')
				card.append(header, badges, metrics, address)
				if (BigInt(pool.parent) !== 0n) card.append(node('p', `Parent ${pool.parent}`, 'catalog-address muted'))
				return card
			}),
		)
		if (focusedAction !== undefined) [...cards.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === focusedAction)?.focus()
	}

	async function refresh() {
		if (!context.enabled || saving) return
		const requestEpoch = ++epoch
		loading = true
		error = undefined
		discoveryFailed = false
		render()
		try {
			const result: PoolCatalogPage = await requestWithTimeout(
				async signal => {
					const response = await fetch(`/api/pool-catalog?page=${page}`, { signal })
					if (!response.ok) throw new Error('Pool discovery failed')
					return await response.json()
				},
				30_000,
				'Pool discovery timed out',
			)
			if (requestEpoch !== epoch) return
			if (result.chainId !== context.chainId) throw new Error('Pool page belongs to a different chain')
			data = result
		} catch (cause) {
			if (requestEpoch === epoch) {
				error = publicFailure(cause, 'Pool discovery failed. Check RPC connectivity and retry.')
				discoveryFailed = true
			}
		} finally {
			if (requestEpoch === epoch) {
				loading = false
				render()
			}
		}
	}
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
	retry.addEventListener('click', () => {
		void refresh()
	})
	return {
		update(nextContext: Context) {
			const changedChain = context.chainId !== nextContext.chainId
			const becameEnabled = !context.enabled && nextContext.enabled
			context = nextContext
			if (changedChain) {
				epoch += 1
				data = undefined
				page = 0
				discoveryFailed = false
				loading = false
				error = undefined
			}
			render()
			if (context.enabled && (changedChain || becameEnabled) && !loading) void refresh()
		},
	}
}
