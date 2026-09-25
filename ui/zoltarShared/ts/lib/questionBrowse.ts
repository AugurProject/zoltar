import { matchesLocalSearch } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import { createDownloadedEntityStore } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredMarketDetails } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'

export const questionDownloadStore = createDownloadedEntityStore(decodeStoredMarketDetails)

export function questionMatchesSearch(question: MarketDetails, normalizedSearchText: string) {
	return matchesLocalSearch(normalizedSearchText, [question.questionId, question.title, question.description])
}
