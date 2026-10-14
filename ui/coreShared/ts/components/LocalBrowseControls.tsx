import type { ComponentChildren } from 'preact'
import * as favoritesCopy from '../copy/favorites.js'
import type { DataFreshness } from '../lib/freshness.js'
import type { LocalBrowseCollection } from '../lib/localEntityBrowse.js'
import { EmptyState } from './EmptyState.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { UpdatedAgo } from './UpdatedAgo.js'
import { ViewTabs } from './ViewTabs.js'

function LocalCollectionSwitcher({ collection, downloadedCount, favoritesCount, onChange }: { collection: LocalBrowseCollection; downloadedCount: number; favoritesCount: number; onChange: (collection: LocalBrowseCollection) => void }) {
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

/** The first page loads automatically; users request only additional bounded pages. */
function DiscoveryControl({ discovery, disabled = false, emphasize = false, nounPlural }: { disabled?: boolean; discovery: DiscoveryState; emphasize?: boolean; nounPlural: string }) {
	if (!discovery.hasScanned) return discovery.loading ? <LoadingText>{favoritesCopy.discovering}</LoadingText> : undefined
	if (!discovery.hasMore) return undefined
	return (
		<div className='discovery-control'>
			<p className='detail' role='status'>
				{favoritesCopy.formatDiscoveredProgress(discovery.scannedItemCount.toString(), discovery.totalCount?.toString() ?? '', nounPlural)}
			</p>
			<button className={emphasize ? 'primary' : 'secondary'} type='button' disabled={disabled || discovery.loading} onClick={discovery.discoverNext}>
				{discovery.loading ? <LoadingText>{favoritesCopy.discovering}</LoadingText> : favoritesCopy.discoverMore}
			</button>
		</div>
	)
}

/** The `useLocalBrowseDirectory` state the shared browse controls read. */
type LocalBrowseDirectoryState = {
	collection: LocalBrowseCollection
	discovery: DiscoveryState
	downloaded: { entries: readonly unknown[] }
	favoriteEntries: readonly unknown[]
	setCollection: (collection: LocalBrowseCollection) => void
}

type LocalBrowseBarProps = {
	directory: LocalBrowseDirectoryState
	disabled?: boolean
	/** Shown once a scan has run. */
	freshness?: DataFreshness | undefined
	nounPlural: string
}

export function LocalBrowseBar({ directory, disabled = false, freshness, nounPlural }: LocalBrowseBarProps) {
	return (
		<div className='local-browse-bar'>
			<LocalCollectionSwitcher collection={directory.collection} downloadedCount={directory.downloaded.entries.length} favoritesCount={directory.favoriteEntries.length} onChange={directory.setCollection} />
			{directory.discovery.hasScanned && freshness !== undefined ? <UpdatedAgo {...freshness} /> : undefined}
			<DiscoveryControl discovery={directory.discovery} disabled={disabled} emphasize={directory.downloaded.entries.length === 0} nounPlural={nounPlural} />
		</div>
	)
}

export function LocalBrowseSearchField({ label, onChange, placeholder, value }: { label: string; onChange: (value: string) => void; placeholder: string; value: string }) {
	return (
		<label className='field'>
			<span>{label}</span>
			<FormInput value={value} onInput={event => onChange(event.currentTarget.value)} placeholder={placeholder} />
		</label>
	)
}

type LocalCollectionEmptyStateProps = {
	directory: LocalBrowseDirectoryState
	/** Offered next to every empty collection, such as opening a pasted identifier directly. */
	action?: ComponentChildren
	copy: {
		downloadedEmpty: string
		favoritesEmpty: string
		favoritesEmptyDetail: string
		favoritesEmptyWithDownloadsDetail: string
		showDownloaded: string
	}
	/** Shown when a completed scan found an empty registry. */
	registryEmpty: ComponentChildren
}

/** Explains an empty local collection: favorites with downloads to show, an empty registry, or nothing downloaded yet. */
export function LocalCollectionEmptyState({ action, copy, directory, registryEmpty }: LocalCollectionEmptyStateProps) {
	if (directory.collection === 'favorites' && directory.downloaded.entries.length > 0)
		return (
			<EmptyState
				title={copy.favoritesEmpty}
				detail={copy.favoritesEmptyWithDownloadsDetail}
				actions={
					<>
						{action}
						<button className='secondary' type='button' onClick={() => directory.setCollection('downloaded')}>
							{copy.showDownloaded}
						</button>
					</>
				}
			/>
		)
	if (directory.discovery.hasScanned && directory.discovery.totalCount === 0n) return <>{registryEmpty}</>
	if (directory.collection === 'favorites') return <EmptyState title={copy.favoritesEmpty} detail={copy.favoritesEmptyDetail} actions={action} />
	return <EmptyState title={copy.downloadedEmpty} actions={action} />
}
