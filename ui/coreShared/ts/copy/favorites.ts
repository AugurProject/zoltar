import type { CopyTemplateValue } from './types.js'

export const addToFavorites = 'Add to favorites'
export const removeFromFavorites = 'Remove from favorites'
export const formatFavoriteToggleLabel = (entityLabel: CopyTemplateValue) => `Favorite: ${entityLabel}`
export const favorites = 'Favorites'
export const downloaded = 'Downloaded'
export const formatCollectionTab = (label: CopyTemplateValue, count: CopyTemplateValue) => `${label} (${count})`
export const collectionAriaLabel = 'Favorites collection'
export const recentlySaved = 'Recently added'
export const discoverMore = 'Show more'
export const discovering = 'Loading…'
export const formatDiscoveredProgress = (discovered: CopyTemplateValue, total: CopyTemplateValue, noun: CopyTemplateValue) => `${discovered} of ${total} ${noun} checked`
