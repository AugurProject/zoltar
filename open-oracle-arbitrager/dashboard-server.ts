import { join } from 'node:path'
import type { ConnectivitySettings } from './connectivity.js'
import type { OperatorSnapshot, StrategySettings } from './operator-state.js'
import type { SubmissionSettings } from './transaction-submission.js'

type DashboardController = {
	getSnapshot: () => OperatorSnapshot | Promise<OperatorSnapshot>
	setPaused: (paused: boolean) => void | Promise<void>
	updateConnectivity: (value: unknown) => ConnectivitySettings | Promise<ConnectivitySettings>
	updateSigner: (value: unknown) => { wallet: string | undefined } | Promise<{ wallet: string | undefined }>
	updateStrategy: (value: unknown) => StrategySettings | Promise<StrategySettings>
	updateSubmission: (value: unknown) => SubmissionSettings | Promise<SubmissionSettings>
	updateTokens?: (value: unknown) => readonly string[] | Promise<readonly string[]>
}

function json(value: unknown, status = 200) {
	return Response.json(value, {
		headers: securityHeaders('application/json; charset=utf-8'),
		status,
	})
}

function securityHeaders(contentType: string) {
	return {
		'cache-control': 'no-store',
		'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
		'content-type': contentType,
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
	}
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function sameOrigin(request: Request, authority: string) {
	const origin = request.headers.get('origin')
	return origin !== null && origin === `http://${authority}`
}

async function requireJson(request: Request) {
	if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('Content-Type must be application/json')
	return request.json()
}

export function startDashboardServer(port: number, controller: DashboardController) {
	const directory = import.meta.dir
	const documentationDirectory = join(directory, '..', 'docs')
	const browserSource = Bun.file(join(directory, 'dashboard.ts'))
	const browserFormatSource = Bun.file(join(directory, 'dashboard-format.ts'))
	const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
	let authority = ''
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port,
		async fetch(request) {
			if (request.headers.get('host') !== authority) return json({ error: 'Request authority is not accepted' }, 403)
			const url = new URL(request.url)
			if (request.method === 'GET' && url.pathname === '/') return new Response(Bun.file(join(directory, 'dashboard.html')), { headers: securityHeaders('text/html; charset=utf-8') })
			if (request.method === 'GET' && (url.pathname === '/documentation' || url.pathname === '/documentation/')) {
				return new Response(Bun.file(join(directory, 'documentation.html')), { headers: securityHeaders('text/html; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/README.md') return new Response(Bun.file(join(directory, 'README.md')), { headers: securityHeaders('text/markdown; charset=utf-8') })
			if (request.method === 'GET' && url.pathname === '/docs/open-oracle-integration.html') {
				return new Response(Bun.file(join(documentationDirectory, 'open-oracle-integration.html')), { headers: securityHeaders('text/html; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/favicon.ico') return new Response(undefined, { headers: securityHeaders('image/x-icon'), status: 204 })
			if (request.method === 'GET' && url.pathname === '/dashboard.css') return new Response(Bun.file(join(directory, 'dashboard.css')), { headers: securityHeaders('text/css; charset=utf-8') })
			if (request.method === 'GET' && url.pathname === '/documentation.css') return new Response(Bun.file(join(directory, 'documentation.css')), { headers: securityHeaders('text/css; charset=utf-8') })
			if (request.method === 'GET' && url.pathname === '/docs/shared-docs.css') {
				return new Response(Bun.file(join(documentationDirectory, 'shared-docs.css')), { headers: securityHeaders('text/css; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/docs/chartRuntime.js') {
				return new Response(Bun.file(join(documentationDirectory, 'chartRuntime.js')), { headers: securityHeaders('text/javascript; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/documentation-assets/dashboard-overview.png') {
				return new Response(Bun.file(join(directory, 'documentation-assets', 'dashboard-overview.png')), { headers: securityHeaders('image/png') })
			}
			if (request.method === 'GET' && url.pathname === '/documentation-assets/dashboard-markets.png') {
				return new Response(Bun.file(join(directory, 'documentation-assets', 'dashboard-markets.png')), { headers: securityHeaders('image/png') })
			}
			if (request.method === 'GET' && url.pathname === '/dashboard.js') {
				const source = await browserSource.text()
				return new Response(transpiler.transformSync(source), {
					headers: securityHeaders('text/javascript; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/dashboard-format.js') {
				const source = await browserFormatSource.text()
				return new Response(transpiler.transformSync(source), {
					headers: securityHeaders('text/javascript; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/api/state') {
				try {
					return json(await controller.getSnapshot())
				} catch (error) {
					return json({ error: errorMessage(error) }, 503)
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/settings') {
				if (!sameOrigin(request, authority)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					return json({ settings: await controller.updateStrategy(await requireJson(request)) })
				} catch (error) {
					return json({ error: errorMessage(error) }, 400)
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/submission') {
				if (!sameOrigin(request, authority)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					return json({ submission: await controller.updateSubmission(await requireJson(request)) })
				} catch (error) {
					return json({ error: errorMessage(error) }, 400)
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/connectivity') {
				if (!sameOrigin(request, authority)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					return json({ connectivity: await controller.updateConnectivity(await requireJson(request)) })
				} catch (error) {
					return json({ error: errorMessage(error) }, 400)
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/tokens') {
				if (!sameOrigin(request, authority)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					if (controller.updateTokens === undefined) throw new Error('Token configuration is unavailable')
					return json({ tokenAddresses: await controller.updateTokens(await requireJson(request)) })
				} catch (error) {
					return json({ error: errorMessage(error) }, 400)
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/signer') {
				if (!sameOrigin(request, authority)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					return json(await controller.updateSigner(await requireJson(request)))
				} catch (error) {
					return json({ error: errorMessage(error) }, 400)
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/paused') {
				if (!sameOrigin(request, authority)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					const value = await requireJson(request)
					if (typeof value !== 'object' || value === null || !('paused' in value) || typeof value['paused'] !== 'boolean') throw new Error('paused must be a boolean')
					await controller.setPaused(value['paused'])
					return json({ paused: value['paused'] })
				} catch (error) {
					return json({ error: errorMessage(error) }, 400)
				}
			}
			return new Response('Not found', { status: 404 })
		},
	})
	if (server.port === undefined) {
		server.stop()
		throw new Error('Dashboard server did not expose a listening port')
	}
	authority = `127.0.0.1:${server.port.toString()}`
	console.log(`dashboard=http://${server.hostname}:${server.port}`)
	return server
}
