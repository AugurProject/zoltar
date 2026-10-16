import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

export type DiscoveredPage<TItem> = Readonly<{
	items: readonly TItem[]
	pageIndex: number
	pageSize: number
	requestKey?: string | undefined
	totalCount: bigint
}>

type PagedDiscoveryOptions<TItem> = {
	/** Changing the context (network, account, environment) restarts the scan from the first page. */
	contextKey: string
	loadPage: (pageIndex: number, requestKey: string) => Promise<unknown> | void
	onItems: (items: readonly TItem[]) => void
	pageSize: number
	receivedPage: DiscoveredPage<TItem> | undefined
}

function getDiscoveryRequestKey(contextKey: string, pageIndex: number, pageSize: number, nonce: number) {
	return `${contextKey}:${pageIndex.toString()}:${pageSize.toString()}:${nonce.toString()}`
}

type DiscoveryRequest = Readonly<{ contextKey: string; key: string; pageIndex: number }>

/** A page that echoes its request key must match it exactly; one without a key is accepted once its load has settled. */
function matchesDiscoveryRequest<TItem>(page: DiscoveredPage<TItem>, request: DiscoveryRequest | undefined, pageSize: number, loading: boolean) {
	if (request === undefined || page.pageIndex !== request.pageIndex || page.pageSize !== pageSize) return false
	if (page.requestKey !== undefined) return page.requestKey === request.key
	return !loading
}

/**
 * Loads the first registry page automatically, then one additional page per user request.
 * Each result joins the downloaded cache once, so search covers every downloaded page.
 */
export function usePagedDiscovery<TItem>({ contextKey, loadPage, onItems, pageSize, receivedPage }: PagedDiscoveryOptions<TItem>) {
	const [scan, setScan] = useState<{ contextKey: string; scannedPageCount: number; totalCount: bigint | undefined }>({ contextKey, scannedPageCount: 0, totalCount: undefined })
	const [pendingRequestKey, setPendingRequestKey] = useState<string | undefined>(undefined)
	const [loadFailed, setLoadFailed] = useState(false)
	const lastRequestRef = useRef<DiscoveryRequest | undefined>(undefined)
	const requestNonceRef = useRef(0)
	const onItemsRef = useRef(onItems)
	const loadPageRef = useRef(loadPage)
	const receivedPageRef = useRef(receivedPage)
	const pageBeforeRequestRef = useRef<DiscoveredPage<TItem> | undefined>(undefined)
	onItemsRef.current = onItems
	loadPageRef.current = loadPage
	receivedPageRef.current = receivedPage
	const currentScan = scan.contextKey === contextKey ? scan : { contextKey, scannedPageCount: 0, totalCount: undefined }

	const loading = pendingRequestKey !== undefined
	useEffect(() => {
		const request = lastRequestRef.current
		if (receivedPage === undefined || receivedPage === pageBeforeRequestRef.current || request?.contextKey !== contextKey || !matchesDiscoveryRequest(receivedPage, request, pageSize, loading)) return
		lastRequestRef.current = undefined
		onItemsRef.current(receivedPage.items)
		setScan({ contextKey, scannedPageCount: receivedPage.pageIndex + 1, totalCount: receivedPage.totalCount })
	}, [contextKey, loading, pageSize, receivedPage])

	const requestPage = useCallback(
		(pageIndex: number) => {
			requestNonceRef.current += 1
			const requestKey = getDiscoveryRequestKey(contextKey, pageIndex, pageSize, requestNonceRef.current)
			lastRequestRef.current = { contextKey, key: requestKey, pageIndex }
			pageBeforeRequestRef.current = receivedPageRef.current
			setLoadFailed(false)
			setPendingRequestKey(requestKey)
			const load = loadPageRef.current
			void Promise.resolve()
				.then(() => load(pageIndex, requestKey))
				.catch(() => {
					if (lastRequestRef.current?.key === requestKey) setLoadFailed(true)
				})
				.finally(() => {
					setPendingRequestKey(current => (current === requestKey ? undefined : current))
				})
		},
		[contextKey, pageSize],
	)

	useEffect(() => {
		setScan({ contextKey, scannedPageCount: 0, totalCount: undefined })
		requestPage(0)
		return () => {
			lastRequestRef.current = undefined
		}
	}, [contextKey, requestPage])

	const scannedItemCount = (() => {
		const scanned = BigInt(currentScan.scannedPageCount * pageSize)
		if (currentScan.totalCount === undefined) return scanned
		return scanned < currentScan.totalCount ? scanned : currentScan.totalCount
	})()
	const hasMore = currentScan.totalCount === undefined || scannedItemCount < currentScan.totalCount
	return {
		discoverNext: () => requestPage(hasMore ? currentScan.scannedPageCount : 0),
		hasMore,
		hasScanned: currentScan.totalCount !== undefined,
		loadFailed,
		loading,
		retry: () => requestPage(currentScan.scannedPageCount),
		scannedItemCount,
		totalCount: currentScan.totalCount,
	}
}
