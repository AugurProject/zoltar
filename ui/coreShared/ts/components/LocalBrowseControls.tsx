import * as favoritesCopy from '../copy/favorites.js'
import type { LocalBrowseCollection } from '../lib/localEntityBrowse.js'
import { LoadingText } from './LoadingText.js'
import { ViewTabs } from './ViewTabs.js'

export function LocalCollectionSwitcher({ collection, downloadedCount, favoritesCount, onChange }: { collection: LocalBrowseCollection; downloadedCount: number; favoritesCount: number; onChange: (collection: LocalBrowseCollection) => void }) {
	return (
		<ViewTabs
			ariaLabel={favoritesCopy.collectionAriaLabel}
			onChange={onChange}
			options={[
				{ label: favoritesCopy.formatCollectionTab(favoritesCopy.favorites, favoritesCount), value: 'favorites' },
				{ label: favoritesCopy.formatCollectionTab(favoritesCopy.downloaded, downloadedCount), value: 'downloaded' },
			]}
			semantics='switcher'
			size='compact'
			value={collection}
			variant='segmented'
		/>
	)
}

type DiscoveryState = {
	discoverNext: () => void
	hasMore: boolean
	hasScanned: boolean
	loading: boolean
	scannedItemCount: bigint
	totalCount: bigint | undefined
}

/** Scanning the chain is an explicit, one-page-at-a-time action so public RPC users only pay for what they ask for. */
export function DiscoveryControl({ discovery, discoverLabel, disabled = false, emphasize = false, nounPlural }: { disabled?: boolean; discoverLabel: string; discovery: DiscoveryState; emphasize?: boolean; nounPlural: string }) {
	const label = (() => {
		if (!discovery.hasScanned) return discoverLabel
		return discovery.hasMore ? favoritesCopy.discoverMore : favoritesCopy.rescan
	})()
	return (
		<div className='discovery-control'>
			{/* Progress only matters while pages remain; a finished scan is already told by the Scan again label. */}
			{discovery.totalCount === undefined || !discovery.hasMore ? undefined : (
				<p className='detail' role='status'>
					{favoritesCopy.formatDiscoveredProgress(discovery.scannedItemCount.toString(), discovery.totalCount.toString(), nounPlural)}
				</p>
			)}
			<button className={emphasize ? 'primary' : 'secondary'} type='button' disabled={disabled || discovery.loading} onClick={discovery.discoverNext}>
				{discovery.loading ? <LoadingText>{favoritesCopy.discovering}</LoadingText> : label}
			</button>
		</div>
	)
}
