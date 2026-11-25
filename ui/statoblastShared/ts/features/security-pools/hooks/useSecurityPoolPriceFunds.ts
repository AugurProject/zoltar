import { useEffect, useMemo, useState } from 'preact/hooks'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { loadSecurityPoolPriceFunds, securityPoolPriceFundsCache } from '../../../protocol/securityPoolPrice.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import * as copy from '../../../copy/securityPoolPrice.js'

/** Reads refund availability as part of the forked pool page, whichever tab is open. */
export function useSecurityPoolPriceFunds(snapshot: SecurityPoolAccountSnapshot | undefined, shown: SecurityPoolAccountSnapshot | undefined, wallet: Address | undefined, enabled: boolean) {
	const backend = getActiveBackend()
	const pool = shown?.forkTime === undefined || shown.forkTime === 0n || shown.priceFeed === zeroAddress ? undefined : shown.securityPool
	const universeId = shown?.universeId
	const cache = useMemo(() => {
		if (pool === undefined || universeId === undefined || wallet === undefined) return undefined
		return securityPoolPriceFundsCache(backend.profile, pool, universeId, wallet)
	}, [backend, pool, universeId, wallet])
	const saved = useMemo(() => cache?.read()?.value, [cache])
	const [confirmed, setConfirmed] = useState<{ cache: typeof cache; ids: readonly bigint[] }>()
	useEffect(() => {
		if (!enabled || cache === undefined || wallet === undefined || snapshot === undefined || snapshot.forkTime === 0n || snapshot.securityPool !== pool || snapshot.universeId !== universeId) return
		const guard = createActiveEnvironmentGuard()
		const abort = new AbortController()
		const client = withStatoblastRequestTimeout(createConnectedReadClient(), copy.readTimeout, abort.signal)
		void loadSecurityPoolPriceFunds(client, backend.profile, snapshot, wallet)
			.then(ids => {
				if (abort.signal.aborted || !guard.isCurrent()) return
				cache.write(ids, { number: snapshot.blockNumber, timestamp: snapshot.timestamp })
				setConfirmed({ cache, ids })
			})
			.catch(() => undefined)
		return () => abort.abort()
	}, [backend, cache, enabled, snapshot])
	return confirmed?.cache === cache ? confirmed?.ids : saved
}
