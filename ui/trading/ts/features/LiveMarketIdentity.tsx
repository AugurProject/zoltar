import { TradingAddressValue } from '../components/TradingAddress.js'
import { shareBalanceScope, type LiveMarket } from '../protocol/live.js'
import * as identityCopy from '../copy/identity.js'

export function marketUniverseIdentity(market: Pick<LiveMarket, 'universeId' | 'originUniverseId'>) {
	return { currentUniverseId: market.universeId, originUniverseId: market.originUniverseId }
}

export function SecurityPoolIdentityRows({ market }: { market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId' | 'originUniverseId' | 'questionId'> }) {
	const scope = shareBalanceScope(market)
	const identity = marketUniverseIdentity(market)
	return (
		<>
			<div>
				<dt>{identityCopy.securityPoolAddress}</dt>
				<dd>
					<TradingAddressValue value={scope.pool} />
				</dd>
			</div>
			<div>
				<dt>{identityCopy.shareTokenAddress}</dt>
				<dd>
					<TradingAddressValue value={scope.shareToken} />
				</dd>
			</div>
			<div>
				<dt>{identityCopy.currentUniverseId}</dt>
				<dd>{identity.currentUniverseId.toString()}</dd>
			</div>
			<div>
				<dt>{identityCopy.marketLineageOriginUniverseId}</dt>
				<dd>{identity.originUniverseId?.toString() ?? identityCopy.unavailableOriginUniverse}</dd>
			</div>
			<div>
				<dt>{identityCopy.questionId}</dt>
				<dd>{market.questionId.toString()}</dd>
			</div>
			<div>
				<dt>{identityCopy.outcomeTokenIds}</dt>
				<dd>{identityCopy.outcomeTokenIdSummary(scope.invalidTokenId.toString(), scope.yesTokenId.toString(), scope.noTokenId.toString())}</dd>
			</div>
		</>
	)
}
