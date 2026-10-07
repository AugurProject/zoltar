import { useEffect, useRef } from 'preact/hooks'
import { redirectInPlace } from '../../navigation/historyEntries.js'

/**
 * Sends every other route to deployment while required contracts are missing. The redirect replaces the redirected
 * history entry, so Back leaves the application instead of reopening that route and being redirected again.
 */
export function useMissingDeploymentRedirect({ isDeploymentRoute, missing, navigateToDeployment }: { isDeploymentRoute: boolean; missing: boolean; navigateToDeployment: () => void }) {
	const navigateToDeploymentRef = useRef(navigateToDeployment)
	navigateToDeploymentRef.current = navigateToDeployment

	useEffect(() => {
		if (!missing || isDeploymentRoute) return
		redirectInPlace(() => navigateToDeploymentRef.current())
	}, [isDeploymentRoute, missing])
}
