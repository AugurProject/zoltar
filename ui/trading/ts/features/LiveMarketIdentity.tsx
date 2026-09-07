import { TradingAddressValue } from '../components/TradingAddress.js'
import { shareBalanceScope, type LiveMarket } from '../protocol/live.js'

export function marketUniverseIdentity(market: Pick<LiveMarket, 'universeId' | 'originUniverseId'>) {
	return { currentUniverseId: market.universeId, originUniverseId: market.originUniverseId }
}

export function SecurityPoolIdentityRows({ market }: { market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId' | 'originUniverseId' | 'questionId'> }) {
	const scope = shareBalanceScope(market)
	const identity = marketUniverseIdentity(market)
	return (
		<>
			<div>
				<dt>Security pool address</dt>
				<dd>
					<TradingAddressValue value={scope.pool} />
				</dd>
			</div>
			<div>
				<dt>Share token address</dt>
				<dd>
					<TradingAddressValue value={scope.shareToken} />
				</dd>
			</div>
			<div>
				<dt>Current universe ID</dt>
				<dd>{identity.currentUniverseId.toString()}</dd>
			</div>
			<div>
				<dt>Market lineage origin universe ID</dt>
				<dd>{identity.originUniverseId?.toString() ?? 'Unavailable'}</dd>
			</div>
			<div>
				<dt>Question ID</dt>
				<dd>{market.questionId.toString()}</dd>
			</div>
			<div>
				<dt>Outcome token IDs</dt>
				<dd>
					INVALID {scope.invalidTokenId.toString()} · YES {scope.yesTokenId.toString()} · NO {scope.noTokenId.toString()}
				</dd>
			</div>
		</>
	)
}
