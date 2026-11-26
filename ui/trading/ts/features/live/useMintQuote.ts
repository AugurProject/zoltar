import { useEffect, useState } from 'preact/hooks'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadBudgetMintState } from '../../protocol/minting.js'
import type { LiveMarket } from '../../protocol/liveMarket.js'
import * as copy from '../../copy/marketBlockers.js'

/** An input-specific public quote validates precision and recovery requirements before displaying a mint estimate. */
export function useMintQuote(market: LiveMarket, budget: bigint | undefined, enabled: boolean): LiveMarket {
	const backend = getActiveBackend()
	const key = `${backend.id}:${market.pool}:${market.mintQuoteEpoch}:${market.valuation?.timestamp}:${budget}:${enabled}`
	const [loaded, setLoaded] = useState<{ key: string; backend: typeof backend; quote?: LiveMarket['mintQuote']; error?: string }>()
	useEffect(() => {
		let current = true
		if (enabled && market.requiresMintQuote && budget !== undefined && budget > 0n) {
			const client = createConnectedReadClient()
			void client
				.getBlock()
				.then(async block => {
					if (block.number === undefined) throw new Error(copy.mintQuoteUnavailable)
					return await loadBudgetMintState(client, market, budget, block.number)
				})
				.then(({ cash, fee }) => {
					if (current && getActiveBackend() === backend) setLoaded({ key, backend, quote: { budget, cash, fee } })
				})
				.catch(error => {
					if (current && getActiveBackend() === backend) setLoaded({ key, backend, error: getErrorMessage(error, copy.mintQuoteUnavailable) })
				})
		}
		return () => {
			current = false
		}
	}, [key, backend])
	if (!enabled || !market.requiresMintQuote) return market
	const selected = loaded?.key === key && loaded.backend === backend ? loaded : undefined
	return { ...market, mintQuote: selected?.quote, mintQuoteError: selected?.error ?? (selected?.quote === undefined ? copy.mintQuoteLoading : undefined) }
}
