import * as commonCopy from '../../../copy/common.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { MetricField } from '../../../components/MetricField.js'
import { WalletAssetControl } from '../../../components/WalletAssetControl.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { ZoltarChildUniverseSummary } from '../../../types/contracts.js'

type ChildUniverseDetailsProps = {
	child: ZoltarChildUniverseSummary
	isSupportedChain: boolean
	showOutcomeIndex?: boolean
}

export function ChildUniverseDetails({ child, isSupportedChain, showOutcomeIndex = false }: ChildUniverseDetailsProps) {
	return (
		<DataGrid className='child-universe-details-grid'>
			<MetricField label={commonCopy.outcome}>{child.outcomeLabel}</MetricField>
			{showOutcomeIndex ? <MetricField label={commonCopy.outcomeIndex}>{child.outcomeIndex.toString()}</MetricField> : undefined}
			{child.exists ? (
				<MetricField label={commonCopy.reputationToken}>
					<WalletAssetControl address={child.reputationToken} isSupportedChain={isSupportedChain} tokenLabel={`${formatUniverseLabel(child.universeId)} ${commonCopy.rep}`} />
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
