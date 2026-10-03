import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { join } from 'node:path'
import { buildDashboardScript, dashboardHealthResponse, sharedDashboardAssetResponse } from './assets.ts'
import { dashboardAuthenticationChallenge, dashboardAuthorities, dashboardJson, dashboardRequestAuthorityIsAccepted, dashboardRequestIsAuthenticated, dashboardRequestIsSameOrigin, dashboardSecurityHeaders, validateDashboardAuthentication } from './security.ts'

/**
 * How the dashboard may be reached. A password-protected dashboard may bind to a network when it is either published only on
 * host loopback or named by a public authority; a passwordless dashboard must stay on loopback or a loopback-published port.
 */
type DashboardExposure = { readonly password: string | undefined; readonly publicAuthority: string | undefined } | { readonly passwordlessExposureError: string }

type BotDashboardRouteContext = {
	/** Host authorities the server answers for; requests must pass these before any route runs. */
	readonly acceptedAuthorities: ReadonlySet<string>
	readonly url: URL
}

export type BotDashboardServerOptions = {
	/** Directory holding the bot's `index.html`, `styles.css`, `favicon.svg`, and `dashboard.ts` browser entrypoint. */
	readonly directory: string
	readonly exposure: DashboardExposure
	readonly hostname: '0.0.0.0' | '127.0.0.1'
	readonly loopbackPublished: boolean | undefined
	/** Response for a request no route claims. */
	readonly notFound?: () => Response
	/**
	 * Receives the raw error of a request that failed outside a route's own error handling, for the protected process
	 * log. The browser only ever gets a fixed message. Defaults to writing the error message to stderr.
	 */
	readonly onUnhandledError?: (error: unknown) => void
	/** Dashboard page names; `/` serves the first page and `/<page>` serves each page. */
	readonly pages: readonly string[]
	/** Replacements applied to `index.html` placeholders such as `<!-- operator-header -->`, in order. */
	readonly pageSlots: readonly (readonly [placeholder: string, markup: string | (() => string)])[]
	readonly port: number
	/**
	 * Bot-specific routes, reached after authentication and the shared page and asset routes. Requests other than `GET`
	 * and `HEAD` only arrive here when they are same-origin, so a route cannot forget the cross-site request check.
	 */
	readonly route: (request: Request, context: BotDashboardRouteContext) => Promise<Response | undefined>
}

function validateExposure(hostname: '0.0.0.0' | '127.0.0.1', loopbackPublished: boolean | undefined, exposure: DashboardExposure) {
	if ('passwordlessExposureError' in exposure) {
		if (hostname === '0.0.0.0' && loopbackPublished !== true) throw new Error(exposure.passwordlessExposureError)
		return
	}
	validateDashboardAuthentication(hostname, exposure.password, loopbackPublished, exposure.publicAuthority)
}

/**
 * Serves a bot operator dashboard: host-authority checks, `/healthz`, optional Basic authentication, the same-origin
 * check on every mutating request, the templated pages, the bot stylesheet and browser bundle, and the shared dashboard
 * assets. Everything else is delegated to `route`. A failure no route handled answers with a fixed JSON error that
 * carries the security headers; its detail only reaches the process log.
 */
export function startBotDashboardServer(options: BotDashboardServerOptions) {
	validateExposure(options.hostname, options.loopbackPublished, options.exposure)
	const password = 'password' in options.exposure ? options.exposure.password : undefined
	const publicAuthority = 'publicAuthority' in options.exposure ? options.exposure.publicAuthority : undefined
	const pages = new Set(options.pages)
	const defaultPage = options.pages[0]
	if (defaultPage === undefined) throw new Error('Dashboard requires at least one page')
	const notFound = options.notFound ?? (() => dashboardJson({ error: 'Not found' }, 404))
	const dashboardPage = async (pathname: string) => {
		const page = pathname === '/' ? defaultPage : pathname.slice(1)
		if (!pages.has(page)) return undefined
		let source = await Bun.file(join(options.directory, 'index.html')).text()
		for (const [placeholder, markup] of options.pageSlots) source = source.replace(placeholder, () => (typeof markup === 'string' ? markup : markup()))
		return source.replace('<body>', `<body data-page="${page}">`)
	}
	let acceptedAuthorities: ReadonlySet<string> = new Set()
	const reportUnhandledError = options.onUnhandledError ?? ((error: unknown) => console.error(`event=dashboardRequestFailed error=${JSON.stringify(errorMessage(error))}`))
	const unhandledFailure = (error: unknown) => {
		reportUnhandledError(error)
		return dashboardJson({ error: 'The dashboard request failed unexpectedly. Check protected bot logs for details.' }, 500)
	}
	const respond = async (request: Request) => {
		if (!dashboardRequestAuthorityIsAccepted(request, acceptedAuthorities)) return dashboardJson({ error: 'Request authority is not accepted' }, 403)
		const url = new URL(request.url)
		if (request.method === 'GET' && url.pathname === '/healthz') return dashboardHealthResponse()
		if (!dashboardRequestIsAuthenticated(request, password)) {
			return Response.json({ error: 'Dashboard authentication is required' }, { headers: { ...dashboardSecurityHeaders('application/json; charset=utf-8'), ...dashboardAuthenticationChallenge() }, status: 401 })
		}
		if (request.method !== 'GET' && request.method !== 'HEAD' && !dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return dashboardJson({ error: 'Cross-origin requests are not accepted' }, 403)
		if (request.method === 'GET') {
			const page = await dashboardPage(url.pathname)
			if (page !== undefined) return new Response(page, { headers: dashboardSecurityHeaders('text/html; charset=utf-8') })
			if (url.pathname === '/dashboard.css') return new Response(Bun.file(join(options.directory, 'styles.css')), { headers: dashboardSecurityHeaders('text/css; charset=utf-8') })
			if (url.pathname === '/dashboard.js') return new Response(await buildDashboardScript(join(options.directory, 'dashboard.ts')), { headers: dashboardSecurityHeaders('text/javascript; charset=utf-8') })
			const asset = await sharedDashboardAssetResponse(url.pathname, join(options.directory, 'favicon.svg'))
			if (asset !== undefined) return asset
		}
		return (await options.route(request, { acceptedAuthorities, url })) ?? notFound()
	}
	const server = Bun.serve({
		// Bun's development error page would answer a failure with stack and source detail and without the security headers.
		development: false,
		hostname: options.hostname,
		port: options.port,
		async fetch(request) {
			try {
				return await respond(request)
			} catch (error) {
				return unhandledFailure(error)
			}
		},
		error: unhandledFailure,
	})
	if (server.port === undefined) {
		server.stop()
		throw new Error('Dashboard server did not expose its listening port')
	}
	acceptedAuthorities = dashboardAuthorities(server.port, publicAuthority)
	return server
}
