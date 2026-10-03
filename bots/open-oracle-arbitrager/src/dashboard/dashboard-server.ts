import { repMarketConsensusPanel } from '@zoltar/bot-shared/dashboard/rep-market-consensus'
import type { DeploymentSettings } from '#config/deployment-settings'
import { type StoredCentralizedMarketSettings, type StoredRuntimeLimits } from '#config/settings-store'
import { CONFIGURATION_REVISION_CONFLICT } from '@zoltar/bot-shared/config/durable-file'
import type { SubmissionSettings } from '#execution/transaction-submission'
import type { OperatorSnapshot, StrategySettings } from '#state/operator-state'
import { EXECUTOR_DEPLOYMENT_MESSAGES, EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED, RESUME_REQUIRES_CONFIGURED_CHAIN } from '#state/executor-deployment-recovery'
import { publicOperatorSnapshot } from '#state/public-snapshot'
import type { SettlementSettings } from '#state/settlement-store'
import { publicPollFailure } from '@zoltar/bot-shared/dashboard/public-failures'
import { logDashboardFailure, publicDashboardError } from '@zoltar/bot-shared/dashboard/public-error'
import { publicConnectivityError } from '@zoltar/bot-shared/dashboard/connectivity-error'
import { boundedDashboardJson, closingDashboardJson as closingJson, dashboardJson as json, dashboardSecurityHeaders as securityHeaders } from '@zoltar/bot-shared/dashboard/security'
import { startBotDashboardServer } from '@zoltar/bot-shared/dashboard/server'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { join } from 'node:path'
import { operatorHeader } from './header.ts'
import { settingsPageMarkup } from './settings-page.tsx'

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
	return 'The bot run state could not be changed. Wait for the next state update and check protected bot logs.'
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

const PROFILE_SWITCH_IN_PROGRESS = 'Chain profile switching is in progress; retry after the dashboard reconnects'

/** Strategy validation names the offending field by its form label and its bounds, never a path, URL, or secret. */
const STRATEGY_FIELD_MESSAGE = /^(?:Maximum spot\/TWAP ticks|Minimum return|Minimum profit|Minimum remaining blocks|Minimum remaining seconds|TWAP window) must [A-Za-z0-9 ,.-]+$/

function publicStrategyUpdateError(error: unknown) {
	const message = errorMessage(error)
	if (message === PROFILE_SWITCH_IN_PROGRESS || message === CHAIN_CONFIGURATION_REQUIRED || STRATEGY_FIELD_MESSAGE.test(message)) return message
	return 'Strategy settings could not be saved. Review the submitted values and protected bot logs.'
}

const SIGNER_UPDATE_MESSAGES = new Set([CHAIN_CONFIGURATION_REQUIRED, PROFILE_SWITCH_IN_PROGRESS, 'Execution requires an active signer', 'Private key must be null or a 32-byte 0x-prefixed value'])

/** Signer refusals name the operator step that unblocks them; the submitted key and everything else stay in protected logs. */
function publicSignerUpdateError(error: unknown) {
	const message = errorMessage(error)
	if (message === 'Execution requires an active signer') return 'Live execution requires an active signer. Switch to dry run under Execution mode before removing it.'
	if (SIGNER_UPDATE_MESSAGES.has(message)) return message
	return 'Signer settings could not be changed. Review the submitted action and protected bot logs.'
}

const SUBMISSION_VALIDATION_MESSAGES = new Set([
	CHAIN_CONFIGURATION_REQUIRED,
	PROFILE_SWITCH_IN_PROGRESS,
	'At most 8 relay URLs are supported',
	'Invalid relay URL',
	'Minimum bundle relay successes must be an integer between 1 and 8',
	'Minimum bundle relay successes must be an integer between 1 and the configured private relay count',
	'Private relay acceptance threshold requires distinct relay origins',
	'Private submission requires at least one relay URL',
	'Relay URL must use HTTPS or loopback HTTP',
	'Relay URLs must not contain embedded credentials',
	'Relay URLs must not contain fragments',
	'Relay URLs must not contain query parameters',
	'Relay URLs must not exceed 2048 characters',
	'Submission mode must be public or private',
])

const PROFILE_SWITCH_MESSAGES = new Set([PROFILE_SWITCH_IN_PROGRESS, EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED, 'Chain profile must be mainnet or sepolia'])

/** Profile switch refusals name the operator step that unblocks them; preflight RPC and file detail stays in protected logs. */
function publicProfileSwitchError(error: unknown) {
	const message = errorMessage(error)
	if (message === EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED) return 'Recover the pending executor deployment under Settings › Venues and executor before switching chains.'
	if (PROFILE_SWITCH_MESSAGES.has(message)) return message
	return 'The chain profile could not be activated. Review protected bot logs.'
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

/** The reference documents in reading order. The first supplies the page's only top-level heading. */
const REFERENCE_DOCUMENTS = ['README.md', 'EXECUTION.md', 'CONFIGURATION.md', 'MARKETS.md', 'RECOVERY.md']

/** The shared bot guide lives outside this package, so the rendered reference links to its published copy. */
const SHARED_BOT_GUIDE_URL = 'https://github.com/AugurProject/zoltar/blob/main/bots/README.md'

/** Heading lines outside fenced code blocks, where a leading `#` is a shell comment rather than a heading. */
function markdownHeadingLines(markdown: string) {
	let fenced = false
	return markdown.split('\n').filter(line => {
		if (line.trimStart().startsWith('```')) fenced = !fenced
		return !fenced && /^#{1,6} /.test(line)
	})
}

/** Demotes every heading one level so a companion document nests under the single page title. */
function demoteMarkdownHeadings(markdown: string) {
	let fenced = false
	return markdown
		.split('\n')
		.map(line => {
			if (line.trimStart().startsWith('```')) fenced = !fenced
			return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line
		})
		.join('\n')
}

function renderReference(documents: readonly string[]) {
	const titleIds = new Map<string, string>()
	for (const [index, document] of documents.entries()) {
		const name = REFERENCE_DOCUMENTS[index]
		const title = markdownHeadingLines(document)[0]
		if (name === undefined || title === undefined) throw new Error('Reference document is missing its title heading')
		titleIds.set(name, markdownHeadingId(title.replace(/^#{1,6} /, '')))
	}
	const markdown = documents.map((document, index) => (index === 0 ? document : demoteMarkdownHeadings(document))).join('\n\n')
	const headingIds = markdownHeadingLines(markdown).map(line => markdownHeadingId(line.replace(/^#{1,6} /, '')))
	if (new Set(headingIds).size !== headingIds.length) throw new Error('Reference documents must not repeat a heading')
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
		.replace(/href="\.\/([A-Z]+\.md)(#[^"]*)?"/g, (_match, ...captures) => {
			const [name, fragment] = captures
			const titleId = typeof name === 'string' ? titleIds.get(name) : undefined
			if (titleId === undefined) throw new Error('Reference link names an unknown document')
			return `href="${typeof fragment === 'string' ? fragment : `#${titleId}`}"`
		})
		.replaceAll('href="../README.md', `href="${SHARED_BOT_GUIDE_URL}`)
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
	const browserFormatSource = Bun.file(join(directory, 'dashboard-format.ts'))
	const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
	const server = startBotDashboardServer({
		directory,
		exposure: { password: controller.password, publicAuthority: controller.publicAuthority },
		hostname: controller.hostname ?? '127.0.0.1',
		loopbackPublished: controller.loopbackPublished,
		notFound: () => new Response('Not found', { status: 404 }),
		pages: ['overview', 'operations', 'games', 'markets', 'settings'],
		pageSlots: [
			['<!-- rep-market-consensus -->', repMarketConsensusPanel],
			['<!-- settings-page -->', settingsPageMarkup],
			['<!-- operator-header -->', operatorHeader],
		],
		port,
		// The shared server rejects cross-origin mutations before routing, so every non-GET route below is same-origin.
		route: async (request, { url }) => {
			if (request.method === 'GET' && (url.pathname === '/documentation' || url.pathname === '/documentation/')) {
				return new Response(Bun.file(join(documentationDirectory, 'operator-guide.html')), { headers: securityHeaders('text/html; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/documentation/reference') {
				const documents = await Promise.all(REFERENCE_DOCUMENTS.map(name => Bun.file(join(projectDirectory, name)).text()))
				return new Response(renderReference(documents), {
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
					const message = logDashboardFailure('arbitrager', 'state-read', error)
					return json({ error: publicPollFailure(message, 'load the latest operator state for the dashboard') }, 503)
				}
			}
			if (request.method === 'GET' && url.pathname === '/api/configuration') {
				try {
					if (controller.getConfiguration === undefined) throw new Error('Complete configuration is unavailable')
					return json(await controller.getConfiguration())
				} catch (error) {
					return publicDashboardError('arbitrager', error, 503, 'configuration-read', 'Complete configuration is unavailable. Retry or check protected bot logs for details.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/configuration') {
				try {
					await requireConfiguredChain(controller)
					if (controller.updateConfiguration === undefined) throw new Error('Complete configuration is unavailable')
					return json(await controller.updateConfiguration(await boundedDashboardJson(request)))
				} catch (error) {
					const conflict = error instanceof Error && error.name === CONFIGURATION_REVISION_CONFLICT
					return publicDashboardError('arbitrager', error, conflict ? 409 : 400, 'configuration-update', publicConfigurationUpdateError(error, conflict))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/settings') {
				try {
					await requireConfiguredChain(controller)
					return json({ settings: await controller.updateStrategy(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'strategy-update', publicStrategyUpdateError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/settlement') {
				try {
					await requireConfiguredChain(controller)
					if (controller.updateSettlement === undefined) throw new Error('Settlement configuration is unavailable')
					return json({ settlement: await controller.updateSettlement(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'settlement-update', publicFieldValidationError(error, 'Settlement ', 'Settlement settings could not be saved. Review the submitted values and protected bot logs.'))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/runtime-limits') {
				try {
					await requireConfiguredChain(controller)
					if (controller.updateRuntimeLimits === undefined) throw new Error('Runtime limit configuration is unavailable')
					return json({ runtime: await controller.updateRuntimeLimits(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'runtime-limits-update', publicFieldValidationError(error, 'Runtime ', 'Risk limits could not be saved. Review the submitted values and protected bot logs.'))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/centralized-markets') {
				try {
					await requireConfiguredChain(controller)
					if (controller.updateCentralizedMarkets === undefined) throw new Error('Market source configuration is unavailable')
					return json({ centralizedMarkets: await controller.updateCentralizedMarkets(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'centralized-markets-update', publicMarketUpdateError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/execution') {
				try {
					await requireConfiguredChain(controller)
					if (controller.updateExecution === undefined) throw new Error('Execution mode configuration is unavailable')
					return json(await controller.updateExecution(await boundedDashboardJson(request)))
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'execution-update', publicExecutionUpdateError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/submission') {
				try {
					await requireConfiguredChain(controller)
					return json({ submission: await controller.updateSubmission(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'submission-update', publicConnectivityError(error, { fallback: 'Submission settings could not be saved. Review the submitted values and protected bot logs.', validationMessages: SUBMISSION_VALIDATION_MESSAGES }))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/connectivity') {
				try {
					return json(await controller.updateConnectivity(await boundedDashboardJson(request)))
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'connectivity-update', publicConnectivityUpdateError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/network-profile') {
				try {
					if (controller.switchNetworkProfile === undefined) throw new Error('Chain profile switching is unavailable')
					return closingJson(await controller.switchNetworkProfile(await boundedDashboardJson(request)))
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'network-profile-switch', publicProfileSwitchError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/deployment') {
				try {
					await requireConfiguredChain(controller)
					if (controller.updateDeployment === undefined) throw new Error('Deployment configuration is unavailable')
					return json({ deployment: await controller.updateDeployment(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'deployment-update', 'Deployment settings could not be saved. Review the submitted values and protected bot logs.')
				}
			}
			if (request.method === 'POST' && url.pathname === '/api/executor-deployment') {
				try {
					await requireConfiguredChain(controller)
					if (controller.deployExecutor === undefined) throw new Error('Executor deployment is unavailable')
					return json(await controller.deployExecutor(await boundedDashboardJson(request)))
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'executor-deployment', publicExecutorDeploymentError(error))
				}
			}
			if (request.method === 'POST' && url.pathname === '/api/executor-prediction') {
				try {
					await requireConfiguredChain(controller)
					if (controller.predictExecutor === undefined) throw new Error('Executor prediction is unavailable')
					return json(await controller.predictExecutor(await boundedDashboardJson(request)))
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'executor-prediction', 'Executor prediction could not be completed. Review the submitted salt and protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/approved-universes') {
				try {
					await requireConfiguredChain(controller)
					if (controller.setApprovedUniverses === undefined) throw new Error('Universe approval is unavailable')
					return json({ approvedUniverses: await controller.setApprovedUniverses(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'universe-approval', 'Universe approval could not be saved. Select only one outcome per fork and review protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/tokens') {
				try {
					await requireConfiguredChain(controller)
					if (controller.updateTokens === undefined) throw new Error('Token configuration is unavailable')
					return json({ tokenAddresses: await controller.updateTokens(await boundedDashboardJson(request)) })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'token-update', 'Token settings could not be saved. Review the submitted addresses and protected bot logs.')
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/signer') {
				try {
					await requireConfiguredChain(controller)
					return json(await controller.updateSigner(await boundedDashboardJson(request)))
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'signer-update', publicSignerUpdateError(error))
				}
			}
			if (request.method === 'PUT' && url.pathname === '/api/paused') {
				try {
					const value = await boundedDashboardJson(request)
					if (typeof value !== 'object' || value === null || !('paused' in value) || typeof value['paused'] !== 'boolean') throw new Error('paused must be a boolean')
					if (!value['paused']) await requireConfiguredChain(controller)
					await controller.setPaused(value['paused'])
					return json({ paused: value['paused'] })
				} catch (error) {
					return publicDashboardError('arbitrager', error, 400, 'pause-update', publicPauseUpdateError(error))
				}
			}
			return undefined
		},
	})
	console.log(`dashboard=http://127.0.0.1:${server.port}`)
	return server
}
