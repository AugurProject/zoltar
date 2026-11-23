import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { shareBalanceScope, type LiveMarket } from '../protocol/live.js'
import { identityCopy } from '../copy/identity.js'

function marketUniverseIdentity(market: Pick<LiveMarket, 'universeId' | 'originUniverseId'>) {
	return { currentUniverseId: market.universeId, originUniverseId: market.originUniverseId }
}

/** Identity metrics for a QuestionLedger; render inside a `DataGrid`. */
export function QuestionLedgerIdentityFields({ market }: { market: Pick<LiveMarket, 'collateral' | 'pool' | 'shareToken' | 'universeId' | 'originUniverseId' | 'questionId'> }) {
	const scope = shareBalanceScope(market)
	const identity = marketUniverseIdentity(market)
	return (
		<>
			<MetricField label={identityCopy.questionLedgerAddress}>
				<AddressValue address={scope.pool} />
			</MetricField>
			<MetricField label={identityCopy.shareTokenAddress}>
				<AddressValue address={scope.shareToken} />
			</MetricField>
			<MetricField label={identityCopy.collateralTokenAddress}>{market.collateral === undefined ? identityCopy.unavailable : <AddressValue address={market.collateral.token} />}</MetricField>
			<MetricField label={identityCopy.currentUniverseId}>{identity.currentUniverseId.toString()}</MetricField>
			<MetricField label={identityCopy.originUniverseId}>{identity.originUniverseId?.toString() ?? identityCopy.unavailable}</MetricField>
			<MetricField label={identityCopy.questionId}>
				<IdentifierValue value={formatQuestionIdHex(market.questionId)} />
			</MetricField>
			<MetricField label={identityCopy.outcomeTokenIds}>{identityCopy.outcomeTokenIdSummary(scope.yesTokenId.toString(), scope.noTokenId.toString(), scope.invalidTokenId.toString())}</MetricField>
		</>
	)
}
