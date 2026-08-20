import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js'
import type { Address } from '@zoltar/shared/ethereum'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type ChildUniverseDetailsProps = {
	accountAddress: Address | undefined
	child: ZoltarChildUniverseSummary
	isSupportedChain: boolean
	showOutcomeIndex?: boolean
}

export function ChildUniverseDetails({ accountAddress, child, isSupportedChain, showOutcomeIndex = false }: ChildUniverseDetailsProps) {
	return (
		<DataGrid className='child-universe-details-grid'>
			<MetricField label={commonCopy.outcome}>{child.outcomeLabel}</MetricField>
			{showOutcomeIndex ? <MetricField label={commonCopy.outcomeIndex}>{child.outcomeIndex.toString()}</MetricField> : undefined}
			{child.exists ? (
				<MetricField label={commonCopy.reputationToken}>
					<WalletAssetControl accountAddress={accountAddress} address={child.reputationToken} isSupportedChain={isSupportedChain} tokenLabel={`${child.outcomeLabel} ${commonCopy.rep}`} />
				</MetricField>
			) : undefined}
			{child.forkTime !== 0n ? (
				<MetricField label={commonCopy.forkTime}>
					<TimestampValue timestamp={child.forkTime} />
				</MetricField>
			) : undefined}
		</DataGrid>
	)
}
