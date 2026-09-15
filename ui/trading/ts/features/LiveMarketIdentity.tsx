import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { shareBalanceScope, type LiveMarket } from '../protocol/live.js'
import { identityCopy } from '../copy/identity.js'

function marketUniverseIdentity(market: Pick<LiveMarket, 'universeId' | 'originUniverseId'>) {
	return { currentUniverseId: market.universeId, originUniverseId: market.originUniverseId }
}

/** Identity metrics for a SecurityPool; render inside a `DataGrid`. */
export function SecurityPoolIdentityFields({ market }: { market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId' | 'originUniverseId' | 'questionId'> }) {
	const scope = shareBalanceScope(market)
	const identity = marketUniverseIdentity(market)
	return (
		<>
			<MetricField label={identityCopy.securityPoolAddress}>
				<ReadOnlyAddressValue address={scope.pool} responsiveAbbreviation />
			</MetricField>
			<MetricField label={identityCopy.shareTokenAddress}>
				<ReadOnlyAddressValue address={scope.shareToken} responsiveAbbreviation />
			</MetricField>
			<MetricField label={identityCopy.currentUniverseId}>{identity.currentUniverseId.toString()}</MetricField>
			<MetricField label={identityCopy.marketLineageOriginUniverseId}>{identity.originUniverseId?.toString() ?? identityCopy.unavailableOriginUniverse}</MetricField>
			<MetricField label={identityCopy.questionId}>{market.questionId.toString()}</MetricField>
			<MetricField label={identityCopy.outcomeTokenIds}>{identityCopy.outcomeTokenIdSummary(scope.invalidTokenId.toString(), scope.yesTokenId.toString(), scope.noTokenId.toString())}</MetricField>
		</>
	)
}
