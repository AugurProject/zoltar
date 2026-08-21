export function shouldRenderAppRouteContent(route: string, readBackendMessage: string | undefined, deploymentRoute = 'deploy') {
	return route === deploymentRoute || readBackendMessage === undefined
}
