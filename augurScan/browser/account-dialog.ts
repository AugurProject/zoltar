import type { AccountDetailOptions, AccountReference, ArgumentDefinition, DialogSnapshot, ProtocolAddressLinkOptions } from './browser-types.ts'
import type { ActivityDetailState } from './activity-detail-state.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { RefreshGate } from './live-update.ts'
import { accountStateDuringStagedRefresh, canonicalPageLimit, isCurrentCanonicalGeneration, isCurrentContextRequest, isCurrentLiveRequest, mergeUniqueRecords, paginationRequestAllowed, reconcilePaginatedTotal, refreshPresentation, shouldContinueTransactionRestore, transactionRetryMode } from './live-update.ts'
import { decodeItemsPage, isAccountTransaction } from './api-decoding.ts'
import { exactUnit } from './format.ts'
import { short } from './identifier-format.ts'

interface AccountDialogDeps {
	activityDetailState: ActivityDetailState
	canonicalState: CanonicalState
	accountPageRefreshGate: RefreshGate
	getIsRichList: () => boolean
	detailContent: HTMLElement
	dialog: HTMLDialogElement
	lookup: (selector: string) => HTMLElement
	syncCanonicalDialogStatus: () => void
	removeEventDrawers: () => void
	liveSnapshot: (container: ParentNode, selector?: string) => Map<string, string>
	setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	number: (value: string | number | bigint | null | undefined) => string
	time: (value: string | number | Date | null | undefined) => string
	nativeSymbol: (chainId?: string) => string
	internalEvidenceLink: (base: string, type: string, value: string | number, label: string) => HTMLAnchorElement
	protocolAddressLink: (address: string | null, options?: ProtocolAddressLinkOptions) => HTMLAnchorElement
	decodedArgumentsTable: (schema: ArgumentDefinition[] | null | undefined, raw: Record<string, unknown> | null | undefined, display: Record<string, unknown> | null | undefined, chainId: string) => HTMLTableElement
	applyLiveChanges: (container: ParentNode, previous: ReadonlyMap<string, string>, options?: { live?: boolean; selector?: string }) => { added: number; changed: number }
	api: (path: string) => Promise<unknown>
	selectedChainId: () => string
	errorMessage: (error: unknown) => string
	accountTransactionsError: (detail: string, hasLoaded: boolean, append: boolean) => string
	stagedAccountDialogSnapshot: (canonicalRecovery: boolean, stagedLiveRefresh: boolean, restoreSnapshot: DialogSnapshot | undefined) => DialogSnapshot | undefined
	restoreAccountDialogSnapshot: (snapshot: DialogSnapshot) => void
	captureAccountDialogSnapshot: () => DialogSnapshot | undefined
	restorePendingCanonicalAccount: () => Promise<boolean>
	openAccountTransactions: (account: AccountReference, options?: AccountDetailOptions) => Promise<boolean>
}

export const createAccountTransactionLoader = (deps: AccountDialogDeps) => {
	const {
		activityDetailState,
		canonicalState,
		accountPageRefreshGate,
		detailContent,
		dialog,
		syncCanonicalDialogStatus,
		removeEventDrawers,
		liveSnapshot,
		setLiveRecord,
		element,
		number,
		time,
		nativeSymbol,
		internalEvidenceLink,
		protocolAddressLink,
		decodedArgumentsTable,
		applyLiveChanges,
		api,
		selectedChainId,
		errorMessage,
		accountTransactionsError,
		stagedAccountDialogSnapshot,
		restoreAccountDialogSnapshot,
		captureAccountDialogSnapshot,
		restorePendingCanonicalAccount,
		openAccountTransactions,
	} = deps
	const $ = deps.lookup
	const isRichList = deps.getIsRichList
	const performOpenAccountTransactions = async (account: AccountReference, { live = false, restoreSnapshot, canonicalRecovery = false, contextVersion }: AccountDetailOptions = {}): Promise<boolean> => {
		if (contextVersion !== activityDetailState.detailContextVersion) return false
		const canonicalGeneration = canonicalState.dataGeneration
		const pageReservation = accountPageRefreshGate.reserve()
		await pageReservation.ready
		if (contextVersion !== activityDetailState.detailContextVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) {
			pageReservation.release()
			await pageReservation.completed
			return false
		}
		const previousState = activityDetailState.activeAccountTransactions
		const previousLoadMore = activityDetailState.activeAccountLoadMore
		const stateKey = `${account.chain_id}:${account.address.toLowerCase()}`
		const previousMatches = previousState?.key === stateKey
		const requestVersion = live && previousMatches ? activityDetailState.detailRequestVersion : ++activityDetailState.detailRequestVersion
		const stagedLiveRefresh = !canonicalRecovery && live && previousMatches
		const stagedRefresh = canonicalRecovery || stagedLiveRefresh
		const stagedSnapshot = stagedAccountDialogSnapshot(canonicalRecovery, stagedLiveRefresh, restoreSnapshot)
		const refreshPrevious = stagedRefresh ? liveSnapshot(detailContent, '.account-transaction[data-live-key]') : undefined
		activityDetailState.activeLog = undefined
		removeEventDrawers()
		activityDetailState.pendingCanonicalLog = undefined
		if (restoreSnapshot === undefined && !live) {
			activityDetailState.pendingCanonicalAccount = canonicalState.recovery === undefined && !canonicalState.refreshRequired ? undefined : account
			activityDetailState.pendingAccountDialogSnapshot = undefined
			if (canonicalState.recovery !== undefined) {
				canonicalState.recovery.logToRefresh = undefined
				canonicalState.recovery.accountToRefresh = account
			}
		}
		activityDetailState.activeAccount = account
		if (!dialog.open) dialog.showModal()
		syncCanonicalDialogStatus()
		$('#detail-eyebrow').textContent = 'Account activity'
		$('#detail-title').textContent = 'Sent transactions'
		const url = new URL(location.href)
		url.searchParams.delete('log')
		if (isRichList()) url.searchParams.set('account', `${account.chain_id}:${account.address}`)
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
		activityDetailState.activeAccountTransactions = accountStateDuringStagedRefresh(previousState, state, stagedRefresh)
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
			const visibleCards = [...detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')]
			const anchorCard = focusedCard ?? visibleCards.find(card => card.getBoundingClientRect().bottom > dialog.getBoundingClientRect().top)
			const anchorKey = anchorCard?.dataset.liveKey
			const anchorTop = anchorCard?.getBoundingClientRect().top
			const openTransactionKeys = new Set([...detailContent.querySelectorAll<HTMLElement>('.account-transaction-action[open]')].map(action => action.closest<HTMLElement>('.account-transaction[data-live-key]')?.dataset.liveKey))
			const header = element('div', 'account-transactions-header')
			header.append(element('p', 'eyebrow', 'Sent transactions'), element('h3', '', state.account.label ?? state.account.address), element('code', '', state.account.address), element('p', 'data-note', `${number(state.loaded.length)} of ${number(state.total)} sent transactions`))
			const list = element('div', 'account-transactions')
			for (const transaction of state.loaded) {
				const transactionKey = `${transaction.chain_id}:${transaction.tx_hash}`
				const card = setLiveRecord(element('article', 'account-transaction'), transactionKey, transaction)
				const cardHeader = element('div', 'account-transaction-header')
				cardHeader.append(internalEvidenceLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 12, 8)), element('span', `badge${transaction.status === 'success' ? '' : ' transaction-failed'}`, transaction.status ?? 'unknown'))
				const destination = transaction.to_label ? `${transaction.to_label} · ${short(transaction.to_address, 8, 6)}` : (transaction.to_address ?? 'Contract creation')
				const detailGrid = element('dl', 'account-transaction-fields')
				for (const [term, value] of [
					['Block', `#${number(transaction.block_number)} · ${time(transaction.block_timestamp)}`],
					['To', destination],
					['Value', exactUnit(transaction.value, 18, nativeSymbol(transaction.chain_id))],
					['Gas used', number(transaction.gas_used)],
					['Action', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'],
				]) {
					const field = element('div')
					const description = element('dd', '', term === 'To' && transaction.to_address ? undefined : value)
					if (term === 'To' && transaction.to_address)
						description.append(
							protocolAddressLink(transaction.to_address, {
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
					argumentsContent.append(decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id))
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
			more.hidden = canonicalState.refreshRequired || state.nextPageCursor === undefined || (state.pageError !== undefined && state.pageErrorAppend)
			more.disabled = canonicalState.refreshRequired || state.pageLoading
			more.addEventListener('click', () => activityDetailState.activeAccountLoadMore?.())
			const content: Node[] = [header]
			let transactionError: HTMLDivElement | undefined
			if (state.pageError) {
				transactionError = element('div', `detail-error account-transactions-error${state.pageErrorAppend ? ' append-error' : ''}`)
				transactionError.setAttribute('role', 'alert')
				transactionError.append(element('p', '', state.pageError))
				const retry = element('button', 'state-retry', 'Retry loading transactions')
				retry.type = 'button'
				retry.addEventListener('click', () => {
					if (activityDetailState.pendingCanonicalAccount && activityDetailState.pendingAccountDialogSnapshot) return restorePendingCanonicalAccount()
					const retryMode = transactionRetryMode(state.pageErrorAppend, state.loaded.length > 0)
					return loadPage(retryMode.append, { liveRefresh: retryMode.liveRefresh })
				})
				transactionError.append(retry)
				if (!state.pageErrorAppend) content.push(transactionError)
			}
			content.push(list)
			if (transactionError !== undefined && state.pageErrorAppend) content.push(transactionError)
			content.push(more)
			detailContent.replaceChildren(...content)
			const nextAnchor = anchorKey ? detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(anchorKey)}"]`) : undefined
			if (nextAnchor && anchorTop !== undefined) dialog.scrollTop += nextAnchor.getBoundingClientRect().top - anchorTop
			if (focusedTransactionKey && focusedControlIndex >= 0) {
				const nextFocusedCard = detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(focusedTransactionKey)}"]`)
				const nextControls = nextFocusedCard ? [...nextFocusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
				nextControls[focusedControlIndex]?.focus({ preventScroll: true })
			} else if (outsideFocusKey === 'show-more-transactions') {
				detailContent.querySelector<HTMLElement>('[data-live-focus="show-more-transactions"]')?.focus({ preventScroll: true })
			}
			applyLiveChanges(list, previous, { live: highlight, selector: '.account-transaction[data-live-key]' })
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
			if (!stageOnly && !paginationRequestAllowed(append, canonicalState.refreshRequired)) {
				const more = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
				if (more !== null) {
					more.hidden = true
					more.disabled = true
				}
				return false
			}
			state.pageLoading = true
			state.pageError = undefined
			state.pageErrorAppend = false
			detailContent.setAttribute('aria-busy', String(refreshPresentation({ live: background, append }).busy))
			const previous = liveSnapshot(detailContent, '.account-transaction[data-live-key]')
			const previousLoaded = state.loaded
			const previousTotal = state.total
			const previousCursor = state.nextPageCursor
			if (!append && !liveRefresh && !stageOnly && state.loaded.length === 0) {
				const loading = element('p', 'detail-status', 'Loading sent transactions…')
				loading.setAttribute('role', 'status')
				detailContent.replaceChildren(loading, element('div', 'loading-line'))
			} else if (append && !stageOnly) render()
			try {
				const query = new URLSearchParams({
					chainId: String(state.account.chain_id),
					address: state.account.address,
					limit: String(limit),
				})
				if (append && state.nextPageCursor) query.set('cursor', state.nextPageCursor)
				const result = decodeItemsPage(await api(`/api/v1/address-transactions?${query}`), isAccountTransaction, 'Address transactions')
				if (contextVersion !== activityDetailState.detailContextVersion || !isCurrentLiveRequest(requestVersion, activityDetailState.detailRequestVersion, state.account.chain_id, selectedChainId()) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) {
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
				if (!isCurrentContextRequest(contextVersion, activityDetailState.detailContextVersion, requestVersion, activityDetailState.detailRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) {
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
					state.pageError = append ? `Could not load more transactions; showing the last known activity: ${recoveryError ?? errorMessage(error)}` : `Could not refresh sent transactions; showing the last known activity: ${recoveryError ?? errorMessage(error)}`
					if (!stageOnly) render()
					return false
				}
				state.pageLoading = false
				state.pageErrorAppend = append
				state.pageError = accountTransactionsError(errorMessage(error), state.loaded.length > 0, append)
				if (!stageOnly) render()
				return false
			} finally {
				if (isCurrentContextRequest(contextVersion, activityDetailState.detailContextVersion, requestVersion, activityDetailState.detailRequestVersion)) detailContent.setAttribute('aria-busy', 'false')
			}
		}
		const loadPage = (append = false, options: AccountPageOptions = {}) => {
			if (append && options.background !== true) {
				const more = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
				if (more !== null) {
					more.disabled = true
					more.setAttribute('aria-busy', 'true')
					more.textContent = 'Loading more transactions…'
				}
				detailContent.setAttribute('aria-busy', 'true')
			}
			return options.background === true ? accountPageRefreshGate.runBackground(() => performLoadPage(append, options)) : accountPageRefreshGate.runForeground(() => performLoadPage(append, options))
		}
		const loadMore = () => loadPage(true)
		let releaseStagedRefresh: (() => void) | undefined
		const stagedRefreshCompleted = stagedRefresh
			? new Promise<void>(resolve => {
					releaseStagedRefresh = resolve
				})
			: undefined
		const queuedLoadMore = async () => {
			const more = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
			if (more !== null) {
				more.disabled = true
				more.setAttribute('aria-busy', 'true')
				more.textContent = 'Loading more transactions…'
			}
			await stagedRefreshCompleted
			return activityDetailState.activeAccountLoadMore === queuedLoadMore ? false : await activityDetailState.activeAccountLoadMore?.()
		}
		activityDetailState.activeAccountLoadMore = stagedRefresh ? queuedLoadMore : loadMore
		let loadRequest: Promise<boolean>
		if (stagedRefresh) {
			loadRequest = accountPageRefreshGate.runBackground(async () => {
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
		if (!isCurrentContextRequest(contextVersion, activityDetailState.detailContextVersion, requestVersion, activityDetailState.detailRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) {
			releaseStagedRefresh?.()
			return false
		}
		if (stagedRefresh) {
			if (!loaded) {
				if (isCurrentContextRequest(contextVersion, activityDetailState.detailContextVersion, requestVersion, activityDetailState.detailRequestVersion) && dialog.open) {
					activityDetailState.activeAccountTransactions = previousState
					activityDetailState.activeAccountLoadMore = previousLoadMore
					detailContent.querySelector<HTMLElement>('.account-transactions-error')?.remove()
					if (!canonicalRecovery) {
						const alert = element('div', 'detail-error account-transactions-error')
						alert.setAttribute('role', 'alert')
						alert.append(element('p', '', state.pageError ?? 'Could not refresh sent transactions; showing the last known activity.'))
						const retry = element('button', 'state-retry', 'Retry loading transactions')
						retry.type = 'button'
						retry.addEventListener('click', () => openAccountTransactions(account, { live: true }))
						alert.append(retry)
						detailContent.prepend(alert)
					}
				}
				releaseStagedRefresh?.()
				return false
			}
			activityDetailState.activeAccountTransactions = state
			activityDetailState.activeAccountLoadMore = loadMore
			render({ previous: refreshPrevious, highlight: true })
			releaseStagedRefresh?.()
		}
		if (loaded && stagedSnapshot) restoreAccountDialogSnapshot(stagedSnapshot)
		if (loaded && canonicalRecovery && activityDetailState.pendingCanonicalAccount && String(activityDetailState.pendingCanonicalAccount.chain_id) === String(state.account.chain_id) && activityDetailState.pendingCanonicalAccount.address.toLowerCase() === state.account.address.toLowerCase())
			activityDetailState.pendingCanonicalAccount = undefined
		if (loaded && !canonicalRecovery && canonicalState.refreshRequired) activityDetailState.pendingAccountDialogSnapshot = captureAccountDialogSnapshot()
		if (loaded && activityDetailState.pendingCanonicalAccount === undefined) activityDetailState.pendingAccountDialogSnapshot = undefined
		return loaded
	}

	return performOpenAccountTransactions
}
