import { join } from 'node:path'
import { boundedDashboardJson, dashboardAuthenticationChallenge, dashboardRequestIsAuthenticated, validateDashboardAuthentication } from '@zoltar/bot-shared/dashboard/security'

export type DashboardController = {
	getConfiguration: () => unknown | Promise<unknown>
	getState: () => unknown | Promise<unknown>
	hostname: '0.0.0.0' | '127.0.0.1'
	password?: string | undefined
	setApprovedUniverses: (value: unknown) => unknown | Promise<unknown>
	setMarketConfiguration?: (value: unknown) => unknown | Promise<unknown>
	setNetworkConnectivity?: (value: unknown) => unknown | Promise<unknown>
	setPaused: (value: unknown) => unknown | Promise<unknown>
	reconcileTransaction?: (value: unknown) => unknown | Promise<unknown>
	testMarketSources?: (value: unknown) => unknown | Promise<unknown>
	setSelectedPools: (value: unknown) => unknown | Promise<unknown>
	setSigner: (value: unknown) => unknown | Promise<unknown>
	setStrategy: (value: unknown) => unknown | Promise<unknown>
}

function headers(contentType: string) {
	return {
		'cache-control': 'no-store',
		'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
		'content-type': contentType,
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
	}
}

function json(value: unknown, status = 200) {
	return Response.json(value, {
		headers: headers('application/json; charset=utf-8'),
		status,
	})
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

export function startDashboardServer(port: number, controller: DashboardController) {
	validateDashboardAuthentication(controller.hostname, controller.password)
	const directory = import.meta.dir
	const browserSource = Bun.file(join(directory, 'dashboard.ts'))
	const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
	let authority = ''
	const server = Bun.serve({
		hostname: controller.hostname,
		port,
		async fetch(request) {
			if (request.headers.get('host') !== authority) {
				return json({ error: 'Request authority is not accepted' }, 403)
			}
			if (request.method === 'GET' && new URL(request.url).pathname === '/healthz') return new Response('ok', { headers: headers('text/plain; charset=utf-8') })
			if (!dashboardRequestIsAuthenticated(request, controller.password)) {
				return Response.json({ error: 'Dashboard authentication is required' }, { headers: { ...headers('application/json; charset=utf-8'), ...dashboardAuthenticationChallenge() }, status: 401 })
			}
			const url = new URL(request.url)
			if (request.method === 'GET' && url.pathname === '/') {
				return new Response(Bun.file(join(directory, 'index.html')), {
					headers: headers('text/html; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/dashboard.css') {
				return new Response(Bun.file(join(directory, 'styles.css')), {
					headers: headers('text/css; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/dashboard.js') {
				return new Response(transpiler.transformSync(await browserSource.text()), {
					headers: headers('text/javascript; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/api/state') {
				try {
					return json(await controller.getState())
				} catch (error) {
					return json({ error: errorMessage(error) }, 503)
				}
			}
			if (request.method === 'GET' && url.pathname === '/api/configuration') {
				try {
					return json(await controller.getConfiguration())
				} catch (error) {
					return json({ error: errorMessage(error) }, 503)
				}
			}
			const origin = request.headers.get('origin')
			if (request.method === 'PUT' && origin !== `http://${authority}`) {
				return json({ error: 'Cross-origin requests are not accepted' }, 403)
			}
			const handlers = new Map<string, (value: unknown) => unknown | Promise<unknown>>([
				['/api/approved-universes', controller.setApprovedUniverses],
				['/api/paused', controller.setPaused],
				['/api/selected-pools', controller.setSelectedPools],
				['/api/signer', controller.setSigner],
				['/api/strategy', controller.setStrategy],
			])
			if (controller.setMarketConfiguration !== undefined) handlers.set('/api/market-configuration', controller.setMarketConfiguration)
			if (controller.setNetworkConnectivity !== undefined) handlers.set('/api/network-connectivity', controller.setNetworkConnectivity)
			if (controller.reconcileTransaction !== undefined) handlers.set('/api/reconcile-transaction', controller.reconcileTransaction)
			if (controller.testMarketSources !== undefined) handlers.set('/api/test-market-sources', controller.testMarketSources)
			const handler = handlers.get(url.pathname)
			if (request.method === 'PUT' && handler !== undefined) {
				try {
					return json(await handler(await boundedDashboardJson(request)))
				} catch (error) {
					return json({ error: errorMessage(error) }, 400)
				}
			}
			if (request.method === 'GET' && url.pathname === '/favicon.ico') {
				return new Response(undefined, { headers: headers('image/x-icon'), status: 204 })
			}
			return json({ error: 'Not found' }, 404)
		},
	})
	if (server.port === undefined) throw new Error('Dashboard server did not expose its listening port')
	authority = `127.0.0.1:${server.port.toString()}`
	return server
}
