export interface ActivityRouteState {
	nextCursor: string | undefined
	appliedFilters: { event: string; address: string }
	requestVersion: number
	paginationIntentVersion: number
	abortController: AbortController | undefined
}

export const createActivityRouteState = (filters: { event: string; address: string }): ActivityRouteState => ({
	nextCursor: undefined,
	appliedFilters: { ...filters },
	requestVersion: 0,
	paginationIntentVersion: 0,
	abortController: undefined,
})
