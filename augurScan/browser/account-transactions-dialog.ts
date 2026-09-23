import type { RefreshGate } from './live-update.ts'
import { $, element, number, time, exactTimestamp } from './view-presentation.ts'
import { exactUnit } from './chart-view.ts'
import { short } from './identifier-format.ts'
import { type AccountDetailOptions, type AccountReference, type AccountTransactionState, type ActivityRecord, type ArgumentDefinition, type CanonicalRecovery, type DialogSnapshot, type LiveChangeOptions, type ProtocolAddressLinkOptions } from './browser-types.ts'
import {
	accountStateDuringStagedRefresh,
	canonicalPageLimit,
	isCurrentCanonicalGeneration,
	isCurrentContextRequest,
	isCurrentLiveRequest,
	mergeUniqueRecords,
	paginationRequestAllowed,
	reconcilePaginatedTotal,
	reconcileTransactionDialogSnapshot,
	refreshPresentation,
	shouldContinueTransactionRestore,
	transactionRetryMode,
} from './live-update.ts'
import { decodeItemsPage, isAccountTransaction } from './api-decoding.ts'

type AccountTransactionsDialogContext = {
	activeAccountTransactions: AccountTransactionState | undefined
	detailContent: HTMLElement
	dialog: HTMLDialogElement
	detailContextVersion: number
	canonicalDataGeneration: number
	accountPageRefreshGate: RefreshGate
	activeAccountLoadMore: (() => Promise<boolean | undefined>) | undefined
	detailRequestVersion: number
	stagedAccountDialogSnapshot: (canonicalRecovery: boolean, stagedLiveRefresh: boolean, restoreSnapshot: DialogSnapshot | undefined) => DialogSnapshot | undefined
	liveSnapshot: (container: ParentNode, selector?: string) => Map<string, string>
	activeLog: ActivityRecord | undefined
	removeEventDrawers: () => void
	pendingCanonicalLog: ActivityRecord | undefined
	pendingCanonicalAccount: AccountReference | undefined
	activeReorgRecovery: CanonicalRecovery | undefined
	canonicalRefreshRequired: boolean
	pendingAccountDialogSnapshot: DialogSnapshot | undefined
	activeAccount: AccountReference | undefined
	syncCanonicalDialogStatus: () => void
	isRichList: boolean
	setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	explorerLink: (base: string, type: string, value: string | number, label: string) => HTMLAnchorElement
	nativeSymbol: (chainId?: string) => 'ETH' | 'SepoliaETH'
	protocolAddressLink: (address: string | null, { knownLabel, chainId, className, compact }?: ProtocolAddressLinkOptions) => HTMLAnchorElement
	decodedArgumentsTable: (schema: ArgumentDefinition[] | null | undefined, rawArguments: Record<string, unknown> | null | undefined, displayArguments: Record<string, unknown> | null | undefined, chainId: string) => HTMLTableElement
	restorePendingCanonicalAccount: () => Promise<boolean>
	applyLiveChanges: (container: ParentNode, previous: ReadonlyMap<string, string>, { live, selector }?: LiveChangeOptions) => { added: number; changed: number }
	api: (path: string, options?: { signal?: AbortSignal }) => Promise<unknown>
	selectedChainId: () => string
	errorMessage: (error: unknown) => string
	accountTransactionsError: (detail: string, hasLoaded: boolean, append: boolean) => string
	openAccountTransactions: (account: AccountReference, options?: AccountDetailOptions) => Promise<boolean>
}

export function createAccountTransactionsDialog(context: AccountTransactionsDialogContext) {
	const captureAccountDialogSnapshot = (): DialogSnapshot | undefined => {
		if (context.activeAccountTransactions === undefined) return undefined
		const cards = [...context.detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')]
		const focusedCard = document.activeElement?.closest<HTMLElement>('.account-transaction[data-live-key]')
		const focusable = focusedCard ? [...focusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
		const anchorCard = focusedCard ?? cards.find(card => card.getBoundingClientRect().bottom > context.dialog.getBoundingClientRect().top)
		return {
			loadedCount: context.activeAccountTransactions.loaded.length,
			expandedKeys: [...context.detailContent.querySelectorAll<HTMLElement>('.account-transaction-action[open]')].flatMap(action => {
				const key = action.closest<HTMLElement>('.account-transaction[data-live-key]')?.dataset.liveKey
				return key === undefined ? [] : [key]
			}),
			anchorKey: anchorCard?.dataset.liveKey,
			anchorTop: anchorCard?.getBoundingClientRect().top,
			focusKey: focusedCard?.dataset.liveKey,
			focusIndex: document.activeElement instanceof HTMLElement ? focusable.indexOf(document.activeElement) : -1,
			outsideFocus: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.liveFocus : undefined,
			scrollTop: context.dialog.scrollTop,
		}
	}

	const restoreAccountDialogSnapshot = (snapshot: DialogSnapshot) => {
		const availableKeys = new Set([...context.detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')].flatMap(card => (card.dataset.liveKey === undefined ? [] : [card.dataset.liveKey])))
		const reconciled = reconcileTransactionDialogSnapshot(snapshot, availableKeys)
		for (const key of reconciled.expandedKeys) {
			if (key === undefined) continue
			const card = context.detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(key)}"]`)
			const action = card?.querySelector<HTMLDetailsElement>('.account-transaction-action')
			if (action) action.open = true
		}
		context.dialog.scrollTop = reconciled.scrollTop ?? snapshot.scrollTop
		if (reconciled.anchorKey && reconciled.anchorTop !== undefined) {
			const anchor = context.detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(reconciled.anchorKey)}"]`)
			if (anchor) context.dialog.scrollTop += anchor.getBoundingClientRect().top - reconciled.anchorTop
		}
		if (reconciled.focusKey && reconciled.focusIndex >= 0) {
			const focusedCard = context.detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(reconciled.focusKey)}"]`)
			const focusable = focusedCard ? [...focusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
			focusable[reconciled.focusIndex]?.focus({ preventScroll: true })
		} else if (reconciled.outsideFocus) {
			context.detailContent.querySelector<HTMLElement>(`[data-live-focus="${CSS.escape(reconciled.outsideFocus)}"]`)?.focus({ preventScroll: true })
		}
	}

	const performOpenAccountTransactions = async (account: AccountReference, { live = false, restoreSnapshot, canonicalRecovery = false, contextVersion }: AccountDetailOptions = {}): Promise<boolean> => {
		if (contextVersion !== context.detailContextVersion) return false
		const canonicalGeneration = context.canonicalDataGeneration
		const pageReservation = context.accountPageRefreshGate.reserve()
		await pageReservation.ready
		if (contextVersion !== context.detailContextVersion || !isCurrentCanonicalGeneration(canonicalGeneration, context.canonicalDataGeneration)) {
			pageReservation.release()
			await pageReservation.completed
			return false
		}
		const previousState = context.activeAccountTransactions
		const previousLoadMore = context.activeAccountLoadMore
		const stateKey = `${account.chain_id}:${account.address.toLowerCase()}`
		const previousMatches = previousState?.key === stateKey
		const requestVersion = live && previousMatches ? context.detailRequestVersion : ++context.detailRequestVersion
		const stagedLiveRefresh = !canonicalRecovery && live && previousMatches
		const stagedRefresh = canonicalRecovery || stagedLiveRefresh
		const stagedSnapshot = context.stagedAccountDialogSnapshot(canonicalRecovery, stagedLiveRefresh, restoreSnapshot)
		const refreshPrevious = stagedRefresh ? context.liveSnapshot(context.detailContent, '.account-transaction[data-live-key]') : undefined
		context.activeLog = undefined
		context.removeEventDrawers()
		context.pendingCanonicalLog = undefined
		if (restoreSnapshot === undefined && !live) {
			context.pendingCanonicalAccount = context.activeReorgRecovery === undefined && !context.canonicalRefreshRequired ? undefined : account
			context.pendingAccountDialogSnapshot = undefined
			if (context.activeReorgRecovery !== undefined) {
				context.activeReorgRecovery.logToRefresh = undefined
				context.activeReorgRecovery.accountToRefresh = account
			}
		}
		context.activeAccount = account
		if (!context.dialog.open) context.dialog.showModal()
		context.syncCanonicalDialogStatus()
		$('#detail-eyebrow').textContent = 'Account activity'
		$('#detail-title').textContent = 'Sent transactions'
		const url = new URL(location.href)
		url.searchParams.delete('log')
		if (context.isRichList) url.searchParams.set('account', `${account.chain_id}:${account.address}`)
		else url.searchParams.delete('account')
		history.replaceState(null, '', url)
		const state =
			!stagedRefresh && live && previousMatches
				? previousState
				: {
						key: stateKey,
						account,
						loaded: [],
						total: 0,
						nextPageCursor: undefined,
						pageLoading: false,
						pageError: undefined,
						pageErrorAppend: false,
					}
		state.account = account
		context.activeAccountTransactions = accountStateDuringStagedRefresh(previousState, state, stagedRefresh)
		interface AccountRenderOptions {
			previous?: ReadonlyMap<string, string>
			highlight?: boolean
		}

		const render = ({ previous = new Map<string, string>(), highlight = false }: AccountRenderOptions = {}) => {
			const focusedCard = document.activeElement?.closest<HTMLElement>('.account-transaction[data-live-key]')
			const focusedTransactionKey = focusedCard?.dataset.liveKey
			const focusedControls = focusedCard ? [...focusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
			const focusedControlIndex = document.activeElement instanceof HTMLElement ? focusedControls.indexOf(document.activeElement) : -1
			const outsideFocusKey = focusedCard || !(document.activeElement instanceof HTMLElement) ? undefined : document.activeElement.dataset.liveFocus
			const visibleCards = [...context.detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')]
			const anchorCard = focusedCard ?? visibleCards.find(card => card.getBoundingClientRect().bottom > context.dialog.getBoundingClientRect().top)
			const anchorKey = anchorCard?.dataset.liveKey
			const anchorTop = anchorCard?.getBoundingClientRect().top
			const openTransactionKeys = new Set([...context.detailContent.querySelectorAll<HTMLElement>('.account-transaction-action[open]')].map(action => action.closest<HTMLElement>('.account-transaction[data-live-key]')?.dataset.liveKey))
			const header = element('div', 'account-transactions-header')
			header.append(element('p', 'eyebrow', 'Sent transactions'), element('h3', '', state.account.label ?? state.account.address), element('code', '', state.account.address), element('p', 'data-note', `${number(state.loaded.length)} of ${number(state.total)} sent transactions`))
			const list = element('div', 'account-transactions')
			for (const transaction of state.loaded) {
				const transactionKey = `${transaction.chain_id}:${transaction.tx_hash}`
				const card = context.setLiveRecord(element('article', 'account-transaction'), transactionKey, transaction)
				const cardHeader = element('div', 'account-transaction-header')
				cardHeader.append(context.explorerLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 12, 8)), element('span', `badge${transaction.status === 'success' ? '' : ' transaction-failed'}`, transaction.status ?? 'unknown'))
				const destination = transaction.to_label ? `${transaction.to_label} · ${short(transaction.to_address, 8, 6)}` : (transaction.to_address ?? 'Contract creation')
				const detailGrid = element('dl', 'account-transaction-fields')
				for (const [term, value] of [
					['Block', `#${number(transaction.block_number)} · ${exactTimestamp(transaction.block_timestamp).slice(0, 10)} · ${time(transaction.block_timestamp)} UTC`],
					['To', destination],
					['Value', exactUnit(transaction.value, 18, context.nativeSymbol(transaction.chain_id), 2)],
					['Gas used', number(transaction.gas_used)],
					['Action', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'],
				]) {
					const field = element('div')
					const description = element('dd', '', term === 'To' && transaction.to_address ? undefined : value)
					if (term === 'To' && transaction.to_address)
						description.append(
							context.protocolAddressLink(transaction.to_address, {
								knownLabel: transaction.to_label,
								chainId: transaction.chain_id,
								className: 'address-link',
							}),
						)
					field.append(element('dt', '', term), description)
					detailGrid.append(field)
				}
				card.append(cardHeader, detailGrid)
				if (transaction.action_display_arguments && Object.keys(transaction.action_display_arguments).length > 0) {
					const action = element('details', 'account-transaction-action')
					action.open = openTransactionKeys.has(transactionKey)
					const argumentsContent = element('div', 'account-transaction-arguments')
					argumentsContent.append(context.decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id))
					const summary = element('summary', '', 'Decoded arguments')
					summary.dataset.liveFocus = 'decoded-arguments'
					action.append(summary, argumentsContent)
					card.append(action)
				}
				list.append(card)
			}
			if (state.loaded.length === 0) list.append(element('p', 'state-placeholder', 'No sent transactions were found.'))
			const more = element('button', 'secondary account-transactions-more', state.pageLoading ? 'Loading more transactions…' : 'Show more transactions')
			more.type = 'button'
			more.dataset.liveFocus = 'show-more-transactions'
			more.hidden = context.canonicalRefreshRequired || state.nextPageCursor === undefined || (state.pageError !== undefined && state.pageErrorAppend)
			more.disabled = context.canonicalRefreshRequired || state.pageLoading
			more.addEventListener('click', () => context.activeAccountLoadMore?.())
			const content: Node[] = [header]
			let transactionError: HTMLDivElement | undefined
			if (state.pageError) {
				transactionError = element('div', `detail-error account-transactions-error${state.pageErrorAppend ? ' append-error' : ''}`)
				transactionError.setAttribute('role', 'alert')
				transactionError.append(element('p', '', state.pageError))
				const retry = element('button', 'state-retry', 'Retry loading transactions')
				retry.type = 'button'
				retry.addEventListener('click', () => {
					if (context.pendingCanonicalAccount && context.pendingAccountDialogSnapshot) return context.restorePendingCanonicalAccount()
					const retryMode = transactionRetryMode(state.pageErrorAppend, state.loaded.length > 0)
					return loadPage(retryMode.append, { liveRefresh: retryMode.liveRefresh })
				})
				transactionError.append(retry)
				if (!state.pageErrorAppend) content.push(transactionError)
			}
			content.push(list)
			if (transactionError !== undefined && state.pageErrorAppend) content.push(transactionError)
			content.push(more)
			context.detailContent.replaceChildren(...content)
			const nextAnchor = anchorKey ? context.detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(anchorKey)}"]`) : undefined
			if (nextAnchor && anchorTop !== undefined) context.dialog.scrollTop += nextAnchor.getBoundingClientRect().top - anchorTop
			if (focusedTransactionKey && focusedControlIndex >= 0) {
				const nextFocusedCard = context.detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(focusedTransactionKey)}"]`)
				const nextControls = nextFocusedCard ? [...nextFocusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
				nextControls[focusedControlIndex]?.focus({ preventScroll: true })
			} else if (outsideFocusKey === 'show-more-transactions') {
				context.detailContent.querySelector<HTMLElement>('[data-live-focus="show-more-transactions"]')?.focus({ preventScroll: true })
			}
			context.applyLiveChanges(list, previous, { live: highlight, selector: '.account-transaction[data-live-key]' })
		}
		interface AccountPageOptions {
			liveRefresh?: boolean
			background?: boolean
			stageOnly?: boolean
			limit?: number
			restartInvalidSnapshot?: boolean
		}
		const performLoadPage = async (append = false, { liveRefresh = false, background = false, stageOnly = false, limit = 50, restartInvalidSnapshot = true }: AccountPageOptions = {}) => {
			if (state.pageLoading) return false
			if (!stageOnly && !paginationRequestAllowed(append, context.canonicalRefreshRequired)) {
				const more = context.detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
				if (more !== null) {
					more.hidden = true
					more.disabled = true
				}
				return false
			}
			state.pageLoading = true
			state.pageError = undefined
			state.pageErrorAppend = false
			context.detailContent.setAttribute('aria-busy', String(refreshPresentation({ live: background, append }).busy))
			const previous = context.liveSnapshot(context.detailContent, '.account-transaction[data-live-key]')
			const previousLoaded = state.loaded
			const previousTotal = state.total
			const previousCursor = state.nextPageCursor
			if (!append && !liveRefresh && !stageOnly && state.loaded.length === 0) {
				const loading = element('p', 'detail-status', 'Loading sent transactions…')
				loading.setAttribute('role', 'status')
				context.detailContent.replaceChildren(loading, element('div', 'loading-line'))
			} else if (append && !stageOnly) render()
			try {
				const query = new URLSearchParams({
					chainId: String(state.account.chain_id),
					address: state.account.address,
					limit: String(limit),
				})
				if (append && state.nextPageCursor) query.set('cursor', state.nextPageCursor)
				const result = decodeItemsPage(await context.api(`/api/v1/address-transactions?${query}`), isAccountTransaction, 'Address transactions')
				if (contextVersion !== context.detailContextVersion || !isCurrentLiveRequest(requestVersion, context.detailRequestVersion, state.account.chain_id, context.selectedChainId()) || !isCurrentCanonicalGeneration(canonicalGeneration, context.canonicalDataGeneration)) {
					state.pageLoading = false
					return false
				}
				const retained = append || liveRefresh ? previousLoaded : []
				state.loaded = mergeUniqueRecords(append ? retained : result.items, append ? result.items : retained, transaction => `${transaction.chain_id}:${transaction.tx_hash}`)
				state.total = reconcilePaginatedTotal(state.total, result.total ?? state.total, append)
				state.nextPageCursor = liveRefresh && previousCursor !== undefined ? previousCursor : result.nextCursor
				if (state.loaded.length >= state.total) state.nextPageCursor = undefined
				state.pageLoading = false
				if (!stageOnly) render({ previous, highlight: liveRefresh })
				return true
			} catch (error) {
				if (!isCurrentContextRequest(contextVersion, context.detailContextVersion, requestVersion, context.detailRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, context.canonicalDataGeneration)) {
					state.pageLoading = false
					return false
				}
				if (error instanceof Error && error.status === 409 && restartInvalidSnapshot) {
					state.pageLoading = false
					const targetCount = previousLoaded.length + (append ? limit : 0)
					state.loaded = []
					state.total = 0
					state.nextPageCursor = undefined
					let recovered = await performLoadPage(false, {
						background,
						stageOnly: true,
						limit: canonicalPageLimit(targetCount, 0, 50),
						restartInvalidSnapshot: false,
					})
					while (shouldContinueTransactionRestore(recovered, state.loaded.length, targetCount, state.nextPageCursor))
						recovered = await performLoadPage(true, {
							background,
							stageOnly: true,
							limit: canonicalPageLimit(targetCount, state.loaded.length, 50),
							restartInvalidSnapshot: false,
						})
					if (recovered) {
						if (!stageOnly) render({ previous, highlight: true })
						return true
					}
					const recoveryError = state.pageError
					state.loaded = previousLoaded
					state.total = previousTotal
					state.nextPageCursor = previousCursor
					state.pageLoading = false
					state.pageErrorAppend = append
					state.pageError = append ? `Could not load more transactions; showing the last known activity: ${recoveryError ?? context.errorMessage(error)}` : `Could not refresh sent transactions; showing the last known activity: ${recoveryError ?? context.errorMessage(error)}`
					if (!stageOnly) render()
					return false
				}
				state.pageLoading = false
				state.pageErrorAppend = append
				state.pageError = context.accountTransactionsError(context.errorMessage(error), state.loaded.length > 0, append)
				if (!stageOnly) render()
				return false
			} finally {
				if (isCurrentContextRequest(contextVersion, context.detailContextVersion, requestVersion, context.detailRequestVersion)) context.detailContent.setAttribute('aria-busy', 'false')
			}
		}
		const loadPage = (append = false, options: AccountPageOptions = {}) => {
			if (append && options.background !== true) {
				const more = context.detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
				if (more !== null) {
					more.disabled = true
					more.setAttribute('aria-busy', 'true')
					more.textContent = 'Loading more transactions…'
				}
				context.detailContent.setAttribute('aria-busy', 'true')
			}
			return options.background === true ? context.accountPageRefreshGate.runBackground(() => performLoadPage(append, options)) : context.accountPageRefreshGate.runForeground(() => performLoadPage(append, options))
		}
		const loadMore = () => loadPage(true)
		let releaseStagedRefresh: (() => void) | undefined
		const stagedRefreshCompleted = stagedRefresh
			? new Promise<void>(resolve => {
					releaseStagedRefresh = resolve
				})
			: undefined
		const queuedLoadMore = async () => {
			const more = context.detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
			if (more !== null) {
				more.disabled = true
				more.setAttribute('aria-busy', 'true')
				more.textContent = 'Loading more transactions…'
			}
			await stagedRefreshCompleted
			return context.activeAccountLoadMore === queuedLoadMore ? false : await context.activeAccountLoadMore?.()
		}
		context.activeAccountLoadMore = stagedRefresh ? queuedLoadMore : loadMore
		let loadRequest: Promise<boolean>
		if (stagedRefresh) {
			loadRequest = context.accountPageRefreshGate.runBackground(async () => {
				const targetCount = stagedSnapshot?.loadedCount ?? 0
				let staged = await performLoadPage(false, {
					background: true,
					stageOnly: true,
					limit: canonicalPageLimit(targetCount, 0, 50),
				})
				while (stagedSnapshot && shouldContinueTransactionRestore(staged, state.loaded.length, stagedSnapshot.loadedCount, state.nextPageCursor))
					staged = await performLoadPage(true, {
						background: true,
						stageOnly: true,
						limit: canonicalPageLimit(stagedSnapshot.loadedCount, state.loaded.length, 50),
					})
				return staged
			})
		} else {
			loadRequest = loadPage(false, { liveRefresh: live && state.loaded.length > 0, background: live })
		}
		pageReservation.release()
		await pageReservation.completed
		let loaded = await loadRequest
		if (!stagedRefresh) {
			while (restoreSnapshot && shouldContinueTransactionRestore(loaded, state.loaded.length, restoreSnapshot.loadedCount, state.nextPageCursor)) loaded = await loadPage(true)
		}
		if (!isCurrentContextRequest(contextVersion, context.detailContextVersion, requestVersion, context.detailRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, context.canonicalDataGeneration)) {
			releaseStagedRefresh?.()
			return false
		}
		if (stagedRefresh) {
			if (!loaded) {
				if (isCurrentContextRequest(contextVersion, context.detailContextVersion, requestVersion, context.detailRequestVersion) && context.dialog.open) {
					context.activeAccountTransactions = previousState
					context.activeAccountLoadMore = previousLoadMore
					context.detailContent.querySelector<HTMLElement>('.account-transactions-error')?.remove()
					if (!canonicalRecovery) {
						const alert = element('div', 'detail-error account-transactions-error')
						alert.setAttribute('role', 'alert')
						alert.append(element('p', '', state.pageError ?? 'Could not refresh sent transactions; showing the last known activity.'))
						const retry = element('button', 'state-retry', 'Retry loading transactions')
						retry.type = 'button'
						retry.addEventListener('click', () => context.openAccountTransactions(account, { live: true }))
						alert.append(retry)
						context.detailContent.prepend(alert)
					}
				}
				releaseStagedRefresh?.()
				return false
			}
			context.activeAccountTransactions = state
			context.activeAccountLoadMore = loadMore
			render({ previous: refreshPrevious, highlight: true })
			releaseStagedRefresh?.()
		}
		if (loaded && stagedSnapshot) restoreAccountDialogSnapshot(stagedSnapshot)
		if (loaded && canonicalRecovery && context.pendingCanonicalAccount && String(context.pendingCanonicalAccount.chain_id) === String(state.account.chain_id) && context.pendingCanonicalAccount.address.toLowerCase() === state.account.address.toLowerCase()) context.pendingCanonicalAccount = undefined
		if (loaded && !canonicalRecovery && context.canonicalRefreshRequired) context.pendingAccountDialogSnapshot = captureAccountDialogSnapshot()
		if (loaded && context.pendingCanonicalAccount === undefined) context.pendingAccountDialogSnapshot = undefined
		return loaded
	}
	return { captureAccountDialogSnapshot, performOpenAccountTransactions }
}
