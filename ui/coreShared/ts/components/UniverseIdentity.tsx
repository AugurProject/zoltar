import { useMemo } from 'preact/hooks'
import { createUniverseIdentity } from '../lib/universeIdentity.js'

/** Decorative recognition aid; the adjacent universe name remains the authoritative identity. */
export function UniverseIdentity({ universeId, variant }: { universeId: bigint; variant: 'backdrop' | 'swatch' | 'band' }) {
	const identity = useMemo(() => createUniverseIdentity(universeId), [universeId])
	const images = { backdrop: identity.image, band: identity.bandImage, swatch: identity.swatchImage }
	return <span aria-hidden='true' className={`universe-identity universe-identity-${variant}`} data-universe-id={universeId.toString()} style={{ '--universe-image': images[variant], '--universe-ink': identity.ink }} />
}
