import * as favoritesCopy from '../copy/favorites.js'
import { useFavorites } from '../hooks/useLocalEntities.js'
import type { LocalEntityApp, LocalEntityKind } from '../lib/localEntityStore.js'

/** A star that is bright when the entity is a favorite and dim otherwise; pressing it toggles the local favorite. */
export function FavoriteToggle({ app, className = '', entityLabel, id, kind }: { app: LocalEntityApp; className?: string; entityLabel: string; id: string; kind: LocalEntityKind }) {
	const favorites = useFavorites(app, kind)
	const favorite = favorites.isFavorite(id)
	return (
		<button
			aria-label={favoritesCopy.formatFavoriteToggleLabel(entityLabel)}
			aria-pressed={favorite}
			className={['favorite-toggle', favorite ? 'is-favorite' : '', className].filter(Boolean).join(' ')}
			onClick={() => favorites.setFavorite(id, !favorite)}
			title={favorite ? favoritesCopy.removeFromFavorites : favoritesCopy.addToFavorites}
			type='button'
		>
			<svg aria-hidden='true' focusable='false' viewBox='0 0 24 24'>
				<path d='M12 2.8l2.84 5.76 6.36.92-4.6 4.49 1.09 6.33L12 17.31l-5.69 2.99 1.09-6.33-4.6-4.49 6.36-.92L12 2.8z' />
			</svg>
		</button>
	)
}
