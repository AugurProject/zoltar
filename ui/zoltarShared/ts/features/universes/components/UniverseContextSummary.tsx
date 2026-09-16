import type { ComponentChildren } from 'preact'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as copy from '../../../copy/zoltar.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { UniverseLink } from './UniverseLink.js'
import { formatUniverseDisplayLabel } from '../lib/universe.js'

export function UniverseContextSummary({ universe, children }: { universe: ZoltarUniverseSummary; children?: ComponentChildren }) {
	return (
		<div className='decision-summary'>
			<div className='decision-heading'>
				<h3>{formatUniverseDisplayLabel(universe.universeId)}</h3>
				<Badge tone={universe.hasForked ? 'warning' : 'ok'}>{universe.hasForked ? commonCopy.forked : commonCopy.operational}</Badge>
			</div>
			{universe.hasForked && universe.forkTime > 0n ? (
				<p className='detail'>
					<TimestampValue timestamp={universe.forkTime} />
				</p>
			) : undefined}
			{children}
			<ReadOnlyDetailAccordion title={copy.universeDetails}>
				<MetricField label={commonCopy.universe}>
					<UniverseLink universeId={universe.universeId} />
				</MetricField>
				<MetricField label={marketCopy.parentUniverse}>{universe.universeId === 0n ? commonCopy.none : <UniverseLink universeId={universe.parentUniverseId} />}</MetricField>
				<MetricField label={copy.repSupply}>
					<CurrencyValue value={universe.totalTheoreticalSupplyAttoRep} suffix={universe.reputationTokenSymbol ?? commonCopy.rep} />
				</MetricField>
			</ReadOnlyDetailAccordion>
		</div>
	)
}
