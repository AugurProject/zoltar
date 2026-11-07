import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { PortfolioAccountSnapshot } from '../../../protocol/securityPoolPortfolio.js'
import { portfolioUnsignedId } from '../lib/draft.js'

type Entry = { question?: MarketDetails; error?: string }

/** Only the current registry page and explicitly selected question are read. */
export function usePortfolioQuestionDetails(snapshot: PortfolioAccountSnapshot | undefined, input: string) {
	const backend = getActiveBackend()
	const selectedId = portfolioUnsignedId(input)
	const ids = [...new Set([...(snapshot?.questions ?? []), ...(selectedId === undefined ? [] : [selectedId])])]
	const key = `${snapshot?.chainId}:${snapshot?.portfolio}:${snapshot?.universeId}:${ids.join(',')}`
	const result = useSignal<{ key: string; backend: typeof backend; entries: Map<bigint, Entry> } | undefined>(undefined)
	const retryCount = useSignal(0)
	useEffect(() => {
		let current = true
		const environment = createActiveEnvironmentGuard()
		result.value = undefined
		if (snapshot === undefined) return
		const client = createConnectedReadClient()
		const entries = new Map<bigint, Entry>()
		for (const id of ids) {
			void loadMarketDetails(client, id)
				.then(question => {
					if (!question.exists) throw new Error('Question details are unavailable.')
					return { question }
				})
				.catch(error => ({ error: getErrorMessage(error, 'Unable to read question details.') }))
				.then(entry => {
					if (!current || !environment.isCurrent()) return
					entries.set(id, entry)
					result.value = { key, backend, entries: new Map(entries) }
				})
		}
		return () => {
			current = false
		}
	}, [key, retryCount.value, snapshot === undefined, backend])
	const entries = result.value?.key === key && result.value.backend === backend ? result.value.entries : undefined
	return {
		entries,
		selected: selectedId === undefined ? undefined : entries?.get(selectedId),
		selectedId,
		retry: () => {
			retryCount.value++
		},
	}
}
