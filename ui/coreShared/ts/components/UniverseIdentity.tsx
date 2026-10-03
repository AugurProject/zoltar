import { useMemo } from 'preact/hooks'
import { createUniverseIdentity } from '../lib/universeIdentity.js'

/** Decorative recognition aid; the adjacent universe name remains the authoritative identity. */
export function UniverseIdentity({ universeId, variant }: { universeId: bigint; variant: 'backdrop' | 'swatch' }) {
	const identity = useMemo(() => createUniverseIdentity(universeId), [universeId])
	const images = variant === 'backdrop' ? identity.image : identity.swatchImage
	return <span aria-hidden='true' className={`universe-identity universe-identity-${variant}`} data-universe-id={universeId.toString()} style={{ '--universe-image-light': images.light, '--universe-image-dark': images.dark }} />
}
