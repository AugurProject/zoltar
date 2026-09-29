import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { useRepPrices } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'

type RepPriceProbeProps = { captureRefresh?: (refresh: () => void) => void; enabled?: boolean; renderKey?: string }

/**
 * Builds a component that renders `useRepPrices` state as text, so tests can pass a freshly imported hook module.
 * `renderKey` only forces a distinct element when a test rerenders in place.
 */
export function createRepPriceProbe(useRepPricesHook: typeof useRepPrices) {
	return function RepPriceProbe({ captureRefresh, enabled = true }: RepPriceProbeProps) {
		const { isLoadingRepPrices, isRefreshingRepPrices, repPerEthFailure, repPerEthPrice, refreshRepPrices, repUsdcFailure, repUsdcPrice } = useRepPricesHook({ enabled })
		captureRefresh?.(refreshRepPrices)

		return (
			<div>
				<span data-testid='rep-per-eth'>{repPerEthPrice?.toString() ?? '-'}</span>
				<span data-testid='rep-per-eth-failure'>{repPerEthFailure ?? '-'}</span>
				<span data-testid='rep-per-usdc'>{repUsdcPrice?.toString() ?? '-'}</span>
				<span data-testid='rep-per-usdc-failure'>{repUsdcFailure ?? '-'}</span>
				<span data-testid='rep-loading'>{isLoadingRepPrices ? 'loading' : 'ready'}</span>
				<span data-testid='rep-refreshing'>{isRefreshingRepPrices ? 'refreshing' : 'idle'}</span>
				<button type='button' onClick={refreshRepPrices}>
					Refresh REP prices
				</button>
			</div>
		)
	}
}

/** Reads the probe's rendered state. */
export function readRepPriceProbe() {
	const text = (testId: string) => within(document.body).getByTestId(testId).textContent
	return {
		ethFailure: text('rep-per-eth-failure'),
		loading: text('rep-loading'),
		refreshing: text('rep-refreshing'),
		repPerEth: text('rep-per-eth'),
		repPerUsdc: text('rep-per-usdc'),
		usdcFailure: text('rep-per-usdc-failure'),
	}
}
