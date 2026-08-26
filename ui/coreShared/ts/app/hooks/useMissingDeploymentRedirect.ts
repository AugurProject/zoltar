import { useEffect, useRef } from 'preact/hooks'

export function useMissingDeploymentRedirect({ isDeploymentRoute, missing, navigateToDeployment }: { isDeploymentRoute: boolean; missing: boolean; navigateToDeployment: () => void }) {
	const navigateToDeploymentRef = useRef(navigateToDeployment)
	navigateToDeploymentRef.current = navigateToDeployment

	useEffect(() => {
		if (!missing || isDeploymentRoute) return
		navigateToDeploymentRef.current()
	}, [isDeploymentRoute, missing])
}
