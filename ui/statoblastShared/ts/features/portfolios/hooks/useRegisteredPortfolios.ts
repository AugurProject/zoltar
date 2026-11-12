import { useEffect, useState } from 'preact/hooks'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { loadRegisteredPortfolios, type RegisteredPortfolio } from '../../../protocol/securityPools.js'
import * as copy from '../../../copy/portfolio.js'

/** Portfolios a visitor can open in this universe without already knowing an address. */
export function useRegisteredPortfolios({ enabled, environmentKey, universeId }: { enabled: boolean; environmentKey: number; universeId: bigint }) {
	const key = `${environmentKey}:${universeId}`
	const [loaded, setLoaded] = useState<{ key: string; portfolios?: RegisteredPortfolio[]; error?: string }>({ key })
	const [retrying, setRetrying] = useState(false)
	const [refresh, setRefresh] = useState(0)
	useBlockRefresh(event => {
		if (event.reason === 'invalidate') setRefresh(value => value + 1)
	}, enabled)
	useEffect(() => {
		if (!enabled) return
		let current = true
		void loadRegisteredPortfolios(createConnectedReadClient(), universeId)
			.then(portfolios => {
				if (current) setLoaded({ key, portfolios })
			})
			.catch(error => {
				// A failed reload keeps the rows already shown here next to the error.
				if (current) setLoaded(previous => ({ key, error: getErrorMessage(error, copy.portfoliosError), ...(previous.key === key && previous.portfolios !== undefined ? { portfolios: previous.portfolios } : {}) }))
			})
			.finally(() => {
				if (current) setRetrying(false)
			})
		return () => {
			current = false
		}
	}, [enabled, key, refresh])
	const state = loaded.key === key ? loaded : undefined
	return {
		portfolios: state?.portfolios,
		error: state?.error,
		// Loading until the first answer, including while the page waits to read the chain, so an open list is never blank.
		loading: state?.portfolios === undefined && state?.error === undefined,
		// The error and its Retry stay in place while the retry runs.
		retrying,
		retry: () => {
			setRetrying(true)
			setRefresh(value => value + 1)
		},
	}
}
