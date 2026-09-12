import { join } from 'node:path'
import { dashboardSecurityHeaders } from './security.ts'

export async function buildDashboardScript(entrypoint: string) {
	const result = await Bun.build({ entrypoints: [entrypoint], target: 'browser' })
	const output = result.outputs[0]
	if (!result.success || output === undefined) throw new Error(`Unable to build dashboard: ${result.logs.map(log => log.message).join('; ')}`)
	return await output.text()
}

export function dashboardHealthResponse() {
	return new Response('ok', { headers: dashboardSecurityHeaders('text/plain; charset=utf-8') })
}

export async function sharedDashboardAssetResponse(pathname: string, faviconPath: string) {
	if (pathname === '/operator-console.css') return new Response(Bun.file(join(import.meta.dir, 'operator-console.css')), { headers: dashboardSecurityHeaders('text/css; charset=utf-8') })
	if (pathname === '/header-notices.js') return new Response(await buildDashboardScript(join(import.meta.dir, 'header-notices.ts')), { headers: dashboardSecurityHeaders('text/javascript; charset=utf-8') })
	if (pathname === '/favicon.svg') return new Response(Bun.file(faviconPath), { headers: dashboardSecurityHeaders('image/svg+xml') })
	if (pathname === '/favicon.ico') return new Response(undefined, { headers: dashboardSecurityHeaders('image/x-icon'), status: 204 })
	return undefined
}
