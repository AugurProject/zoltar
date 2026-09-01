import { join } from 'node:path'
import { boundedDashboardJson, dashboardAuthenticationChallenge, dashboardAuthorities, dashboardRequestAuthorityIsAccepted, dashboardRequestIsAuthenticated, dashboardRequestIsSameOrigin, validateDashboardAuthentication } from '@zoltar/bot-shared/dashboard/security'
import { publicOperatorFailure, publicOperatorSnapshot, publicPollFailure, type OperatorSnapshot, type StrategySettings } from '#state/operator-state'
import type { SubmissionSettings } from '#execution/transaction-submission'
import type { DeploymentSettings } from '#config/deployment-settings'
import { CONFIGURATION_REVISION_CONFLICT } from '#config/settings-store'
import { EndpointCheckFailure } from '#monitoring/connectivity'

type DashboardController = {
	getConfiguration?: () => unknown | Promise<unknown>
	getSnapshot: () => OperatorSnapshot | Promise<OperatorSnapshot>
	isNetworkConfigured: () => boolean | Promise<boolean>
	hostname?: '0.0.0.0' | '127.0.0.1'
	loopbackPublished?: boolean
	password?: string | undefined
	publicAuthority?: string | undefined
	setPaused: (paused: boolean) => void | Promise<void>
	updateConnectivity: (value: unknown) => unknown | Promise<unknown>
	updateConfiguration?: (value: unknown) => unknown | Promise<unknown>
	updateDeployment?: (value: unknown) => DeploymentSettings | Promise<DeploymentSettings>
	deployExecutor?: (value: unknown) => { address: string; alreadyDeployed: boolean; transactionHash: string | undefined } | Promise<{ address: string; alreadyDeployed: boolean; transactionHash: string | undefined }>
	predictExecutor?: (value: unknown) => { address: string; salt: string } | Promise<{ address: string; salt: string }>
	updateSigner: (value: unknown) => { wallet: string | undefined } | Promise<{ wallet: string | undefined }>
	switchNetworkProfile?: (value: unknown) => unknown | Promise<unknown>
	updateStrategy: (value: unknown) => StrategySettings | Promise<StrategySettings>
	updateSubmission: (value: unknown) => SubmissionSettings | Promise<SubmissionSettings>
	updateTokens?: (value: unknown) => readonly string[] | Promise<readonly string[]>
}

const CHAIN_CONFIGURATION_REQUIRED = 'Select and save the chain and RPC endpoints before changing chain-specific settings'

async function requireConfiguredChain(controller: DashboardController) {
	if (!(await controller.isNetworkConfigured())) throw new Error(CHAIN_CONFIGURATION_REQUIRED)
}

function json(value: unknown, status = 200) {
	return Response.json(value, {
		headers: securityHeaders('application/json; charset=utf-8'),
		status,
	})
}

function closingJson(value: unknown) {
	return Response.json(value, { headers: { ...securityHeaders('application/json; charset=utf-8'), connection: 'close' } })
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

function recognizedConnectivityValidationMessage(message: string) {
	if (
		message === 'Network, RPC, and quorum settings are required' ||
		message === 'RPC quorum must be 1 or 2' ||
		message === 'Select the chain profile before saving its RPC settings' ||
		message === 'Switch chain profiles with the Chain selector before editing that profile' ||
		message === 'Live execution requires at least two independent quorum RPCs (three read endpoints total)' ||
		message === 'Connectivity settings must be a JSON object' ||
		message === 'Connectivity settings require only readRpcUrl and publicRpcUrls' ||
		message === 'Read RPC URL must be a string' ||
		message === 'Public RPC URLs must be an array of strings' ||
		message === 'At most 8 public RPC URLs are supported' ||
		message === 'At most 8 read quorum RPC URLs are supported' ||
		message === 'Invalid RPC URL' ||
		message === 'RPC URLs must not exceed 2048 characters' ||
		message === 'RPC URL must use HTTPS or HTTP on loopback, anvil, or reth' ||
		message === 'RPC URLs must not contain embedded credentials' ||
		message === 'RPC URLs must not contain fragments' ||
		message === 'At least one public RPC URL is required' ||
		message === 'Read RPC quorum must use independent origins; changing only the URL path does not create an independent provider'
	)
		return message
	return undefined
}

function formatRpcTransportFailure(origin: string, method: 'eth_chainId' | 'eth_sendRawTransaction', detail: string) {
	let safeMessage: string | undefined
	if (detail === 'The operation timed out.' || detail === 'fetch failed') safeMessage = `RPC ${origin} failed while calling ${method}: ${detail}`
	else if (/^connection refused$/i.test(detail)) safeMessage = `RPC ${origin} failed while calling ${method}: connection refused`
	else if (/^Unable to connect(?:\. Is the computer able to access the url\?)?$/i.test(detail) || /^network is unreachable$/i.test(detail)) safeMessage = `RPC ${origin} failed while calling ${method}: ${detail}`
	else if (/^getaddrinfo (?:ENOTFOUND|EAI_AGAIN) [a-z0-9.-]+$/i.test(detail)) safeMessage = `RPC ${origin} failed while calling ${method}: ${detail}`
	else if (/^RPC returned HTTP (\d+)$/i.test(detail)) safeMessage = `RPC ${origin} returned HTTP ${/^RPC returned HTTP (\d+)$/i.exec(detail)?.[1]} while calling ${method}`
	else if (/^RPC returned non-JSON HTTP (\d+)$/i.test(detail)) safeMessage = `RPC ${origin} returned non-JSON HTTP ${/^RPC returned non-JSON HTTP (\d+)$/i.exec(detail)?.[1]} while calling ${method}`
	if (safeMessage === undefined) return undefined
	return localRpcHostnameHint(safeMessage) ?? safeMessage
}

function formatPublicRpcChainIdFailure(origin: string, detail: string) {
	const transportFailure = formatRpcTransportFailure(origin, 'eth_chainId', detail)
	if (transportFailure !== undefined) return transportFailure
	if (detail === 'RPC returned an invalid chain id' || detail === 'RPC returned an unsupported chain id') return `RPC ${origin} failed while calling eth_chainId: ${detail}`
	const expectedChainMatch = /^Expected chain (\d+), received (\d+)$/.exec(detail)
	if (expectedChainMatch?.[1] !== undefined && expectedChainMatch[2] !== undefined) return `RPC ${origin} failed while calling eth_chainId: Expected chain ${expectedChainMatch[1]}, received ${expectedChainMatch[2]}`
	return undefined
}

function recognizedRpcMethodFailure(message: string) {
	const match = /^RPC (https?:\/\/[^ ]+) failed while calling (eth_chainId|eth_sendRawTransaction): (.+)$/.exec(message)
	if (match === null) return undefined
	const origin = match[1]
	const method = match[2]
	const detail = match[3]
	if (origin === undefined || method === undefined || detail === undefined) return undefined
	return method === 'eth_chainId' ? formatPublicRpcChainIdFailure(origin, detail) : formatRpcTransportFailure(origin, 'eth_sendRawTransaction', detail)
}

function recognizedEndpointChainMismatch(message: string) {
	const match = /^(https?:\/\/[^ ]+) returned chain (\d+)(?:; expected chain (\d+))?$/.exec(message)
	if (match === null) return undefined
	const origin = match[1]
	const actualChainId = match[2]
	const expectedChainId = match[3]
	if (origin === undefined || actualChainId === undefined) return undefined
	return expectedChainId === undefined ? `${origin} returned chain ${actualChainId}` : `${origin} returned chain ${actualChainId}; expected chain ${expectedChainId}`
}

function recognizedConnectivityChecks(error: unknown) {
	if (!(error instanceof EndpointCheckFailure)) return undefined
	const failedChecks = error.checks.filter(check => check.status === 'failed' && (check.kind === 'read-rpc' || check.kind === 'public-rpc'))
	if (failedChecks.length === 0) return undefined
	const messages = [
		...new Set(
			failedChecks.map(check => {
				const detail = check.error
				if (detail === undefined) return `RPC ${check.target} failed while calling eth_chainId. Review the endpoint and protected bot logs.`
				const safeMessage = recognizedRpcMethodFailure(detail) ?? formatPublicRpcChainIdFailure(check.target, detail.replace(`${check.target}: `, ''))
				if (safeMessage !== undefined) return safeMessage
				const chainMismatch = recognizedEndpointChainMismatch(detail) ?? recognizedEndpointChainMismatch(detail.replace(`${check.target}: `, ''))
				if (chainMismatch !== undefined) return chainMismatch
				return `RPC ${check.target} failed while calling eth_chainId. Review the endpoint and protected bot logs.`
			}),
		),
	]
	return messages.join('; ')
}

function localRpcHostnameHint(message: string) {
	const match = /^RPC (https?:\/\/[^ ]+) failed while calling (eth_chainId|eth_sendRawTransaction): (.+)$/.exec(message)
	if (match === null) return undefined
	const target = match[1]
	const detail = match[3]
	if (target === undefined || detail === undefined) return undefined
	const normalizedDetail = detail.toLowerCase()
	try {
		const hostname = new URL(target).hostname
		if (
			(hostname === 'reth' || hostname === 'anvil') &&
			(normalizedDetail.includes('timed out') ||
				normalizedDetail.includes('fetch failed') ||
				normalizedDetail.includes('connection refused') ||
				normalizedDetail.includes('unable to connect') ||
				normalizedDetail.includes('enotfound') ||
				normalizedDetail.includes('eai_again') ||
				normalizedDetail.includes('getaddrinfo') ||
				normalizedDetail.includes('hostname resolution') ||
				normalizedDetail.includes('name resolution'))
		) {
			return `${message} The hostname ${hostname} must resolve from the bot process; Docker service names like ${hostname} only work when the bot shares that container network.`
		}
	} catch (error) {
		void error
	}
	return undefined
}

function publicError(error: unknown, status: number, operation: string, fallback: string, categorize = false) {
	const message = errorMessage(error)
	console.error(`dashboardOperation=${operation} failed=${message}`)
	return json({ error: categorize ? publicOperatorFailure(message, fallback) : fallback }, status)
}

function publicConfigurationUpdateError(error: unknown, conflict: boolean) {
	if (conflict) return 'Configuration changed since it was loaded. Reload the current configuration before saving.'
	const message = errorMessage(error)
	if (message === 'Operator settings and runtime persistence files must use distinct paths') return message
	if (/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)? returned chain \d+; expected chain \d+$/.test(message)) return message
	if (message === 'Select the chain profile before saving its RPC settings' || message === 'Switch chain profiles with the Chain selector before editing that profile') return message
	return 'Configuration could not be saved. Review the submitted values and protected bot logs.'
}

function publicConnectivityUpdateError(error: unknown) {
	const message = errorMessage(error)
	return recognizedConnectivityValidationMessage(message) ?? recognizedConnectivityChecks(error) ?? recognizedRpcMethodFailure(message) ?? recognizedEndpointChainMismatch(message) ?? 'RPC connectivity checks failed. Review the submitted endpoints and retry.'
}

function markdownHeadingId(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[`']/g, '')
		.replace(/[^a-z0-9 -]/g, '')
		.replace(/\s+/g, '-')
}

function renderReadme(markdown: string) {
	const headingIds = markdown
		.split('\n')
		.filter(line => /^#{1,6} /.test(line))
		.map(line => markdownHeadingId(line.replace(/^#{1,6} /, '')))
	let headingIndex = 0
	const body = Bun.markdown
		.html(markdown)
		.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_match, ...captures) => {
			const [level, contents] = captures
			if (typeof level !== 'string' || typeof contents !== 'string') throw new Error('README heading render was malformed')
			const id = headingIds[headingIndex]
			if (id === undefined) throw new Error('README heading render count did not match its Markdown source')
			headingIndex += 1
			return `<h${level} id="${id}">${contents}</h${level}>`
		})
		.replaceAll('<pre>', '<pre tabindex="0" aria-label="Scrollable code or command example">')
		.replaceAll('href="./docs/operator-guide.html', 'href="/documentation')
		.replaceAll('href="./docs/market-fixture.html', 'href="/market-fixture.html')
		.replace(/<a href="(https?:\/\/[^\"]+)"([^>]*)>/g, (_match, ...captures) => {
			const [href, attributes] = captures
			if (typeof href !== 'string' || typeof attributes !== 'string') throw new Error('README external link render was malformed')
			const safeAttributes = attributes.replace(/\s+target="[^"]*"/g, '').replace(/\s+rel="[^"]*"/g, '')
			return `<a href="${href}"${safeAttributes} target="_blank" rel="noreferrer">`
		})
	if (headingIndex !== headingIds.length) throw new Error('README heading render count did not match its Markdown source')
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>OpenOracle Arbitrager Reference</title>
		<link rel="stylesheet" href="/shared.css" />
	</head>
	<body class="doc-openoracle">
		<main>
			<section>${body}</section>
		</main>
	</body>
</html>`
}

export function startDashboardServer(port: number, controller: DashboardController) {
	const directory = import.meta.dir
	const projectDirectory = join(directory, '..', '..')
	const documentationDirectory = join(projectDirectory, 'docs')
	const browserSource = Bun.file(join(directory, 'dashboard.ts'))
	const browserFormatSource = Bun.file(join(directory, 'dashboard-format.ts'))
	const dashboardPages = new Set(['overview', 'operations', 'games', 'markets', 'settings'])
	const dashboardPage = async (pathname: string) => {
		const page = pathname === '/' ? 'overview' : pathname.slice(1)
		if (!dashboardPages.has(page)) return undefined
		const source = await Bun.file(join(directory, 'index.html')).text()
		return source.replace('<body>', `<body data-page="${page}">`)
	}
	const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
	const hostname = controller.hostname ?? '127.0.0.1'
	validateDashboardAuthentication(hostname, controller.password, controller.loopbackPublished, controller.publicAuthority)
	let acceptedAuthorities: ReadonlySet<string> = new Set()
	const server = Bun.serve({
		hostname,
		port,
		async fetch(request) {
			if (!dashboardRequestAuthorityIsAccepted(request, acceptedAuthorities)) return json({ error: 'Request authority is not accepted' }, 403)
			if (request.method === 'GET' && new URL(request.url).pathname === '/healthz') return new Response('ok', { headers: securityHeaders('text/plain; charset=utf-8') })
			if (!dashboardRequestIsAuthenticated(request, controller.password)) {
				return Response.json({ error: 'Dashboard authentication is required' }, { headers: { ...securityHeaders('application/json; charset=utf-8'), ...dashboardAuthenticationChallenge() }, status: 401 })
			}
			const url = new URL(request.url)
			if (request.method === 'GET') {
				const page = await dashboardPage(url.pathname)
				if (page !== undefined) return new Response(page, { headers: securityHeaders('text/html; charset=utf-8') })
			}
			if (request.method === 'GET' && (url.pathname === '/documentation' || url.pathname === '/documentation/')) {
				return new Response(Bun.file(join(documentationDirectory, 'operator-guide.html')), { headers: securityHeaders('text/html; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/documentation/reference') {
				return new Response(renderReadme(await Bun.file(join(projectDirectory, 'README.md')).text()), {
					headers: securityHeaders('text/html; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/market-fixture.html') {
				return new Response(Bun.file(join(documentationDirectory, 'market-fixture.html')), { headers: securityHeaders('text/html; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/scripts/check-market-fixture.mts') {
				return new Response(Bun.file(join(projectDirectory, 'scripts', 'check-market-fixture.mts')), { headers: securityHeaders('text/plain; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/src/core/strategy.ts') {
				return new Response(Bun.file(join(projectDirectory, 'src', 'core', 'strategy.ts')), { headers: securityHeaders('text/plain; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/README.md') return new Response(Bun.file(join(projectDirectory, 'README.md')), { headers: securityHeaders('text/markdown; charset=utf-8') })
			if (request.method === 'GET' && url.pathname === '/favicon.ico') return new Response(undefined, { headers: securityHeaders('image/x-icon'), status: 204 })
			if (request.method === 'GET' && url.pathname === '/dashboard.css') return new Response(Bun.file(join(directory, 'styles.css')), { headers: securityHeaders('text/css; charset=utf-8') })
			if (request.method === 'GET' && url.pathname === '/operator-console.css') {
				return new Response(Bun.file(join(directory, '..', '..', '..', 'shared', 'src', 'dashboard', 'operator-console.css')), { headers: securityHeaders('text/css; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/operator-guide.css') return new Response(Bun.file(join(documentationDirectory, 'operator-guide.css')), { headers: securityHeaders('text/css; charset=utf-8') })
			if (request.method === 'GET' && url.pathname === '/shared.css') {
				return new Response(Bun.file(join(documentationDirectory, 'shared.css')), { headers: securityHeaders('text/css; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/chart-runtime.js') {
				return new Response(Bun.file(join(documentationDirectory, 'chart-runtime.js')), { headers: securityHeaders('text/javascript; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/assets/dashboard-overview.png') {
				return new Response(Bun.file(join(documentationDirectory, 'assets', 'dashboard-overview.png')), { headers: securityHeaders('image/png') })
			}
			if (request.method === 'GET' && url.pathname === '/assets/dashboard-markets.png') {
				return new Response(Bun.file(join(documentationDirectory, 'assets', 'dashboard-markets.png')), { headers: securityHeaders('image/png') })
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
					return json(publicOperatorSnapshot(await controller.getSnapshot()))
				} catch (error) {
					const message = errorMessage(error)
					console.error(`dashboardOperation=state-read failed=${message}`)
					return json({ error: publicPollFailure(message, 'load the latest operator state for the dashboard') }, 503)
				}
			}
			if (request.method === 'GET' && url.pathname === '/api/configuration') {
				try {
					if (controller.getConfiguration === undefined) throw new Error('Complete configuration is unavailable')
					return json(await controller.getConfiguration())
				} catch (error) {
					return publicError(error, 503, 'configuration-read', 'Complete configuration is unavailable. Retry or check protected bot logs for details.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/configuration') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.updateConfiguration === undefined) throw new Error('Complete configuration is unavailable')
					return json(await controller.updateConfiguration(await boundedDashboardJson(request)))
				} catch (error) {
					const conflict = error instanceof Error && error.name === CONFIGURATION_REVISION_CONFLICT
					return publicError(error, conflict ? 409 : 400, 'configuration-update', publicConfigurationUpdateError(error, conflict))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/settings') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					return json({ settings: await controller.updateStrategy(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'strategy-update', 'Strategy settings could not be saved. Review the submitted values and protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/submission') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					return json({ submission: await controller.updateSubmission(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'submission-update', 'Submission settings could not be saved. Review the submitted values and protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/connectivity') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					return json(await controller.updateConnectivity(await boundedDashboardJson(request)))
				} catch (error) {
					return publicError(error, 400, 'connectivity-update', publicConnectivityUpdateError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/network-profile') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					if (controller.switchNetworkProfile === undefined) throw new Error('Chain profile switching is unavailable')
					return closingJson(await controller.switchNetworkProfile(await boundedDashboardJson(request)))
				} catch (error) {
					return publicError(error, 400, 'network-profile-switch', 'The chain profile could not be activated. Review protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/deployment') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.updateDeployment === undefined) throw new Error('Deployment configuration is unavailable')
					return json({ deployment: await controller.updateDeployment(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'deployment-update', 'Deployment settings could not be saved. Review the submitted values and protected bot logs.')
				}
			}
			if (request.method === 'POST' && url.pathname === '/api/executor-deployment') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.deployExecutor === undefined) throw new Error('Executor deployment is unavailable')
					return json(await controller.deployExecutor(await boundedDashboardJson(request)))
				} catch (error) {
					return publicError(error, 400, 'executor-deployment', 'Executor deployment could not be completed. Review chain state and protected bot logs.')
				}
			}
			if (request.method === 'POST' && url.pathname === '/api/executor-prediction') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.predictExecutor === undefined) throw new Error('Executor prediction is unavailable')
					return json(await controller.predictExecutor(await boundedDashboardJson(request)))
				} catch (error) {
					return publicError(error, 400, 'executor-prediction', 'Executor prediction could not be completed. Review the submitted salt and protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/tokens') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.updateTokens === undefined) throw new Error('Token configuration is unavailable')
					return json({ tokenAddresses: await controller.updateTokens(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'token-update', 'Token settings could not be saved. Review the submitted addresses and protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/signer') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					return json(await controller.updateSigner(await boundedDashboardJson(request)))
				} catch (error) {
					return publicError(error, 400, 'signer-update', 'Signer settings could not be changed. Review the submitted action and protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/paused') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					const value = await boundedDashboardJson(request)
					if (typeof value !== 'object' || value === null || !('paused' in value) || typeof value['paused'] !== 'boolean') throw new Error('paused must be a boolean')
					if (!value['paused']) await requireConfiguredChain(controller)
					await controller.setPaused(value['paused'])
					return json({ paused: value['paused'] })
				} catch (error) {
					return publicError(error, 400, 'pause-update', 'The bot run state could not be changed. Refresh current state and check protected bot logs.')
				}
			}
			return new Response('Not found', { status: 404 })
		},
	})
	if (server.port === undefined) {
		server.stop()
		throw new Error('Dashboard server did not expose a listening port')
	}
	acceptedAuthorities = dashboardAuthorities(server.port, controller.publicAuthority)
	console.log(`dashboard=http://127.0.0.1:${server.port}`)
	return server
}
