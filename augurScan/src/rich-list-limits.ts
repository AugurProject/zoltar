/** The deepest rich-list offset the API serves; deeper OFFSET scans are refused to bound query cost. */
export const RICH_LIST_MAX_OFFSET = 100_000

/** Whether another rich-list page exists that the API can serve from the next offset, `loaded`. */
export const richListContinuationAvailable = (loaded: number, total: number): boolean => loaded < total && loaded <= RICH_LIST_MAX_OFFSET
