import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { useUniverseName } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import { formatRelativeTimestamp, getWallClockTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/watchlist.js'
import type { StatoblastPoolPage, StatoblastQuestionPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'

export function RecentWatchlistMetadata({ page, collateral, openedAt, universe }: { page: StatoblastPoolPage | StatoblastQuestionPage; collateral: string | undefined; openedAt: number; universe: bigint }) {
	const name = useUniverseName(universe)
	const opened = BigInt(Math.floor(openedAt / 1_000))
	const now = getWallClockTimestamp()
	const age = formatRelativeTimestamp(opened > now ? now : opened, now)
	return (
		<small>
			{copy.securityPool}
			{page.kind === 'question' && (
				<>
					{' '}
					<AddressValue longAbbreviation address={page.pool} />
				</>
			)}
			{page.kind === 'pool' && collateral !== undefined ? `, ${collateral}` : undefined}
			{copy.formatOpened(age)}
			{copy.formatRecentUniverse(name)}
		</small>
	)
}
