import { repMarketConsensusPanel } from '@zoltar/bot-shared/dashboard/rep-market-consensus'
import type { DeploymentSettings } from '#config/deployment-settings'
import { CONFIGURATION_REVISION_CONFLICT, type StoredCentralizedMarketSettings, type StoredRuntimeLimits } from '#config/settings-store'
import type { SubmissionSettings } from '#execution/transaction-submission'
import type { OperatorSnapshot, StrategySettings } from '#state/operator-state'
import { EXECUTOR_DEPLOYMENT_MESSAGES, EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED, RESUME_REQUIRES_CONFIGURED_CHAIN } from '#state/executor-deployment-recovery'
import { publicOperatorSnapshot } from '#state/public-snapshot'
import type { SettlementSettings } from '#state/settlement-store'
import { publicOperatorFailure, publicPollFailure } from '#state/public-failures'
import { buildDashboardScript, dashboardHealthResponse, sharedDashboardAssetResponse } from '@zoltar/bot-shared/dashboard/assets'
import { publicConnectivityError } from '@zoltar/bot-shared/dashboard/connectivity-error'
import {
	boundedDashboardJson,
	closingDashboardJson as closingJson,
	dashboardAuthenticationChallenge,
	dashboardAuthorities,
	dashboardRequestAuthorityIsAccepted,
	dashboardRequestIsAuthenticated,
	dashboardRequestIsSameOrigin,
	dashboardJson as json,
	dashboardSecurityHeaders as securityHeaders,
	validateDashboardAuthentication,
} from '@zoltar/bot-shared/dashboard/security'
import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'
import { join } from 'node:path'
import { operatorHeader } from './header.ts'
import { settingsPageMarkup } from './settings-page.ts'

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
	updateSettlement?: (value: unknown) => SettlementSettings | Promise<SettlementSettings>
	updateRuntimeLimits?: (value: unknown) => StoredRuntimeLimits | Promise<StoredRuntimeLimits>
	updateCentralizedMarkets?: (value: unknown) => StoredCentralizedMarketSettings | Promise<StoredCentralizedMarketSettings>
	updateExecution?: (value: unknown) => { execute: boolean } | Promise<{ execute: boolean }>
	updateSubmission: (value: unknown) => SubmissionSettings | Promise<SubmissionSettings>
	setApprovedUniverses?: (value: unknown) => readonly string[] | Promise<readonly string[]>
	updateTokens?: (value: unknown) => readonly string[] | Promise<readonly string[]>
}

const CHAIN_CONFIGURATION_REQUIRED = 'Select and save the chain and RPC endpoints before changing chain-specific settings'

async function requireConfiguredChain(controller: DashboardController) {
	if (!(await controller.isNetworkConfigured())) throw new Error(CHAIN_CONFIGURATION_REQUIRED)
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

const EXECUTION_UPDATE_MESSAGES = new Set(['Execution requires an active signer', 'Execution is enabled, but live operation requires at least two independent quorum RPCs (three read endpoints total)', 'Execution requires at least one enabled Uniswap venue available on this network'])

/** Execution mode failures name the missing prerequisite so the operator can fix it; anything else stays in protected logs. */
function publicExecutionUpdateError(error: unknown) {
	const message = errorMessage(error)
	if (EXECUTION_UPDATE_MESSAGES.has(message)) return message
	return 'Execution mode could not be changed. Review the signer, quorum RPCs, and protected bot logs.'
}

const PAUSE_UPDATE_MESSAGES = new Set([CHAIN_CONFIGURATION_REQUIRED, RESUME_REQUIRES_CONFIGURED_CHAIN, EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED])

/** Resume refusals name the operator step that unblocks them; anything else stays in protected logs. */
function publicPauseUpdateError(error: unknown) {
	const message = errorMessage(error)
	if (PAUSE_UPDATE_MESSAGES.has(message)) return message
	return 'The bot run state could not be changed. Refresh current state and check protected bot logs.'
}

const FORWARDED_EXECUTOR_DEPLOYMENT_MESSAGES = new Set<string>([CHAIN_CONFIGURATION_REQUIRED, ...Object.values(EXECUTOR_DEPLOYMENT_MESSAGES)])

/** Deployment and recovery prerequisites name the operator step that unblocks them; RPC and chain-state detail stays in protected logs. */
function publicExecutorDeploymentError(error: unknown) {
	const message = errorMessage(error)
	if (FORWARDED_EXECUTOR_DEPLOYMENT_MESSAGES.has(message)) return message
	return 'Executor deployment could not be completed. Review chain state and protected bot logs.'
}

/** Field validation for the focused forms names the offending field of the operator's own submission; anything else stays in protected logs. */
function publicFieldValidationError(error: unknown, prefix: string, fallback: string) {
	const message = errorMessage(error)
	return message.startsWith(prefix) ? message : fallback
}

/** Market policy validation names the offending field of the operator's own document; anything else stays in protected logs. */
function publicMarketUpdateError(error: unknown) {
	const message = errorMessage(error)
	if (/^(?:Unknown )?centralizedMarkets\b|^Required venue consensus |^CEX and DEX sources /.test(message)) return message
	return 'Market source settings could not be saved. Review the submitted JSON and protected bot logs.'
}

function publicConnectivityUpdateError(error: unknown) {
	return publicConnectivityError(error, {
		fallback: 'RPC connectivity checks failed. Review the submitted endpoints and retry.',
		validationMessages: new Set([
			'Live execution requires at least two independent quorum RPCs (three read endpoints total)',
			'Network, RPC, and quorum settings are required',
			'Quorum RPC URLs must be an array of URLs',
			'Quorum RPC URLs must contain no more than 8 URLs',
			'Read RPC quorum must use independent origins; changing only the URL path does not create an independent provider',
			'RPC quorum must be 1 or 2',
			'Select the chain profile before saving its RPC settings',
			'Switch chain profiles with the Chain selector before editing that profile',
		]),
	})
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
	const browserEntrypoint = join(directory, 'dashboard.ts')
	const browserFormatSource = Bun.file(join(directory, 'dashboard-format.ts'))
	const dashboardPages = new Set(['overview', 'operations', 'games', 'markets', 'settings'])
	const dashboardPage = async (pathname: string) => {
		const page = pathname === '/' ? 'overview' : pathname.slice(1)
		if (!dashboardPages.has(page)) return undefined
		const source = await Bun.file(join(directory, 'index.html')).text()
		return source.replace('<!-- rep-market-consensus -->', repMarketConsensusPanel()).replace('<!-- settings-page -->', settingsPageMarkup).replace('<!-- operator-header -->', operatorHeader).replace('<body>', `<body data-page="${page}">`)
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
			if (request.method === 'GET' && new URL(request.url).pathname === '/healthz') return dashboardHealthResponse()
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
			if (request.method === 'GET') {
				const asset = await sharedDashboardAssetResponse(url.pathname, join(directory, 'favicon.svg'))
				if (asset !== undefined) return asset
			}
			if (request.method === 'GET' && url.pathname === '/dashboard.css') return new Response(Bun.file(join(directory, 'styles.css')), { headers: securityHeaders('text/css; charset=utf-8') })
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
				return new Response(await buildDashboardScript(browserEntrypoint), {
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
			if (request.method === 'PUT' && url.pathname === '/api/settlement') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.updateSettlement === undefined) throw new Error('Settlement configuration is unavailable')
					return json({ settlement: await controller.updateSettlement(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'settlement-update', publicFieldValidationError(error, 'Settlement ', 'Settlement settings could not be saved. Review the submitted values and protected bot logs.'))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/runtime-limits') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.updateRuntimeLimits === undefined) throw new Error('Runtime limit configuration is unavailable')
					return json({ runtime: await controller.updateRuntimeLimits(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'runtime-limits-update', publicFieldValidationError(error, 'Runtime ', 'Risk limits could not be saved. Review the submitted values and protected bot logs.'))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/centralized-markets') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.updateCentralizedMarkets === undefined) throw new Error('Market source configuration is unavailable')
					return json({ centralizedMarkets: await controller.updateCentralizedMarkets(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'centralized-markets-update', publicMarketUpdateError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/execution') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.updateExecution === undefined) throw new Error('Execution mode configuration is unavailable')
					return json(await controller.updateExecution(await boundedDashboardJson(request)))
				} catch (error) {
					return publicError(error, 400, 'execution-update', publicExecutionUpdateError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/submission') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					return json({ submission: await controller.updateSubmission(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'submission-update', publicConnectivityError(error, { fallback: 'Submission settings could not be saved. Review the submitted values and protected bot logs.' }))
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
					return publicError(error, 400, 'executor-deployment', publicExecutorDeploymentError(error))
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
			if (request.method === 'PUT' && url.pathname === '/api/approved-universes') {
				if (!dashboardRequestIsSameOrigin(request, acceptedAuthorities)) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				try {
					await requireConfiguredChain(controller)
					if (controller.setApprovedUniverses === undefined) throw new Error('Universe approval is unavailable')
					return json({ approvedUniverses: await controller.setApprovedUniverses(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicError(error, 400, 'universe-approval', 'Universe approval could not be saved. Select only one outcome per fork and review protected bot logs.')
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
					return publicError(error, 400, 'pause-update', publicPauseUpdateError(error))
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
