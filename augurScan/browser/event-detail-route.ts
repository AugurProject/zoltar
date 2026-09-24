import { exactUnit } from './format.ts'
import type { ActivityRecord, ArgumentDefinition, DetailContextSnapshot, DetailOptions, LogReference } from './browser-types.ts'
import type { ActivityDetailState } from './activity-detail-state.ts'
import type { CanonicalState } from './canonical-state.ts'
import { captureActivityDetailFocus, captureDisclosureState, decodedActionLabel, isCurrentCanonicalGeneration, isNoncanonicalDetailFailure, placeActivityDetailDrawer, refreshPresentation, restoreActivityDetailFocus, restoreDisclosureState } from './live-update.ts'
import { decodeValue, isActivityRecord, isLogDetail } from './api-decoding.ts'
import { logKeyFor } from './activity-row.ts'

interface EventDetailRouteDeps {
	feed: HTMLElement
	activityDetailState: ActivityDetailState
	canonicalState: CanonicalState
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	number: (value: string | number | bigint | null | undefined) => string
	api: (path: string) => Promise<unknown>
	syncCanonicalDialogStatus: () => void
	clearDetailUrl: () => void
	errorMessage: (error: unknown) => string
	detailCard: (term: string, description: string, wide?: boolean) => HTMLElement
	evidenceDetailCard: (term: string, base: string, type: string, value: string, label?: string) => HTMLElement
	addressDetailCard: (term: string, address: string | null | undefined, options?: { knownLabel?: string | null; chainId?: string; wide?: boolean }) => HTMLElement
	decodedArgumentsTable: (schema: ArgumentDefinition[] | null | undefined, raw: Record<string, unknown> | null | undefined, display: Record<string, unknown> | null | undefined, chainId: string) => HTMLElement
}

export const createEventDetailRoute = (deps: EventDetailRouteDeps) => {
	const { feed, activityDetailState, canonicalState, element, number, api, syncCanonicalDialogStatus, clearDetailUrl, errorMessage, detailCard, evidenceDetailCard, addressDetailCard, decodedArgumentsTable } = deps
	const eventDrawers = () => [...document.querySelectorAll<HTMLElement>('.event-detail-drawer')]

	const eventDrawerFor = (key: string) => eventDrawers().find(drawer => drawer.dataset.triggerKey === key)

	const drawerRequests = new WeakMap<HTMLElement, number>()

	const drawerLogs = new WeakMap<HTMLElement, ActivityRecord | LogReference>()

	const updateLogDisclosures = () => {
		for (const row of feed.querySelectorAll<HTMLElement>('.log-row')) row.querySelector('.event-name')?.setAttribute('aria-expanded', String(eventDrawerFor(row.dataset.liveKey ?? '') !== undefined))
	}

	const removeEventDrawers = () => {
		for (const drawer of eventDrawers()) drawer.remove()
		updateLogDisclosures()
	}

	const closeEventDrawer = ({ clearUrl = true, restoreFocus = false, key }: { clearUrl?: boolean; restoreFocus?: boolean; key?: string } = {}) => {
		const drawer = key === undefined ? eventDrawers().at(-1) : eventDrawerFor(key)
		const triggerKey = drawer?.dataset.triggerKey
		if (key === undefined) {
			activityDetailState.detailContextVersion++
			activityDetailState.detailRequestVersion++
			removeEventDrawers()
		} else {
			drawer?.remove()
		}
		if (activityDetailState.activeLog && (key === undefined || logKeyFor(activityDetailState.activeLog) === key)) {
			activityDetailState.activeLog = undefined
			activityDetailState.pendingCanonicalLog = undefined
			if (canonicalState.recovery !== undefined) canonicalState.recovery.logToRefresh = undefined
		}
		updateLogDisclosures()
		if (clearUrl && (key === undefined || new URL(location.href).searchParams.get('log') === key)) clearDetailUrl()
		if (restoreFocus && triggerKey)
			[...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')]
				.find(row => row.dataset.liveKey === triggerKey)
				?.querySelector<HTMLElement>('button')
				?.focus({ preventScroll: true })
	}

	const captureDetailContext = (drawer = eventDrawers().find(item => item.contains(document.activeElement)) ?? eventDrawers()[0]): DetailContextSnapshot => {
		if (!drawer) return { scrollTop: window.scrollY, drawerFocused: false, focusIndex: -1 }
		return { scrollTop: window.scrollY, ...captureActivityDetailFocus(drawer, document.activeElement) }
	}

	const restoreDetailContext = (snapshot: DetailContextSnapshot, drawer = eventDrawers()[0]) => {
		if (!drawer) return
		window.scrollTo({ top: snapshot.scrollTop })
		restoreActivityDetailFocus(drawer, snapshot, (nextFocus, previousTop) => window.scrollBy(0, nextFocus.getBoundingClientRect().top - previousTop))
	}

	const placeEventDrawer = (drawer: HTMLElement, { allowOutsideShellFallback = true } = {}): boolean => {
		const feedShell = feed.closest<HTMLElement>('.feed-shell')
		if (feedShell) drawer.style.width = `${feedShell.clientWidth}px`
		else drawer.style.removeProperty('width')
		if (placeActivityDetailDrawer(feed, drawer)) {
			updateLogDisclosures()
			return true
		}
		if (allowOutsideShellFallback && feedShell && drawer.previousElementSibling !== feedShell) {
			feedShell.after(drawer)
			return true
		}
		return false
	}

	const collapsibleDetailCard = (title: string, disclosureKey: string, ...content: Node[]): HTMLDetailsElement => {
		const card = element('details', 'detail-card detail-disclosure wide')
		card.dataset.disclosureKey = disclosureKey
		card.append(element('summary', '', title), ...content)
		return card
	}

	const detailContextIsUnchanged = (snapshot: DetailContextSnapshot, drawer: HTMLElement): boolean => {
		if (Math.abs(window.scrollY - snapshot.scrollTop) > 1) return false
		if (snapshot.drawerFocused) return document.activeElement === drawer
		if (snapshot.focusIndex < 0) return true
		const focusable = drawer ? [...drawer.querySelectorAll<HTMLElement>('a, button, summary')] : []
		return document.activeElement === focusable[snapshot.focusIndex]
	}

	const performOpenDetail = async (log: ActivityRecord | LogReference, { live = false, canonicalRecovery = false, contextVersion }: DetailOptions = {}): Promise<boolean> => {
		if (contextVersion !== activityDetailState.detailContextVersion) return false
		const canonicalGeneration = canonicalState.dataGeneration
		const existingDrawer = eventDrawerFor(logKeyFor(log))
		const drawer = existingDrawer ?? element('section', 'event-detail-drawer')
		const requestVersion = (drawerRequests.get(drawer) ?? 0) + 1
		drawerRequests.set(drawer, requestVersion)
		drawerLogs.set(drawer, log)
		const requestIsCurrent = () => drawer.isConnected && drawerRequests.get(drawer) === requestVersion && contextVersion === activityDetailState.detailContextVersion && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)
		const previousContext = live ? captureDetailContext(drawer) : undefined
		if (isActivityRecord(log)) activityDetailState.activeLog = log
		if (!canonicalRecovery && isActivityRecord(log)) {
			activityDetailState.pendingCanonicalLog = canonicalState.recovery === undefined && !canonicalState.refreshRequired ? undefined : log
			if (canonicalState.recovery !== undefined) {
				canonicalState.recovery.logToRefresh = log
				canonicalState.recovery.accountToRefresh = undefined
			}
		}
		activityDetailState.pendingCanonicalAccount = undefined
		activityDetailState.pendingAccountDialogSnapshot = undefined
		activityDetailState.activeAccount = undefined
		activityDetailState.activeAccountTransactions = undefined
		activityDetailState.activeAccountLoadMore = undefined
		drawer.setAttribute('aria-label', 'Event details')
		const drawerContent = existingDrawer?.querySelector<HTMLElement>('.event-detail-content') ?? element('div', 'event-detail-content')
		if (!existingDrawer) {
			const canonicalStatus = element('div', 'detail-canonical-status event-detail-canonical-status')
			canonicalStatus.hidden = true
			canonicalStatus.setAttribute('role', 'status')
			canonicalStatus.setAttribute('aria-live', 'polite')
			drawer.append(canonicalStatus, drawerContent)
		}
		drawer.dataset.triggerKey = logKeyFor(log)
		updateLogDisclosures()
		placeEventDrawer(drawer)
		syncCanonicalDialogStatus()
		drawerContent.setAttribute('aria-busy', String(refreshPresentation({ live }).busy))
		if (!live) {
			const loading = element('p', 'detail-status', 'Loading event details…')
			loading.setAttribute('role', 'status')
			drawerContent.replaceChildren(loading, element('div', 'loading-line'))
			drawer.tabIndex = -1
			drawer.focus({ preventScroll: true })
		}
		if (!live) {
			const url = new URL(location.href)
			url.searchParams.delete('account')
			url.searchParams.set('log', logKeyFor(log))
			history.replaceState(null, '', url)
		}
		try {
			const detail = decodeValue(await api(`/api/v1/logs/${log.chain_id}/${log.block_hash}/${log.tx_hash}/${log.log_index}`), isLogDetail, 'Log detail')
			if (!requestIsCurrent()) return false
			activityDetailState.activeLog = detail
			const deployedContractAddress = typeof detail.receipt['contractAddress'] === 'string' ? detail.receipt['contractAddress'] : undefined
			const disclosureState = live ? captureDisclosureState(drawerContent) : {}
			const grid = element('div', 'detail-grid')
			grid.append(
				detailCard('Event signature', detail.event_signature ?? 'No matching ABI'),
				detailCard('Block hash', detail.block_hash),
				detailCard('Occurrence position', `transaction ${number(detail.transaction_index)} · log ${number(detail.log_index)}`),
				addressDetailCard('msg.origin', detail.origin_address, { chainId: detail.chain_id }),
				addressDetailCard('To', detail.to_address, { chainId: detail.chain_id }),
				detailCard('Gas used', number(detail.gas_used)),
				detailCard('Transaction value', exactUnit(detail.value, 18, 'ETH')),
				detailCard('Transaction action', decodedActionLabel(detail.action_summary, detail.to_address, detail.contract_label, detail.emitter_address, deployedContractAddress)),
			)
			const contractCard = evidenceDetailCard('Contract', detail.explorer_base_url, 'address', detail.emitter_address)
			contractCard.querySelector('a')?.classList.add('event-contract-link')
			grid.prepend(contractCard, evidenceDetailCard('Block', detail.explorer_base_url, 'block', detail.block_number, `#${number(detail.block_number)}`), evidenceDetailCard('Transaction', detail.explorer_base_url, 'tx', detail.tx_hash))
			const argumentsCard = element('div', 'detail-card wide')
			argumentsCard.append(element('p', 'eyebrow', 'Decoded arguments'))
			argumentsCard.append(decodedArgumentsTable(detail.argument_schema, detail.arguments, detail.display_arguments, detail.chain_id))
			grid.append(argumentsCard)
			const actionContent: Node[] = []
			if (detail.action_arguments && Object.keys(detail.action_arguments).length > 0) actionContent.push(decodedArgumentsTable(detail.action_argument_schema, detail.action_arguments, detail.action_display_arguments, detail.chain_id))
			actionContent.push(element('pre', 'raw', JSON.stringify({ input: detail.input, function: detail.function_signature, arguments: detail.action_arguments }, null, 2)))
			grid.append(collapsibleDetailCard('Transaction calldata and decoded action', 'transaction-action', ...actionContent))
			grid.append(collapsibleDetailCard('Complete raw transaction receipt', 'transaction-receipt', element('pre', 'raw', JSON.stringify(detail.receipt, null, 2))))
			restoreDisclosureState(grid, disclosureState)
			const contextToRestore = captureDetailContext(drawer)
			if (!live || !drawerContent.firstElementChild?.isEqualNode(grid)) drawerContent.replaceChildren(grid)
			placeEventDrawer(drawer)
			if (contextToRestore) restoreDetailContext(contextToRestore, drawer)
			if (canonicalRecovery) activityDetailState.pendingCanonicalLog = undefined
			return true
		} catch (error) {
			if (!requestIsCurrent()) return false
			const noncanonical = isNoncanonicalDetailFailure(canonicalRecovery, error instanceof Error ? error.status : undefined)
			if (canonicalRecovery && !noncanonical && canonicalState.refreshRequired) {
				drawerContent.querySelector<HTMLElement>('.detail-refresh-error')?.remove()
				if (previousContext && detailContextIsUnchanged(previousContext, drawer)) restoreDetailContext(previousContext, drawer)
				return false
			}
			const alert = element('div', `detail-error${live ? ' detail-refresh-error' : ''}`)
			alert.setAttribute('role', 'alert')
			alert.append(element('p', '', noncanonical ? 'This log was replaced after the chain changed.' : `Could not open log: ${errorMessage(error)}`))
			const retry = element('button', 'state-retry', 'Retry')
			retry.type = 'button'
			retry.addEventListener('click', () => openDetail(log, { live: !noncanonical, canonicalRecovery }))
			if (!noncanonical) alert.append(retry)
			if (live && !noncanonical) {
				const contextToRestore = drawerContent.contains(document.activeElement) ? captureDetailContext(drawer) : undefined
				drawerContent.querySelector<HTMLElement>('.detail-refresh-error')?.remove()
				drawerContent.prepend(alert)
				if (contextToRestore) restoreDetailContext(contextToRestore, drawer)
			} else drawerContent.replaceChildren(alert)
			if (noncanonical) activityDetailState.pendingCanonicalLog = undefined
			return noncanonical
		} finally {
			if (requestIsCurrent()) drawerContent.setAttribute('aria-busy', 'false')
		}
	}

	const openDetail = (log: ActivityRecord | LogReference, options: DetailOptions = {}): Promise<boolean> => {
		if (options.live === true && eventDrawerFor(logKeyFor(log)) === undefined) return Promise.resolve(true)
		if (options.live !== true) activityDetailState.detailRequestVersion++
		return performOpenDetail(log, { ...options, contextVersion: activityDetailState.detailContextVersion })
	}

	const restorePendingCanonicalLog = async () => {
		if (activityDetailState.pendingCanonicalLog === undefined) return true
		return await openDetail(activityDetailState.pendingCanonicalLog, { live: document.querySelector('.event-detail-drawer') !== null, canonicalRecovery: true })
	}

	return { eventDrawers, eventDrawerFor, drawerLogFor: (drawer: HTMLElement) => drawerLogs.get(drawer), updateLogDisclosures, removeEventDrawers, closeEventDrawer, captureDetailContext, restoreDetailContext, placeEventDrawer, openDetail, restorePendingCanonicalLog }
}
