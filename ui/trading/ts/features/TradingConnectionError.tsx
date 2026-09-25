import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import * as appCopy from '../copy/app.js'
import type { TradingRoute } from '../lib/routing.js'
import { liveRouteLoadingPresentation } from './live/routePresentation.js'

/**
 * Shown on trading routes when the deployment check failed for a reason other than missing contracts, such as an
 * unreachable or mismatched RPC. The route keeps its header and offers a retry instead of the deployment wizard.
 */
export function TradingConnectionError({ message, onRetry, route }: { message: string | undefined; onRetry: () => void; route: TradingRoute }) {
	const routePresentation = liveRouteLoadingPresentation(route)
	return (
		<div className='route-view-flow'>
			<RouteHeader title={routePresentation.title} description={routePresentation.description} />
			<StateHint
				announcement='assertive'
				className='trading-connection-error'
				title={appCopy.tradingContractsUnreachable}
				presentation={{ key: 'load_failed', badgeTone: 'danger', detail: message ?? appCopy.tradingContractsUnreachableFallback, actionHint: appCopy.tradingContractsUnreachableHint }}
				actions={
					<button className='primary' type='button' onClick={onRetry}>
						{appCopy.retry}
					</button>
				}
			/>
		</div>
	)
}
