import { useEffect, useState } from 'preact/hooks'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { loadRegisteredSecurityPools, type RegisteredSecurityPool } from '../../../protocol/questionLedgers.js'
import * as copy from '../../../copy/securityPool.js'

/** Security pools a visitor can open in this universe without already knowing an address. */
export function useRegisteredSecurityPools({ enabled, environmentKey, universeId }: { enabled: boolean; environmentKey: number; universeId: bigint }) {
	const key = `${environmentKey}:${universeId}`
	const [loaded, setLoaded] = useState<{ key: string; securityPools?: RegisteredSecurityPool[]; error?: string }>({ key })
	const [retrying, setRetrying] = useState(false)
	const [refresh, setRefresh] = useState(0)
	useBlockRefresh(event => {
		if (event.reason === 'invalidate') setRefresh(value => value + 1)
	}, enabled)
	useEffect(() => {
		if (!enabled) return
		let current = true
		void loadRegisteredSecurityPools(createConnectedReadClient(), universeId)
			.then(securityPools => {
				if (current) setLoaded({ key, securityPools })
			})
			.catch(error => {
				// A failed reload keeps the rows already shown here next to the error.
				if (current) setLoaded(previous => ({ key, error: getErrorMessage(error, copy.securityPoolsError), ...(previous.key === key && previous.securityPools !== undefined ? { securityPools: previous.securityPools } : {}) }))
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
		securityPools: state?.securityPools,
		error: state?.error,
		// Loading until the first answer, including while the page waits to read the chain, so an open list is never blank.
		loading: state?.securityPools === undefined && state?.error === undefined,
		// The error and its Retry stay in place while the retry runs.
		retrying,
		retry: () => {
			setRetrying(true)
			setRefresh(value => value + 1)
		},
	}
}
