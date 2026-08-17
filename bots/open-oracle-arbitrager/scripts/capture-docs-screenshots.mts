import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress, keccak256, toHex } from '#ethereum'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { operatorSnapshot, publicOperatorFailure, publicPollFailure, type OperatorSnapshot, type OperatorState } from '#state/operator-state'
import type { PositionRecord } from '#state/position-store'

const address = (value: number) => getAddress(`0x${value.toString(16).padStart(40, '0')}`)
const transactionHash = (label: string) => keccak256(toHex(label))
const now = Date.now()
const sampledAt = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
const wallet = address(0xa11ce)
const rep = getAddress('0x221657776846890989a759BA2973e427DfF5C9bB')
const repYes = address(0x1_0001)
const repNo = address(0x1_0002)
const openOracle = address(0x0a11ce)
const executor = address(0xecec)
const pool = address(0x3000)
const hash = transactionHash('open-oracle-documentation-fixture')
const checkedAt = sampledAt(0)
const protectedFailureMarker = 'operator-secret'
const longProviderFailureDetail = ` ${'provider response detail '.repeat(30).trim()}`
const rawRpcFailure = `RPC https://operator:${protectedFailureMarker}@rpc.example/private/provider-key returned HTTP 400 while calling eth_getLogs:${longProviderFailureDetail}`
const rawRelayFailure = `Private relay https://operator:${protectedFailureMarker}@relay.example rejected the transaction:${longProviderFailureDetail}`
const rawNonPollFailure = 'Risk policy requires operator attention'
const expectedRpcPollFailure = publicPollFailure(rawRpcFailure)
const expectedRpcOperatorFailure = publicOperatorFailure(rawRpcFailure)
const expectedRelayOperatorFailure = publicOperatorFailure(rawRelayFailure)
const expectedNonPollFailure = publicOperatorFailure(rawNonPollFailure)
const expectedStateUnavailableFailure = `${publicPollFailure('fixture state endpoint unavailable', 'load the latest operator state for the dashboard')} Use Refresh to retry now.`
let fixtureStatus: OperatorSnapshot['status'] = 'running'
let paused = false
let fixtureAttention: 'error' | 'none' | 'recovery' | 'transaction' = 'none'
let fixturePollFailureMetadata = true
let fixtureRetryInProgress = false
let fixtureNextRetryAt: string | undefined
let fixtureStateUnavailable = false
let fixtureStateHanging = false
let fixtureConnectivityFailure = false
let fixtureConnectivityHanging = false
let fixtureConfigurationHanging = false
let fixtureConfigurationUnavailable = false
let fixtureNetworkConfigured = true
let fixturePauseHanging = false
const fixturePauseRequests: boolean[] = []

async function captureScreenshots(chromium: string, origin: string, outputDirectory: string) {
	const profile = await mkdtemp(join(tmpdir(), 'zoltar-open-oracle-docs-'))
	const child = Bun.spawn([chromium, '--headless', '--hide-scrollbars', '--no-sandbox', '--remote-debugging-port=0', '--run-all-compositor-stages-before-draw', `--user-data-dir=${profile}`, 'about:blank'], {
		stderr: 'pipe',
		stdout: 'ignore',
	})
	try {
		const reader = child.stderr.getReader()
		const decoder = new TextDecoder()
		let diagnostics = ''
		let browserWebSocketUrl: string | undefined
		while (browserWebSocketUrl === undefined) {
			const chunk = await reader.read()
			if (chunk.done) throw new Error(`Chromium stopped before exposing DevTools: ${diagnostics.trim()}`)
			diagnostics += decoder.decode(chunk.value, { stream: true })
			browserWebSocketUrl = diagnostics.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]
		}
		const socket = new WebSocket(browserWebSocketUrl)
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener('open', () => resolve(), { once: true })
			socket.addEventListener('error', () => reject(new Error('Could not connect to Chromium DevTools')), { once: true })
		})
		let nextId = 1
		const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
		const runtimeDiagnostics: string[] = []
		socket.addEventListener('message', event => {
			const response: unknown = JSON.parse(String(event.data))
			if (typeof response !== 'object' || response === null) return
			if ('method' in response && (response.method === 'Runtime.exceptionThrown' || response.method === 'Log.entryAdded')) runtimeDiagnostics.push(JSON.stringify(response))
			if (!('id' in response) || typeof response.id !== 'number') return
			const request = pending.get(response.id)
			if (request === undefined) return
			pending.delete(response.id)
			const error = 'error' in response && typeof response.error === 'object' && response.error !== null && 'message' in response.error && typeof response.error.message === 'string' ? response.error.message : undefined
			if (error !== undefined) request.reject(new Error(error))
			else request.resolve('result' in response ? response.result : undefined)
		})
		const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
			new Promise<unknown>((resolve, reject) => {
				const id = nextId++
				pending.set(id, { reject, resolve })
				socket.send(JSON.stringify({ id, method, params, sessionId }))
			})
		let targetId = ''
		let sessionId = ''
		const replacePage = async (url: string, width: number, height: number) => {
			if (targetId === '') {
				const target = await command('Target.createTarget', { url: 'about:blank' })
				if (typeof target !== 'object' || target === null || !('targetId' in target) || typeof target.targetId !== 'string') throw new Error('Chromium did not create a screenshot target')
				targetId = target.targetId
				const attachment = await command('Target.attachToTarget', { flatten: true, targetId })
				if (typeof attachment !== 'object' || attachment === null || !('sessionId' in attachment) || typeof attachment.sessionId !== 'string') throw new Error('Chromium did not attach to the screenshot target')
				sessionId = attachment.sessionId
				await command('Page.enable', {}, sessionId)
				await command('Runtime.enable', {}, sessionId)
				await command('Log.enable', {}, sessionId)
				await command('Page.addScriptToEvaluateOnNewDocument', { source: `const nativeSetInterval = window.setInterval; window.setInterval = (callback, timeout, ...args) => location.search.includes('allowIntervals=1') ? nativeSetInterval(callback, timeout, ...args) : 0` }, sessionId)
			}
			await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width }, sessionId)
			await command('Emulation.setVisibleSize', { height, width }, sessionId)
			await command('Page.navigate', { url }, sessionId)
			await command('Target.activateTarget', { targetId })
			await command('Page.bringToFront', {}, sessionId)
		}
		const settlePaint = async () => {
			await command('Target.activateTarget', { targetId })
			await command('Page.bringToFront', {}, sessionId)
			await command(
				'Runtime.evaluate',
				{
					awaitPromise: true,
					expression: `(async () => {
						await document.fonts.ready
						await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
					})()`,
				},
				sessionId,
			)
		}
		const capturePng = async (name: string) => {
			await settlePaint()
			const capture = await command('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png', fromSurface: true }, sessionId)
			if (typeof capture !== 'object' || capture === null || !('data' in capture) || typeof capture.data !== 'string') throw new Error(`Chromium did not capture ${name}`)
			const bytes = await Bun.write(join(outputDirectory, name), Buffer.from(capture.data, 'base64'))
			if (bytes === 0) throw new Error(`Chromium wrote an empty ${name}`)
		}
		const assertResumeDialogStart = async (label: string, width: number) => {
			const result = await command(
				'Runtime.evaluate',
				{
					expression: `(() => {
						const dialog = document.querySelector('#resume-dialog')
						const title = document.querySelector('#resume-title')
						const consequence = document.querySelector('#resume-dialog .dialog-body > .muted')
						const firstCheck = document.querySelector('#resume-preflight li')
						const actions = document.querySelector('#resume-dialog .dialog-actions')
						const dialogRect = dialog?.getBoundingClientRect()
						const titleRect = title?.getBoundingClientRect()
						const consequenceRect = consequence?.getBoundingClientRect()
						const firstCheckRect = firstCheck?.getBoundingClientRect()
						return {
							actionsReachable: dialog instanceof HTMLElement && actions instanceof HTMLElement && actions.offsetTop + actions.offsetHeight <= dialog.scrollHeight,
							bodyScrollWidth: document.body.scrollWidth,
							dialogBounded: dialogRect !== undefined && dialogRect.top >= 0 && dialogRect.bottom <= window.innerHeight && dialogRect.left >= 0 && dialogRect.right <= window.innerWidth,
							focusedTitle: document.activeElement === title,
							introVisible: [titleRect, consequenceRect, firstCheckRect].every(rect => rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight),
							open: dialog?.hasAttribute('open'),
							scrollTop: dialog instanceof HTMLElement ? dialog.scrollTop : undefined
						}
					})()`,
					returnByValue: true,
				},
				sessionId,
			)
			const value = typeof result === 'object' && result !== null && 'result' in result && typeof result.result === 'object' && result.result !== null && 'value' in result.result ? result.result.value : undefined
			if (
				typeof value !== 'object' ||
				value === null ||
				!('open' in value) ||
				value.open !== true ||
				!('focusedTitle' in value) ||
				value.focusedTitle !== true ||
				!('scrollTop' in value) ||
				value.scrollTop !== 0 ||
				!('dialogBounded' in value) ||
				value.dialogBounded !== true ||
				!('introVisible' in value) ||
				value.introVisible !== true ||
				!('actionsReachable' in value) ||
				value.actionsReachable !== true ||
				!('bodyScrollWidth' in value) ||
				typeof value.bodyScrollWidth !== 'number' ||
				value.bodyScrollWidth > width
			) {
				throw new Error(`${label} resume dialog lost its safety context: ${JSON.stringify(value)}`)
			}
		}
		const readSafetyActionPositions = async () => {
			const result = await command(
				'Runtime.evaluate',
				{
					expression: `(() => Object.fromEntries(['refresh-button', 'pause-button'].map(id => {
						const element = document.getElementById(id)
						if (!(element instanceof HTMLElement)) return [id, undefined]
						const rect = element.getBoundingClientRect()
						return [id, { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width }]
					})))()`,
					returnByValue: true,
				},
				sessionId,
			)
			return typeof result === 'object' && result !== null && 'result' in result && typeof result.result === 'object' && result.result !== null && 'value' in result.result ? result.result.value : undefined
		}
		const assertStableSafetyActions = (expected: unknown, actual: unknown, label: string) => {
			if (expected === undefined || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} moved mobile safety actions: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
		}
		for (const [name, section] of [
			['dashboard-overview.png', undefined],
			['dashboard-network.png', 'network-connectivity'],
			['dashboard-markets.png', 'token-market-title'],
			...(process.env['OPEN_ORACLE_CAPTURE_QA'] === '1'
				? ([
						['dashboard-network-mobile.png', 'network-connectivity'],
						['dashboard-markets-mobile.png', 'token-market-title'],
						['dashboard-opportunities.png', 'operations'],
						['dashboard-opportunities-mobile.png', 'operations'],
					] as const)
				: []),
			...(process.env['OPEN_ORACLE_CAPTURE_DEPLOYMENT'] === '1'
				? ([
						['deployment-desktop.png', 'deployment-configuration'],
						['deployment-mobile.png', 'deployment-configuration'],
						['deployment-create2.png', 'create2-form'],
					] as const)
				: []),
			...(process.env['OPEN_ORACLE_CAPTURE_CONFIGURATION'] === '1'
				? ([
						['configuration-desktop.png', 'complete-configuration'],
						['configuration-mobile.png', 'complete-configuration'],
					] as const)
				: []),
			...(process.env['OPEN_ORACLE_CAPTURE_SETTINGS'] === '1'
				? ([
						['settings-desktop.png', 'network-connectivity'],
						['settings-mobile.png', 'network-connectivity'],
					] as const)
				: []),
		] as const) {
			const mobile = name === 'dashboard-network-mobile.png' || name === 'dashboard-markets-mobile.png' || name === 'dashboard-opportunities-mobile.png' || name === 'deployment-mobile.png' || name === 'configuration-mobile.png' || name === 'settings-mobile.png'
			const fragment =
				section === undefined ? 'overview' : section === 'operations' ? 'operations' : section === 'token-market-title' ? 'markets' : section === 'network-connectivity' || section === 'deployment-configuration' || section === 'create2-form' || section === 'complete-configuration' ? 'settings' : 'overview'
			await replacePage(`${origin}/`, mobile ? 390 : 1440, mobile ? 844 : 900)
			await Bun.sleep(750)
			if (section !== undefined) {
				await command(
					'Runtime.evaluate',
					{
						expression: `(() => {
							const section = document.getElementById(${JSON.stringify(section)})
							if (section === null) return
							const fragment = ${JSON.stringify(fragment)}
							const directFragment = section.id === fragment
							if (directFragment) window.location.hash = fragment
							else {
								history.replaceState(null, '', '#' + fragment)
								const links = [...document.querySelectorAll('.section-nav a[href^="#"]')]
								const activeLink = links.find(link => link.getAttribute('href') === '#' + fragment)
								for (const link of links) {
									if (link === activeLink) link.setAttribute('aria-current', 'page')
									else link.removeAttribute('aria-current')
								}
								const navigation = activeLink?.closest('.section-nav')
								if (activeLink instanceof HTMLElement && navigation instanceof HTMLElement) {
									const activeRect = activeLink.getBoundingClientRect()
									const navigationRect = navigation.getBoundingClientRect()
									navigation.scrollLeft += activeRect.left - navigationRect.left - (navigationRect.width - activeRect.width) / 2
								}
							}
							if (section instanceof HTMLDetailsElement) section.open = true
							section.closest('details')?.setAttribute('open', '')
							for (const scroller of document.querySelectorAll('.table-scroll')) scroller.scrollLeft = 0
							if (!directFragment) {
								const offset = (document.querySelector('.operator-shell')?.getBoundingClientRect().height ?? 0) + 16
								window.scrollTo(0, Math.max(0, section.getBoundingClientRect().top + window.scrollY - offset))
							}
						})()`,
					},
					sessionId,
				)
				await Bun.sleep(250)
			}
			await settlePaint()
			const layout = await command(
				'Runtime.evaluate',
				{
					expression: `(() => {
						const target = ${section === undefined ? 'undefined' : `document.getElementById(${JSON.stringify(section)})`}
						const active = document.querySelector('.section-nav a[aria-current="page"]')
						const navigation = document.querySelector('.section-nav')
						const activeRect = active?.getBoundingClientRect()
						const navigationRect = navigation?.getBoundingClientRect()
						const safetyTargets = ['mode-badge', 'run-status-badge', 'header-network-badge', 'attention-badge', 'refresh-button', 'pause-button'].map(id => document.getElementById(id))
						return {
							activeHref: active?.getAttribute('href'),
							activeVisible: activeRect !== undefined && navigationRect !== undefined && activeRect.left >= navigationRect.left - 1 && activeRect.right <= navigationRect.right + 1,
							bodyScrollWidth: document.body.scrollWidth,
							clientWidth: document.documentElement.clientWidth,
							headerBottom: document.querySelector('.operator-shell')?.getBoundingClientRect().bottom,
							safetyVisible: safetyTargets.every(target => {
								if (!(target instanceof HTMLElement)) return false
								const rect = target.getBoundingClientRect()
								return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
							}),
							scrollX: window.scrollX,
							targetTop: target?.getBoundingClientRect().top
						}
					})()`,
					returnByValue: true,
				},
				sessionId,
			)
			const result = typeof layout === 'object' && layout !== null && 'result' in layout && typeof layout.result === 'object' && layout.result !== null && 'value' in layout.result ? layout.result.value : undefined
			if (mobile && typeof result === 'object' && result !== null && 'bodyScrollWidth' in result && typeof result.bodyScrollWidth === 'number' && result.bodyScrollWidth > 390) {
				throw new Error(`${name} overflows its 390px viewport at ${result.bodyScrollWidth.toString()}px`)
			}
			if (mobile && (typeof result !== 'object' || result === null || !('safetyVisible' in result) || result.safetyVisible !== true)) throw new Error(`${name} clips a sticky safety control`)
			if (mobile && section !== undefined && typeof result === 'object' && result !== null && 'targetTop' in result && 'headerBottom' in result && typeof result.targetTop === 'number' && typeof result.headerBottom === 'number' && result.targetTop < result.headerBottom) {
				throw new Error(`${name} places its target behind the sticky header`)
			}
			if (typeof result !== 'object' || result === null || !('activeHref' in result) || result.activeHref !== `#${fragment}` || !('activeVisible' in result) || result.activeVisible !== true) throw new Error(`${name} does not show its active ${fragment} navigation item`)
			await capturePng(name)
		}
		if (process.env['OPEN_ORACLE_CAPTURE_SETTINGS'] === '1') {
			await replacePage(`${origin}/?mutation=connectivity-error#settings`, 390, 844)
			await Bun.sleep(750)
			fixtureConnectivityFailure = true
			await command(
				'Runtime.evaluate',
				{
					expression: `(() => {
						const group = document.querySelector('#network-connectivity')
						if (group instanceof HTMLDetailsElement) group.open = true
						document.querySelector('#connectivity-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
					})()`,
				},
				sessionId,
			)
			await Bun.sleep(350)
			const connectivityFailure = await command(
				'Runtime.evaluate',
				{
					expression: `(() => {
						const group = document.querySelector('#network-connectivity')
						if (group instanceof HTMLElement) {
							const offset = (document.querySelector('.operator-shell')?.getBoundingClientRect().height ?? 0) + 16
							window.scrollTo(0, Math.max(0, group.getBoundingClientRect().top + window.scrollY - offset))
						}
						return {
							bodyContainsCredential: document.body.textContent?.includes(${JSON.stringify(protectedFailureMarker)}) === true,
							fieldsetDisabled: document.querySelector('#connectivity-fieldset')?.disabled,
							status: document.querySelector('#connectivity-status')?.textContent
						}
					})()`,
					returnByValue: true,
				},
				sessionId,
			)
			const value = typeof connectivityFailure === 'object' && connectivityFailure !== null && 'result' in connectivityFailure && typeof connectivityFailure.result === 'object' && connectivityFailure.result !== null && 'value' in connectivityFailure.result ? connectivityFailure.result.value : undefined
			if (
				typeof value !== 'object' ||
				value === null ||
				!('bodyContainsCredential' in value) ||
				value.bodyContainsCredential !== false ||
				!('fieldsetDisabled' in value) ||
				value.fieldsetDisabled !== false ||
				!('status' in value) ||
				value.status !== 'RPC connectivity checks failed. Review the submitted endpoints and retry.'
			) {
				throw new Error(`Connectivity mutation exposed unsafe failure text: ${JSON.stringify(value)}`)
			}
			await capturePng('connectivity-error-mobile.png')
			const unexpectedMutationDiagnostics = runtimeDiagnostics.filter(diagnostic => !diagnostic.includes('Failed to load resource: the server responded with a status of 400 (Bad Request)') || !diagnostic.includes('/api/connectivity'))
			if (unexpectedMutationDiagnostics.length > 0) throw new Error(`Chromium reported unexpected connectivity-mutation diagnostics: ${unexpectedMutationDiagnostics.join('\n')}`)
			runtimeDiagnostics.length = 0
			fixtureConnectivityFailure = false
			await command('Runtime.evaluate', { expression: `document.querySelector('#connectivity-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))` }, sessionId)
			await Bun.sleep(350)
			const connectivityRecovery = await command(
				'Runtime.evaluate',
				{
					expression: `(() => ({
					fieldsetDisabled: document.querySelector('#connectivity-fieldset')?.disabled,
					status: document.querySelector('#connectivity-status')?.textContent
				}))()`,
					returnByValue: true,
				},
				sessionId,
			)
			const recoveryValue = typeof connectivityRecovery === 'object' && connectivityRecovery !== null && 'result' in connectivityRecovery && typeof connectivityRecovery.result === 'object' && connectivityRecovery.result !== null && 'value' in connectivityRecovery.result ? connectivityRecovery.result.value : undefined
			if (typeof recoveryValue !== 'object' || recoveryValue === null || !('fieldsetDisabled' in recoveryValue) || recoveryValue.fieldsetDisabled !== false || !('status' in recoveryValue) || recoveryValue.status !== 'Chain and RPCs passed validation, were saved, and apply to the next scan.') {
				throw new Error(`Connectivity mutation did not recover after retry: ${JSON.stringify(recoveryValue)}`)
			}
		}
		if (process.env['OPEN_ORACLE_CAPTURE_CONFIGURATION_STATES'] === '1') {
			const readConfigurationState = async () => {
				const result = await command(
					'Runtime.evaluate',
					{
						expression: `(() => ({
							bodyScrollWidth: document.body.scrollWidth,
							clientWidth: document.documentElement.clientWidth,
							containerHidden: document.querySelector('#settings-load-state')?.hidden,
							allDependentDisabled: ['strategy-fieldset', 'submission-fieldset', 'connectivity-fieldset', 'deployment-fieldset', 'create2-fieldset', 'tokens-fieldset'].every(id => document.getElementById(id)?.hasAttribute('disabled') === true),
							allDependentEnabled: ['strategy-fieldset', 'submission-fieldset', 'connectivity-fieldset', 'deployment-fieldset', 'create2-fieldset', 'tokens-fieldset'].every(id => document.getElementById(id)?.hasAttribute('disabled') === false),
							deploymentDisabled: document.querySelector('#deployment-fieldset')?.disabled,
							retryHidden: document.querySelector('#retry-settings-button')?.hidden,
							status: document.querySelector('#settings-load-status')?.textContent,
							strategyDisabled: document.querySelector('#strategy-fieldset')?.disabled,
							submissionDisabled: document.querySelector('#submission-fieldset')?.disabled
						}))()`,
						returnByValue: true,
					},
					sessionId,
				)
				return typeof result === 'object' && result !== null && 'result' in result && typeof result.result === 'object' && result.result !== null && 'value' in result.result ? result.result.value : undefined
			}
			const assertConfigurationControls = (value: unknown, disabled: boolean, label: string, width: number) => {
				if (
					typeof value !== 'object' ||
					value === null ||
					!('strategyDisabled' in value) ||
					value.strategyDisabled !== disabled ||
					!('allDependentDisabled' in value) ||
					!('allDependentEnabled' in value) ||
					(disabled ? value.allDependentDisabled !== true : value.allDependentEnabled !== true) ||
					!('submissionDisabled' in value) ||
					value.submissionDisabled !== disabled ||
					!('deploymentDisabled' in value) ||
					value.deploymentDisabled !== disabled ||
					!('bodyScrollWidth' in value) ||
					typeof value.bodyScrollWidth !== 'number' ||
					value.bodyScrollWidth > width
				) {
					throw new Error(`${label} configuration controls are unsafe: ${JSON.stringify(value)}`)
				}
			}
			for (const mobile of [false, true]) {
				const width = mobile ? 390 : 1440
				const height = mobile ? 844 : 900
				fixtureConfigurationHanging = true
				await replacePage(`${origin}/?configuration=loading-${mobile ? 'mobile' : 'desktop'}#settings`, width, height)
				await Bun.sleep(150)
				const loading = await readConfigurationState()
				assertConfigurationControls(loading, true, 'Loading', width)
				if (typeof loading !== 'object' || loading === null || !('containerHidden' in loading) || loading.containerHidden !== false || !('retryHidden' in loading) || loading.retryHidden !== true || !('status' in loading) || loading.status !== 'Loading operator configuration…') {
					throw new Error(`Configuration loading state is not visible: ${JSON.stringify(loading)}`)
				}
				await capturePng(`configuration-loading-${mobile ? 'mobile' : 'desktop'}.png`)
				fixtureConfigurationHanging = false
				await Bun.sleep(350)
				const loaded = await readConfigurationState()
				assertConfigurationControls(loaded, false, 'Loaded', width)
				if (typeof loaded !== 'object' || loaded === null || !('containerHidden' in loaded) || loaded.containerHidden !== true) throw new Error(`Configuration loading did not resolve: ${JSON.stringify(loaded)}`)

				fixtureConfigurationUnavailable = true
				fixtureConnectivityHanging = true
				await command('Runtime.evaluate', { expression: `document.querySelector('#connectivity-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))` }, sessionId)
				await Bun.sleep(50)
				await command('Runtime.evaluate', { expression: `document.querySelector('#reload-configuration-button')?.click()` }, sessionId)
				await Bun.sleep(350)
				const reloadFailed = await readConfigurationState()
				assertConfigurationControls(reloadFailed, true, 'Failed reload', width)
				if (
					typeof reloadFailed !== 'object' ||
					reloadFailed === null ||
					!('containerHidden' in reloadFailed) ||
					reloadFailed.containerHidden !== false ||
					!('retryHidden' in reloadFailed) ||
					reloadFailed.retryHidden !== false ||
					!('status' in reloadFailed) ||
					typeof reloadFailed.status !== 'string' ||
					!reloadFailed.status.includes('Complete configuration is unavailable.')
				) {
					throw new Error(`Failed configuration reload left stale controls available: ${JSON.stringify(reloadFailed)}`)
				}
				fixtureConnectivityHanging = false
				await Bun.sleep(350)
				const connectivityCompletedAfterReloadFailure = await readConfigurationState()
				assertConfigurationControls(connectivityCompletedAfterReloadFailure, true, 'Connectivity completed after failed reload', width)
				fixtureConfigurationUnavailable = false
				await command('Runtime.evaluate', { expression: `document.querySelector('#retry-settings-button')?.click()` }, sessionId)
				await Bun.sleep(350)
				const reloadRecovered = await readConfigurationState()
				assertConfigurationControls(reloadRecovered, false, 'Reload-recovered', width)
				if (typeof reloadRecovered !== 'object' || reloadRecovered === null || !('containerHidden' in reloadRecovered) || reloadRecovered.containerHidden !== true) throw new Error(`Failed configuration reload did not recover: ${JSON.stringify(reloadRecovered)}`)

				fixtureConfigurationUnavailable = true
				await replacePage(`${origin}/?configuration=failed-${mobile ? 'mobile' : 'desktop'}#settings`, width, height)
				await Bun.sleep(750)
				const failed = await readConfigurationState()
				assertConfigurationControls(failed, true, 'Failed', width)
				if (
					typeof failed !== 'object' ||
					failed === null ||
					!('containerHidden' in failed) ||
					failed.containerHidden !== false ||
					!('retryHidden' in failed) ||
					failed.retryHidden !== false ||
					!('status' in failed) ||
					typeof failed.status !== 'string' ||
					!failed.status.includes('Complete configuration is unavailable.')
				) {
					throw new Error(`Configuration failure has no visible recovery: ${JSON.stringify(failed)}`)
				}
				await capturePng(`configuration-failed-${mobile ? 'mobile' : 'desktop'}.png`)
				fixtureConfigurationUnavailable = false
				await command('Runtime.evaluate', { expression: `document.querySelector('#retry-settings-button')?.click()` }, sessionId)
				await Bun.sleep(350)
				const recovered = await readConfigurationState()
				assertConfigurationControls(recovered, false, 'Recovered', width)
				if (typeof recovered !== 'object' || recovered === null || !('containerHidden' in recovered) || recovered.containerHidden !== true) throw new Error(`Configuration retry did not recover: ${JSON.stringify(recovered)}`)

				fixtureConfigurationHanging = true
				await replacePage(`${origin}/?configuration=hanging-${mobile ? 'mobile' : 'desktop'}#settings`, width, height)
				await Bun.sleep(2_250)
				const timedOut = await readConfigurationState()
				assertConfigurationControls(timedOut, true, 'Timed-out', width)
				if (
					typeof timedOut !== 'object' ||
					timedOut === null ||
					!('containerHidden' in timedOut) ||
					timedOut.containerHidden !== false ||
					!('retryHidden' in timedOut) ||
					timedOut.retryHidden !== false ||
					!('status' in timedOut) ||
					timedOut.status !== 'Configuration request timed out. Editable settings remain locked.'
				) {
					throw new Error(`Hanging configuration request did not time out visibly: ${JSON.stringify(timedOut)}`)
				}
				await capturePng(`configuration-timeout-${mobile ? 'mobile' : 'desktop'}.png`)
				fixtureConfigurationHanging = false
				await command('Runtime.evaluate', { expression: `document.querySelector('#retry-settings-button')?.click()` }, sessionId)
				await Bun.sleep(350)
				const timeoutRecovery = await readConfigurationState()
				assertConfigurationControls(timeoutRecovery, false, 'Timeout-recovered', width)
				if (typeof timeoutRecovery !== 'object' || timeoutRecovery === null || !('containerHidden' in timeoutRecovery) || timeoutRecovery.containerHidden !== true) throw new Error(`Timed-out configuration retry did not recover: ${JSON.stringify(timeoutRecovery)}`)
			}
			const unexpectedConfigurationDiagnostics = runtimeDiagnostics.filter(diagnostic => !diagnostic.includes('Failed to load resource: the server responded with a status of 503 (Service Unavailable)') || !diagnostic.includes('/api/configuration'))
			if (unexpectedConfigurationDiagnostics.length > 0) throw new Error(`Chromium reported unexpected configuration diagnostics: ${unexpectedConfigurationDiagnostics.join('\n')}`)
			runtimeDiagnostics.length = 0
		}
		if (process.env['OPEN_ORACLE_CAPTURE_RESUME'] === '1') {
			fixtureNetworkConfigured = false
			paused = true
			const unconfiguredPauseRequestCount = fixturePauseRequests.length
			for (const mobile of [false, true]) {
				const width = mobile ? 390 : 1440
				const height = mobile ? 844 : 900
				await replacePage(`${origin}/?resume=network-unconfigured-${mobile ? 'mobile' : 'desktop'}`, width, height)
				await Bun.sleep(750)
				const unconfiguredResume = await command(
					'Runtime.evaluate',
					{
						expression: `(() => {
							const pause = document.querySelector('#pause-button')
							const confirm = document.querySelector('#confirm-resume')
							pause?.click()
							confirm?.click()
							return {
								attentionHref: document.querySelector('#attention-badge')?.getAttribute('href'),
								attentionText: document.querySelector('#attention-badge')?.textContent,
								confirmDisabled: confirm?.disabled,
								pauseBusy: pause?.getAttribute('aria-busy'),
								pauseCursor: pause instanceof HTMLElement ? getComputedStyle(pause).cursor : undefined,
								pauseDisabled: pause?.disabled,
								resumeOpen: document.querySelector('#resume-dialog')?.hasAttribute('open')
							}
						})()`,
						returnByValue: true,
					},
					sessionId,
				)
				await Bun.sleep(100)
				const unconfiguredResumeValue = typeof unconfiguredResume === 'object' && unconfiguredResume !== null && 'result' in unconfiguredResume && typeof unconfiguredResume.result === 'object' && unconfiguredResume.result !== null && 'value' in unconfiguredResume.result ? unconfiguredResume.result.value : undefined
				if (
					typeof unconfiguredResumeValue !== 'object' ||
					unconfiguredResumeValue === null ||
					!('pauseDisabled' in unconfiguredResumeValue) ||
					unconfiguredResumeValue.pauseDisabled !== true ||
					!('attentionHref' in unconfiguredResumeValue) ||
					unconfiguredResumeValue.attentionHref !== '#network-connectivity' ||
					!('attentionText' in unconfiguredResumeValue) ||
					unconfiguredResumeValue.attentionText !== '1 action' ||
					!('pauseBusy' in unconfiguredResumeValue) ||
					unconfiguredResumeValue.pauseBusy !== null ||
					!('pauseCursor' in unconfiguredResumeValue) ||
					unconfiguredResumeValue.pauseCursor !== 'not-allowed' ||
					!('confirmDisabled' in unconfiguredResumeValue) ||
					unconfiguredResumeValue.confirmDisabled !== true ||
					!('resumeOpen' in unconfiguredResumeValue) ||
					unconfiguredResumeValue.resumeOpen !== false ||
					fixturePauseRequests.length !== unconfiguredPauseRequestCount
				) {
					throw new Error(`Unconfigured network exposed Resume: ${JSON.stringify({ requests: fixturePauseRequests.length - unconfiguredPauseRequestCount, state: unconfiguredResumeValue })}`)
				}
				await capturePng(`resume-network-unconfigured-${mobile ? 'mobile' : 'desktop'}.png`)
			}
			fixtureNetworkConfigured = true
			paused = false
			for (const mobile of [false, true]) {
				const width = mobile ? 390 : 1440
				const height = mobile ? 844 : 900
				await replacePage(`${origin}/?pause=pending-${mobile ? 'mobile' : 'desktop'}`, width, height)
				await Bun.sleep(750)
				fixturePauseHanging = true
				let pendingPauseValue: unknown
				try {
					await command('Runtime.evaluate', { expression: `document.querySelector('#pause-button')?.click()` }, sessionId)
					await Bun.sleep(100)
					const pendingPause = await command(
						'Runtime.evaluate',
						{
							expression: `(() => {
								const pause = document.querySelector('#pause-button')
								return {
									busy: pause?.getAttribute('aria-busy'),
									cursor: pause instanceof HTMLElement ? getComputedStyle(pause).cursor : undefined,
									disabled: pause?.disabled,
									text: pause?.textContent
								}
							})()`,
							returnByValue: true,
						},
						sessionId,
					)
					pendingPauseValue = typeof pendingPause === 'object' && pendingPause !== null && 'result' in pendingPause && typeof pendingPause.result === 'object' && pendingPause.result !== null && 'value' in pendingPause.result ? pendingPause.result.value : undefined
					await capturePng(`pause-pending-${mobile ? 'mobile' : 'desktop'}.png`)
				} finally {
					fixturePauseHanging = false
				}
				await Bun.sleep(350)
				if (
					typeof pendingPauseValue !== 'object' ||
					pendingPauseValue === null ||
					!('busy' in pendingPauseValue) ||
					pendingPauseValue.busy !== 'true' ||
					!('cursor' in pendingPauseValue) ||
					pendingPauseValue.cursor !== 'wait' ||
					!('disabled' in pendingPauseValue) ||
					pendingPauseValue.disabled !== true ||
					!('text' in pendingPauseValue) ||
					pendingPauseValue.text !== 'Pausing…'
				) {
					throw new Error(`Pending Pause did not expose a busy control: ${JSON.stringify(pendingPauseValue)}`)
				}
				paused = false
			}
			paused = true
			for (const mobile of [false, true]) {
				const width = mobile ? 390 : 1440
				const height = mobile ? 844 : 900
				await replacePage(`${origin}/?resume=pending-${mobile ? 'mobile' : 'desktop'}`, width, height)
				await Bun.sleep(750)
				await command('Runtime.evaluate', { expression: `document.querySelector('#pause-button')?.click()` }, sessionId)
				await Bun.sleep(100)
				await assertResumeDialogStart(`${mobile ? 'Mobile' : 'Desktop'} initial`, width)
				fixturePauseHanging = true
				let pendingResumeValue: unknown
				try {
					await command('Runtime.evaluate', { expression: `document.querySelector('#confirm-resume')?.click()` }, sessionId)
					await Bun.sleep(100)
					await assertResumeDialogStart(`${mobile ? 'Mobile' : 'Desktop'} pending`, width)
					const pendingResume = await command(
						'Runtime.evaluate',
						{
							expression: `(() => {
								const confirm = document.querySelector('#confirm-resume')
								return {
									busy: confirm?.getAttribute('aria-busy'),
									cursor: confirm instanceof HTMLElement ? getComputedStyle(confirm).cursor : undefined,
									disabled: confirm?.disabled,
									resumeOpen: document.querySelector('#resume-dialog')?.hasAttribute('open'),
									text: confirm?.textContent
								}
							})()`,
							returnByValue: true,
						},
						sessionId,
					)
					pendingResumeValue = typeof pendingResume === 'object' && pendingResume !== null && 'result' in pendingResume && typeof pendingResume.result === 'object' && pendingResume.result !== null && 'value' in pendingResume.result ? pendingResume.result.value : undefined
					await capturePng(`resume-pending-${mobile ? 'mobile' : 'desktop'}.png`)
				} finally {
					fixturePauseHanging = false
				}
				await Bun.sleep(350)
				if (
					typeof pendingResumeValue !== 'object' ||
					pendingResumeValue === null ||
					!('busy' in pendingResumeValue) ||
					pendingResumeValue.busy !== 'true' ||
					!('cursor' in pendingResumeValue) ||
					pendingResumeValue.cursor !== 'wait' ||
					!('disabled' in pendingResumeValue) ||
					pendingResumeValue.disabled !== true ||
					!('resumeOpen' in pendingResumeValue) ||
					pendingResumeValue.resumeOpen !== true ||
					!('text' in pendingResumeValue) ||
					pendingResumeValue.text !== 'Resuming…'
				) {
					throw new Error(`Pending Resume did not expose a busy control: ${JSON.stringify(pendingResumeValue)}`)
				}
				paused = true
			}
			paused = false
			await replacePage(`${origin}/`, 1440, 900)
			await Bun.sleep(750)
			await command('Runtime.evaluate', { expression: `document.querySelector('#pause-button')?.click()` }, sessionId)
			await Bun.sleep(2_250)
			await command('Runtime.evaluate', { expression: `document.querySelector('#pause-button')?.click()` }, sessionId)
			await Bun.sleep(250)
			await settlePaint()
			await capturePng('resume-preflight.png')
		}
		if (process.env['OPEN_ORACLE_CAPTURE_STATUS'] === '1') {
			let mobileSafetyActionPositions: unknown
			for (const status of ['running', 'paused', 'syncing', 'error'] as const) {
				fixtureStatus = status
				paused = status === 'paused'
				fixtureAttention = status === 'error' ? 'error' : 'none'
				for (const mobile of [false, true]) {
					const width = mobile ? 390 : 1440
					const height = mobile ? 844 : 900
					await replacePage(`${origin}/?status=${status}-${mobile ? 'mobile' : 'desktop'}`, width, height)
					await Bun.sleep(750)
					if (status === 'error') {
						await command('Runtime.evaluate', { expression: `document.querySelector('#attention-badge')?.click()` }, sessionId)
						await Bun.sleep(250)
					}
					await settlePaint()
					if (mobile) {
						const actionPositions = await readSafetyActionPositions()
						if (status === 'running') mobileSafetyActionPositions = actionPositions
						else assertStableSafetyActions(mobileSafetyActionPositions, actionPositions, `${status} status`)
					}
					const state = await command(
						'Runtime.evaluate',
						{
							expression: `(() => {
								const badge = document.querySelector('#run-status-badge')
								const active = document.querySelector('.section-nav a[aria-current="page"]')
								const attention = document.querySelector('#attention-badge')
								const header = document.querySelector('.operator-shell')
								const notice = document.querySelector('#notice')
								return {
									activeHref: active?.getAttribute('href'),
									attentionHref: attention?.getAttribute('href'),
									attentionText: attention?.textContent,
									bodyScrollWidth: document.body.scrollWidth,
									clientWidth: document.documentElement.clientWidth,
									disputePathsEmptyText: document.querySelector('#dispute-paths-empty')?.textContent,
									hash: window.location.hash,
									label: badge?.textContent,
									noticeCopy: document.querySelector('#notice-copy')?.textContent,
									retryLabel: document.querySelector('#retry-status-badge')?.textContent,
									retryLive: document.querySelector('#retry-status-badge')?.getAttribute('aria-live'),
									retryVisible: document.querySelector('#retry-status-badge')?.getBoundingClientRect().height !== 0,
									bodyContainsCredential: document.body.textContent?.includes('operator-secret') === true,
									endpointText: document.querySelector('#endpoint-checks')?.textContent,
									noticeTitle: document.querySelector('#notice-title')?.textContent,
									noticeTone: notice instanceof HTMLElement ? notice.dataset.tone : undefined,
									operationDetailsWidth: document.querySelector('#operations-body td[data-label="Details"]')?.getBoundingClientRect().width,
									operationReasonWidth: document.querySelector('#operations-body td[data-label="Why"]')?.getBoundingClientRect().width,
									operationTableWidth: document.querySelector('#operations-body')?.closest('table')?.getBoundingClientRect().width,
									operationText: document.querySelector('#operations-body')?.textContent,
									status: badge instanceof HTMLElement ? badge.dataset.status : undefined,
									transactionTableWidth: document.querySelector('#transactions-body')?.closest('table')?.getBoundingClientRect().width,
									transactionTargetWidth: document.querySelector('#transactions-body td[data-label="Target results"]')?.getBoundingClientRect().width,
									transactionText: document.querySelector('#transactions-body')?.textContent,
								}
							})()`,
							returnByValue: true,
						},
						sessionId,
					)
					const value = typeof state === 'object' && state !== null && 'result' in state && typeof state.result === 'object' && state.result !== null && 'value' in state.result ? state.result.value : undefined
					if (typeof value !== 'object' || value === null || !('status' in value) || value.status !== status) throw new Error(`Run badge did not render ${status}`)
					if (!('disputePathsEmptyText' in value) || value.disputePathsEmptyText !== 'No historical dispute path is available. Configured coordinator mode reads current reports directly, while coordinator-free diagnostic mode reconstructs paths from its configured event lookback.') {
						throw new Error('Empty dispute paths did not explain both discovery modes')
					}
					if (
						status === 'error' &&
						(!('attentionHref' in value) ||
							value.attentionHref !== '#notice' ||
							!('attentionText' in value) ||
							value.attentionText !== '1 action' ||
							!('hash' in value) ||
							value.hash !== '#notice' ||
							!('activeHref' in value) ||
							value.activeHref !== '#overview' ||
							!('noticeTone' in value) ||
							value.noticeTone !== 'danger' ||
							!('noticeTitle' in value) ||
							value.noticeTitle !== 'Latest poll failed' ||
							!('noticeCopy' in value) ||
							typeof value.noticeCopy !== 'string' ||
							!value.noticeCopy.startsWith(expectedRpcPollFailure.replace(/ Automatic retry remains active\.$/, '')) ||
							!value.noticeCopy.includes('returned HTTP 400 while calling eth_getLogs') ||
							value.noticeCopy.match(/eth_getLogs/g)?.length !== 1 ||
							!value.noticeCopy.includes('Poll failed at ') ||
							!value.noticeCopy.includes('Next automatic retry is scheduled for ') ||
							!('retryLabel' in value) ||
							typeof value.retryLabel !== 'string' ||
							!value.retryLabel.startsWith('Retry in ') ||
							!('retryVisible' in value) ||
							value.retryVisible !== true ||
							!('retryLive' in value) ||
							value.retryLive !== null ||
							!('bodyContainsCredential' in value) ||
							value.bodyContainsCredential !== false ||
							!('endpointText' in value) ||
							typeof value.endpointText !== 'string' ||
							!value.endpointText.includes(expectedRpcOperatorFailure) ||
							!('operationDetailsWidth' in value) ||
							typeof value.operationDetailsWidth !== 'number' ||
							value.operationDetailsWidth > 480 ||
							!('operationReasonWidth' in value) ||
							typeof value.operationReasonWidth !== 'number' ||
							value.operationReasonWidth > 480 ||
							!('operationTableWidth' in value) ||
							typeof value.operationTableWidth !== 'number' ||
							value.operationDetailsWidth > value.operationTableWidth ||
							value.operationReasonWidth > value.operationTableWidth ||
							!('operationText' in value) ||
							typeof value.operationText !== 'string' ||
							!value.operationText.includes(expectedRelayOperatorFailure) ||
							!('transactionTargetWidth' in value) ||
							typeof value.transactionTargetWidth !== 'number' ||
							value.transactionTargetWidth > 480 ||
							!('transactionTableWidth' in value) ||
							typeof value.transactionTableWidth !== 'number' ||
							value.transactionTargetWidth > value.transactionTableWidth ||
							!('transactionText' in value) ||
							typeof value.transactionText !== 'string' ||
							!value.transactionText.includes(expectedRelayOperatorFailure))
					)
						throw new Error('Error state did not expose its attention and recovery context')
					if (status !== 'error' && (!('retryVisible' in value) || value.retryVisible !== false)) throw new Error(`${status} state displayed a retry badge without an active retry`)
					if (mobile && 'bodyScrollWidth' in value && typeof value.bodyScrollWidth === 'number' && value.bodyScrollWidth > width) throw new Error(`${status} header overflows its ${width.toString()}px viewport`)
					if (status === 'error') {
						await replacePage(`${origin}/?status=error-${mobile ? 'mobile' : 'desktop'}-capture`, width, height)
						await Bun.sleep(750)
						await command('Runtime.evaluate', { expression: `window.scrollTo(0, 0)` }, sessionId)
						await settlePaint()
						const captureLayout = await command(
							'Runtime.evaluate',
							{
								expression: `(() => {
									const visibleInViewport = element => {
										if (!(element instanceof HTMLElement) || getComputedStyle(element).display === 'none') return false
										const rect = element.getBoundingClientRect()
										return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
									}
									const title = document.querySelector('h1')
									const navigation = document.querySelector('.section-nav')
									const safetyControls = [...document.querySelectorAll('.operator-safety > :not([hidden])')].filter(element => getComputedStyle(element).display !== 'none')
									return { navigationVisible: visibleInViewport(navigation), safetyVisible: safetyControls.length > 0 && safetyControls.every(visibleInViewport), titleVisible: visibleInViewport(title) }
								})()`,
								returnByValue: true,
							},
							sessionId,
						)
						const captureLayoutValue = typeof captureLayout === 'object' && captureLayout !== null && 'result' in captureLayout && typeof captureLayout.result === 'object' && captureLayout.result !== null && 'value' in captureLayout.result ? captureLayout.result.value : undefined
						if (
							typeof captureLayoutValue !== 'object' ||
							captureLayoutValue === null ||
							!('navigationVisible' in captureLayoutValue) ||
							captureLayoutValue.navigationVisible !== true ||
							!('safetyVisible' in captureLayoutValue) ||
							captureLayoutValue.safetyVisible !== true ||
							!('titleVisible' in captureLayoutValue) ||
							captureLayoutValue.titleVisible !== true
						) {
							throw new Error(`Error-state capture did not preserve its complete safety header at ${width.toString()}px`)
						}
					}
					const name = `status-${status}-${mobile ? 'mobile' : 'desktop'}.png`
					await capturePng(name)
				}
			}
			fixturePollFailureMetadata = false
			for (const mobile of [false, true]) {
				const width = mobile ? 390 : 1440
				await replacePage(`${origin}/?status=operator-attention-${mobile ? 'mobile' : 'desktop'}`, width, mobile ? 844 : 900)
				await Bun.sleep(750)
				const attentionState = await command(
					'Runtime.evaluate',
					{ expression: `({ copy: document.querySelector('#notice-copy')?.textContent, retryVisible: document.querySelector('#retry-status-badge')?.getBoundingClientRect().height !== 0, title: document.querySelector('#notice-title')?.textContent })`, returnByValue: true },
					sessionId,
				)
				const attentionValue = typeof attentionState === 'object' && attentionState !== null && 'result' in attentionState && typeof attentionState.result === 'object' && attentionState.result !== null && 'value' in attentionState.result ? attentionState.result.value : undefined
				if (
					typeof attentionValue !== 'object' ||
					attentionValue === null ||
					!('copy' in attentionValue) ||
					attentionValue.copy !== expectedNonPollFailure ||
					!('retryVisible' in attentionValue) ||
					attentionValue.retryVisible !== false ||
					!('title' in attentionValue) ||
					attentionValue.title !== 'Operator attention required'
				) {
					throw new Error(`Recovered poll metadata leaked into an operator warning at ${width.toString()}px`)
				}
				await capturePng(`status-operator-attention-${mobile ? 'mobile' : 'desktop'}.png`)
			}
			fixturePollFailureMetadata = true
			fixtureRetryInProgress = true
			for (const mobile of [false, true]) {
				const width = mobile ? 390 : 1440
				await replacePage(`${origin}/?status=retrying-${mobile ? 'mobile' : 'desktop'}`, width, mobile ? 844 : 900)
				await Bun.sleep(750)
				const retryingState = await command(
					'Runtime.evaluate',
					{
						expression: `({ badge: document.querySelector('#retry-status-badge')?.textContent, live: document.querySelector('#retry-status-badge')?.getAttribute('aria-live'), notice: document.querySelector('#notice-title')?.textContent, noticeCopy: document.querySelector('#notice-copy')?.textContent, scrollWidth: document.body.scrollWidth })`,
						returnByValue: true,
					},
					sessionId,
				)
				const value = typeof retryingState === 'object' && retryingState !== null && 'result' in retryingState && typeof retryingState.result === 'object' && retryingState.result !== null && 'value' in retryingState.result ? retryingState.result.value : undefined
				if (
					typeof value !== 'object' ||
					value === null ||
					!('badge' in value) ||
					value.badge !== 'Retrying now' ||
					!('live' in value) ||
					value.live !== null ||
					!('notice' in value) ||
					value.notice !== 'Automatic retry in progress' ||
					!('noticeCopy' in value) ||
					typeof value.noticeCopy !== 'string' ||
					!value.noticeCopy.includes('Poll failed at ') ||
					!value.noticeCopy.includes('Automatic retry started at ') ||
					!('scrollWidth' in value) ||
					value.scrollWidth !== width
				) {
					throw new Error(`Retry-in-progress state was not visible at ${width.toString()}px`)
				}
				await capturePng(`status-retrying-${mobile ? 'mobile' : 'desktop'}.png`)
			}
			fixtureRetryInProgress = false
			for (const mobile of [false, true]) {
				const width = mobile ? 390 : 1440
				fixtureNextRetryAt = new Date(Date.now() + 700).toISOString()
				await replacePage(`${origin}/?status=retry-boundary-${mobile ? 'mobile' : 'desktop'}&allowIntervals=1`, width, mobile ? 844 : 900)
				await Bun.sleep(400)
				const scheduledLabel = await command('Runtime.evaluate', { expression: `document.querySelector('#retry-status-badge')?.textContent`, returnByValue: true }, sessionId)
				const scheduledValue = typeof scheduledLabel === 'object' && scheduledLabel !== null && 'result' in scheduledLabel && typeof scheduledLabel.result === 'object' && scheduledLabel.result !== null && 'value' in scheduledLabel.result ? scheduledLabel.result.value : undefined
				if (typeof scheduledValue !== 'string' || !scheduledValue.startsWith('Retry in ')) throw new Error(`Retry boundary did not begin in its scheduled state at ${width.toString()}px`)
				await Bun.sleep(1_800)
				const boundaryLabel = await command('Runtime.evaluate', { expression: `({ badge: document.querySelector('#retry-status-badge')?.textContent, notice: document.querySelector('#notice-copy')?.textContent })`, returnByValue: true }, sessionId)
				const boundaryValue = typeof boundaryLabel === 'object' && boundaryLabel !== null && 'result' in boundaryLabel && typeof boundaryLabel.result === 'object' && boundaryLabel.result !== null && 'value' in boundaryLabel.result ? boundaryLabel.result.value : undefined
				if (
					typeof boundaryValue !== 'object' ||
					boundaryValue === null ||
					!('badge' in boundaryValue) ||
					boundaryValue.badge !== 'Retry due' ||
					!('notice' in boundaryValue) ||
					typeof boundaryValue.notice !== 'string' ||
					!boundaryValue.notice.includes('Automatic retry became due at ') ||
					boundaryValue.notice.includes('Automatic retry started at ')
				) {
					throw new Error(`Retry boundary did not advance without claiming an unconfirmed attempt at ${width.toString()}px: ${JSON.stringify(boundaryValue)}`)
				}
				await capturePng(`status-retry-due-${mobile ? 'mobile' : 'desktop'}.png`)
			}
			fixtureNextRetryAt = undefined
			for (const retrying of [false, true]) {
				fixtureRetryInProgress = retrying
				for (const mobile of [false, true]) {
					const width = mobile ? 390 : 1440
					await replacePage(`${origin}/?status=${retrying ? 'retrying' : 'scheduled'}-disconnect-${mobile ? 'mobile' : 'desktop'}`, width, mobile ? 844 : 900)
					await Bun.sleep(350)
					fixtureStateUnavailable = true
					await command('Runtime.evaluate', { expression: `document.querySelector('#refresh-button')?.click()` }, sessionId)
					await Bun.sleep(250)
					const disconnectedState = await command(
						'Runtime.evaluate',
						{
							expression: `({ retryActive: document.querySelector('#retry-status-badge')?.parentElement?.hasAttribute('data-retry-active'), retryVisible: document.querySelector('#retry-status-badge')?.getBoundingClientRect().height !== 0, runStatus: document.querySelector('#run-status-badge')?.textContent })`,
							returnByValue: true,
						},
						sessionId,
					)
					const disconnectedValue = typeof disconnectedState === 'object' && disconnectedState !== null && 'result' in disconnectedState && typeof disconnectedState.result === 'object' && disconnectedState.result !== null && 'value' in disconnectedState.result ? disconnectedState.result.value : undefined
					if (
						typeof disconnectedValue !== 'object' ||
						disconnectedValue === null ||
						!('retryActive' in disconnectedValue) ||
						disconnectedValue.retryActive !== false ||
						!('retryVisible' in disconnectedValue) ||
						disconnectedValue.retryVisible !== false ||
						!('runStatus' in disconnectedValue) ||
						disconnectedValue.runStatus !== 'Disconnected'
					) {
						throw new Error(`${retrying ? 'Active' : 'Scheduled'} retry remained visible after disconnect at ${width.toString()}px`)
					}
					fixtureStateUnavailable = false
				}
			}
			runtimeDiagnostics.length = 0
			fixtureRetryInProgress = false
			fixtureStatus = 'running'
			paused = false
			fixtureAttention = 'none'
			if (runtimeDiagnostics.length > 0) throw new Error(`Chromium reported unexpected diagnostics before connection-failure QA: ${runtimeDiagnostics.join('\n')}`)
			for (const mobile of [false, true]) {
				const width = mobile ? 390 : 1440
				const height = mobile ? 844 : 900
				fixtureStateUnavailable = true
				await replacePage(`${origin}/?connection=initial-${mobile ? 'mobile' : 'desktop'}`, width, height)
				await Bun.sleep(750)
				const readConnectionState = async () => {
					const result = await command(
						'Runtime.evaluate',
						{
							expression: `(() => {
								const refresh = document.querySelector('#refresh-button')
								const pause = document.querySelector('#pause-button')
								const refreshBounds = refresh?.getBoundingClientRect()
								const pauseBounds = pause?.getBoundingClientRect()
								const refreshTextRange = document.createRange()
								if (refresh !== null) refreshTextRange.selectNodeContents(refresh)
								const refreshTextBounds = refreshTextRange.getBoundingClientRect()
								const safetyVisible = ['mode-badge', 'run-status-badge', 'header-network-badge', 'attention-badge', 'refresh-button', 'pause-button'].every(id => {
									const target = document.getElementById(id)
									if (!(target instanceof HTMLElement)) return false
									const rect = target.getBoundingClientRect()
									return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
								})
								return {
									attentionHref: document.querySelector('#attention-badge')?.getAttribute('href'),
									attentionText: document.querySelector('#attention-badge')?.textContent,
									bodyScrollWidth: document.body.scrollWidth,
									mode: document.querySelector('#mode-badge')?.textContent,
									network: document.querySelector('#header-network-badge')?.textContent,
									noticeCopy: document.querySelector('#notice-copy')?.textContent,
									noticeTitle: document.querySelector('#notice-title')?.textContent,
									confirmDisabled: document.querySelector('#confirm-resume')?.disabled,
									pauseDisabled: document.querySelector('#pause-button')?.disabled,
									refreshBusy: document.querySelector('#refresh-button')?.getAttribute('aria-busy'),
									refreshDisabled: document.querySelector('#refresh-button')?.disabled,
									refreshTextFits: refreshBounds !== undefined && refreshTextBounds.left >= refreshBounds.left && refreshTextBounds.right <= refreshBounds.right,
									refreshDoesNotOverlapPause: refreshBounds !== undefined && pauseBounds !== undefined && refreshBounds.right <= pauseBounds.left,
									refreshText: document.querySelector('#refresh-button')?.textContent,
									resumeOpen: document.querySelector('#resume-dialog')?.hasAttribute('open'),
									runStatus: document.querySelector('#run-status-badge')?.textContent,
									safetyVisible,
									scrollX: window.scrollX
								}
							})()`,
							returnByValue: true,
						},
						sessionId,
					)
					return typeof result === 'object' && result !== null && 'result' in result && typeof result.result === 'object' && result.result !== null && 'value' in result.result ? result.result.value : undefined
				}
				const initialFailure = await readConnectionState()
				if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(), 'Initial connection failure')
				if (
					typeof initialFailure !== 'object' ||
					initialFailure === null ||
					!('attentionHref' in initialFailure) ||
					initialFailure.attentionHref !== '#notice' ||
					!('attentionText' in initialFailure) ||
					initialFailure.attentionText !== '1 action' ||
					!('mode' in initialFailure) ||
					initialFailure.mode !== 'Mode unavailable' ||
					!('network' in initialFailure) ||
					initialFailure.network !== 'Network unavailable' ||
					!('noticeCopy' in initialFailure) ||
					initialFailure.noticeCopy !== expectedStateUnavailableFailure ||
					!('noticeTitle' in initialFailure) ||
					initialFailure.noticeTitle !== 'Dashboard disconnected' ||
					!('pauseDisabled' in initialFailure) ||
					initialFailure.pauseDisabled !== true ||
					!('runStatus' in initialFailure) ||
					initialFailure.runStatus !== 'Disconnected' ||
					!('safetyVisible' in initialFailure) ||
					initialFailure.safetyVisible !== true ||
					!('bodyScrollWidth' in initialFailure) ||
					typeof initialFailure.bodyScrollWidth !== 'number' ||
					initialFailure.bodyScrollWidth > width ||
					!('scrollX' in initialFailure) ||
					initialFailure.scrollX !== 0
				) {
					throw new Error(`Initial state-request failure is unsafe: ${JSON.stringify(initialFailure)}`)
				}
				await capturePng(`connection-initial-failure-${mobile ? 'mobile' : 'desktop'}.png`)
				fixtureStateUnavailable = false
				await replacePage(`${origin}/?connection=post-success-${mobile ? 'mobile' : 'desktop'}`, width, height)
				await Bun.sleep(750)
				fixtureStateUnavailable = true
				await command('Runtime.evaluate', { expression: `document.querySelector('#refresh-button')?.click()` }, sessionId)
				await Bun.sleep(250)
				const postSuccessFailure = await readConnectionState()
				if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(), 'Post-success connection failure')
				if (
					typeof postSuccessFailure !== 'object' ||
					postSuccessFailure === null ||
					!('attentionText' in postSuccessFailure) ||
					postSuccessFailure.attentionText !== '1 action' ||
					!('network' in postSuccessFailure) ||
					postSuccessFailure.network !== 'mainnet · 1 · last known' ||
					!('noticeCopy' in postSuccessFailure) ||
					postSuccessFailure.noticeCopy !== expectedStateUnavailableFailure ||
					!('noticeTitle' in postSuccessFailure) ||
					postSuccessFailure.noticeTitle !== 'Dashboard disconnected' ||
					!('pauseDisabled' in postSuccessFailure) ||
					postSuccessFailure.pauseDisabled !== false ||
					!('runStatus' in postSuccessFailure) ||
					postSuccessFailure.runStatus !== 'Disconnected' ||
					!('safetyVisible' in postSuccessFailure) ||
					postSuccessFailure.safetyVisible !== true ||
					!('bodyScrollWidth' in postSuccessFailure) ||
					typeof postSuccessFailure.bodyScrollWidth !== 'number' ||
					postSuccessFailure.bodyScrollWidth > width ||
					!('scrollX' in postSuccessFailure) ||
					postSuccessFailure.scrollX !== 0
				) {
					throw new Error(`Post-success state-request failure is unsafe: ${JSON.stringify(postSuccessFailure)}`)
				}
				await capturePng(`connection-post-success-failure-${mobile ? 'mobile' : 'desktop'}.png`)
				const pauseRequestCount = fixturePauseRequests.length
				await command('Runtime.evaluate', { expression: `document.querySelector('#pause-button')?.click()` }, sessionId)
				await Bun.sleep(250)
				if (fixturePauseRequests.length !== pauseRequestCount + 1 || fixturePauseRequests.at(-1) !== true) throw new Error('Emergency Pause did not reach the bot while state polling was unavailable')
				paused = false
				fixtureStateUnavailable = false
				await command('Runtime.evaluate', { expression: `document.querySelector('#refresh-button')?.click()` }, sessionId)
				await Bun.sleep(250)
				const recovery = await readConnectionState()
				if (
					typeof recovery !== 'object' ||
					recovery === null ||
					!('attentionText' in recovery) ||
					recovery.attentionText !== 'No blockers' ||
					!('network' in recovery) ||
					recovery.network !== 'mainnet · 1' ||
					!('pauseDisabled' in recovery) ||
					recovery.pauseDisabled !== false ||
					!('runStatus' in recovery) ||
					recovery.runStatus !== 'Running'
				) {
					throw new Error(`State-request recovery did not restore the safety shell: ${JSON.stringify(recovery)}`)
				}
				await replacePage(`${origin}/?connection=hung-${mobile ? 'mobile' : 'desktop'}`, width, height)
				await Bun.sleep(750)
				fixtureStateHanging = true
				await command('Runtime.evaluate', { expression: `document.querySelector('#refresh-button')?.click()` }, sessionId)
				await Bun.sleep(100)
				const pendingRefresh = await readConnectionState()
				if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(), 'Pending manual refresh')
				if (
					typeof pendingRefresh !== 'object' ||
					pendingRefresh === null ||
					!('refreshBusy' in pendingRefresh) ||
					pendingRefresh.refreshBusy !== 'true' ||
					!('refreshDisabled' in pendingRefresh) ||
					pendingRefresh.refreshDisabled !== true ||
					!('refreshText' in pendingRefresh) ||
					pendingRefresh.refreshText !== 'Refreshing…' ||
					!('refreshTextFits' in pendingRefresh) ||
					pendingRefresh.refreshTextFits !== true ||
					!('refreshDoesNotOverlapPause' in pendingRefresh) ||
					pendingRefresh.refreshDoesNotOverlapPause !== true
				) {
					throw new Error(`Manual Refresh did not expose a busy control: ${JSON.stringify(pendingRefresh)}`)
				}
				await capturePng(`refresh-pending-${mobile ? 'mobile' : 'desktop'}.png`)
				await Bun.sleep(1_150)
				const hungRequest = await readConnectionState()
				if (
					typeof hungRequest !== 'object' ||
					hungRequest === null ||
					!('attentionText' in hungRequest) ||
					hungRequest.attentionText !== '1 action' ||
					!('confirmDisabled' in hungRequest) ||
					hungRequest.confirmDisabled !== true ||
					!('pauseDisabled' in hungRequest) ||
					hungRequest.pauseDisabled !== false ||
					!('resumeOpen' in hungRequest) ||
					hungRequest.resumeOpen !== false ||
					!('runStatus' in hungRequest) ||
					hungRequest.runStatus !== 'Disconnected' ||
					!('refreshBusy' in hungRequest) ||
					hungRequest.refreshBusy !== null ||
					!('refreshDisabled' in hungRequest) ||
					hungRequest.refreshDisabled !== false ||
					!('refreshText' in hungRequest) ||
					hungRequest.refreshText !== 'Refresh'
				) {
					throw new Error(`Hung state request did not fail closed after its deadline: ${JSON.stringify(hungRequest)}`)
				}
				fixtureStateHanging = false
				await replacePage(`${origin}/?connection=hung-recovery-${mobile ? 'mobile' : 'desktop'}`, width, height)
				await Bun.sleep(750)
				paused = true
				await replacePage(`${origin}/?connection=resume-preflight-${mobile ? 'mobile' : 'desktop'}`, width, height)
				await Bun.sleep(750)
				await command('Runtime.evaluate', { expression: `document.querySelector('#pause-button')?.click()` }, sessionId)
				await Bun.sleep(100)
				const openPreflight = await readConnectionState()
				if (typeof openPreflight !== 'object' || openPreflight === null || !('resumeOpen' in openPreflight) || openPreflight.resumeOpen !== true || !('confirmDisabled' in openPreflight) || openPreflight.confirmDisabled !== false) {
					throw new Error(`Resume preflight did not open from current state: ${JSON.stringify(openPreflight)}`)
				}
				fixtureStateUnavailable = true
				await command('Runtime.evaluate', { expression: `document.querySelector('#refresh-button')?.click()` }, sessionId)
				await Bun.sleep(250)
				const stalePreflight = await readConnectionState()
				if (typeof stalePreflight !== 'object' || stalePreflight === null || !('resumeOpen' in stalePreflight) || stalePreflight.resumeOpen !== false || !('confirmDisabled' in stalePreflight) || stalePreflight.confirmDisabled !== true) {
					throw new Error(`Disconnected resume preflight remained actionable: ${JSON.stringify(stalePreflight)}`)
				}
				fixtureStateUnavailable = false
				await command('Runtime.evaluate', { expression: `document.querySelector('#refresh-button')?.click()` }, sessionId)
				await Bun.sleep(250)
				const preflightRecovery = await readConnectionState()
				if (typeof preflightRecovery !== 'object' || preflightRecovery === null || !('confirmDisabled' in preflightRecovery) || preflightRecovery.confirmDisabled !== false) {
					throw new Error(`Resume confirmation did not recover after current state returned: ${JSON.stringify(preflightRecovery)}`)
				}
				paused = false
			}
			const unexpectedConnectionDiagnostics = runtimeDiagnostics.filter(diagnostic => !diagnostic.includes('Failed to load resource: the server responded with a status of 503 (Service Unavailable)') || !diagnostic.includes('/api/state'))
			if (unexpectedConnectionDiagnostics.length > 0) throw new Error(`Chromium reported unexpected connection-failure diagnostics: ${unexpectedConnectionDiagnostics.join('\n')}`)
			runtimeDiagnostics.length = 0
		}
		if (process.env['OPEN_ORACLE_CAPTURE_QA'] === '1') {
			for (const attention of ['recovery', 'transaction'] as const) {
				fixtureAttention = attention
				const expectedTarget = attention === 'recovery' ? 'position-lifecycle' : 'transaction-tracking'
				const expectedSection = 'operations'
				for (const mobile of [false, true]) {
					const width = mobile ? 390 : 1440
					const height = mobile ? 844 : 900
					await replacePage(`${origin}/?attention=${attention}-${mobile ? 'mobile' : 'desktop'}`, width, height)
					await Bun.sleep(750)
					await command('Runtime.evaluate', { expression: `document.querySelector('#attention-badge')?.click()` }, sessionId)
					await Bun.sleep(250)
					await settlePaint()
					const navigation = await command(
						'Runtime.evaluate',
						{
							expression: `(() => {
								const active = document.querySelector('.section-nav a[aria-current="page"]')
								const activeRect = active?.getBoundingClientRect()
								const header = document.querySelector('.operator-shell')
								const nav = document.querySelector('.section-nav')
								const navRect = nav?.getBoundingClientRect()
								const target = document.getElementById(${JSON.stringify(expectedTarget)})
								return {
									activeHref: active?.getAttribute('href'),
									activeVisible: activeRect !== undefined && navRect !== undefined && activeRect.left >= navRect.left - 1 && activeRect.right <= navRect.right + 1,
									bodyScrollWidth: document.body.scrollWidth,
									hash: window.location.hash,
									headerBottom: header?.getBoundingClientRect().bottom,
									targetTop: target?.getBoundingClientRect().top
								}
							})()`,
							returnByValue: true,
						},
						sessionId,
					)
					const value = typeof navigation === 'object' && navigation !== null && 'result' in navigation && typeof navigation.result === 'object' && navigation.result !== null && 'value' in navigation.result ? navigation.result.value : undefined
					if (
						typeof value !== 'object' ||
						value === null ||
						!('activeHref' in value) ||
						value.activeHref !== `#${expectedSection}` ||
						!('activeVisible' in value) ||
						value.activeVisible !== true ||
						!('hash' in value) ||
						value.hash !== `#${expectedTarget}` ||
						!('headerBottom' in value) ||
						!('targetTop' in value) ||
						typeof value.headerBottom !== 'number' ||
						typeof value.targetTop !== 'number' ||
						value.targetTop < value.headerBottom ||
						(mobile && 'bodyScrollWidth' in value && typeof value.bodyScrollWidth === 'number' && value.bodyScrollWidth > width)
					)
						throw new Error(`${attention} attention navigation failed at ${width.toString()}px`)
					const name = `attention-${attention}-${mobile ? 'mobile' : 'desktop'}.png`
					await capturePng(name)
				}
			}
			fixtureAttention = 'none'
		}
		if (runtimeDiagnostics.length > 0) throw new Error(`Chromium reported ${runtimeDiagnostics.length.toString()} runtime or console errors: ${runtimeDiagnostics.join('\n')}`)
		if (targetId !== '') await command('Target.closeTarget', { targetId })
		socket.close()
	} finally {
		child.kill()
		await child.exited
		await rm(profile, { force: true, recursive: true })
	}
}

const history = [
	{
		actualGasCostEth: '0.0011',
		blockNumber: '23841995',
		direction: 'sell-rep' as const,
		estimatedNetProfitWeth: '0.0184',
		estimatedProfitBeforeGasEth: '0.0202',
		executedAt: sampledAt(74),
		pool,
		poolFee: 3_000,
		reportId: '814',
		requiredToken: '42',
		requiredWeth: '0.164',
		token: rep,
		tokenSymbol: 'REPv2',
		trackedNetProfitEth: '0.0179',
		transactionHash: transactionHash('fixture-814'),
	},
	{
		actualGasCostEth: '0.0013',
		blockNumber: '23842041',
		direction: 'buy-rep' as const,
		estimatedNetProfitWeth: '0.0121',
		estimatedProfitBeforeGasEth: '0.0140',
		executedAt: sampledAt(51),
		pool,
		poolFee: 500,
		reportId: '815',
		requiredToken: '31',
		requiredWeth: '0.128',
		token: repYes,
		tokenSymbol: 'REPv2_YES',
		trackedNetProfitEth: '0.0114',
		transactionHash: transactionHash('fixture-815'),
	},
	{
		actualGasCostEth: '0.0010',
		blockNumber: '23842088',
		direction: 'sell-rep' as const,
		estimatedNetProfitWeth: '0.0158',
		estimatedProfitBeforeGasEth: '0.0174',
		executedAt: sampledAt(28),
		pool,
		poolFee: 3_000,
		reportId: '816',
		requiredToken: '38',
		requiredWeth: '0.151',
		token: repNo,
		tokenSymbol: 'REPv2_NO',
		trackedNetProfitEth: '0.0151',
		transactionHash: transactionHash('fixture-816'),
	},
]

const tokenMarkets = [
	{
		address: rep,
		balance: '184.25',
		decimals: 18,
		name: 'Reputation',
		pools: [
			{ address: address(0x3101), fee: 3_000, liquidity: '168234922505184', priceWeth: '0.00418', url: 'https://etherscan.io/address/0x0000000000000000000000000000000000003101', venue: 'Uniswap V3' },
			{ address: address(0x3102), fee: 3_000, liquidity: '8240 REPv2 / 34.18 WETH', priceWeth: '0.004147', url: 'https://etherscan.io/address/0x0000000000000000000000000000000000003102', venue: 'Uniswap V2' },
		],
		symbol: 'REPv2',
	},
	{
		address: repYes,
		balance: '71',
		decimals: 18,
		name: 'Reputation YES',
		pools: [{ address: address(0x3201), fee: 10_000, liquidity: '28100821380564', priceWeth: '0.00372', url: 'https://etherscan.io/address/0x0000000000000000000000000000000000003201', venue: 'Uniswap V3' }],
		symbol: 'REPv2_YES',
	},
	{
		address: repNo,
		balance: '55',
		decimals: 18,
		name: 'Reputation NO',
		pools: [],
		symbol: 'REPv2_NO',
	},
]

const priceHistory = tokenMarkets.flatMap(token =>
	token.pools.flatMap(poolSnapshot =>
		poolSnapshot.priceWeth === undefined
			? []
			: [35, 28, 21, 14, 7, 0].map((minutesAgo, index) => ({
					blockNumber: (23_842_080 + index * 12).toString(),
					pool: poolSnapshot.address,
					priceWeth: (Number(poolSnapshot.priceWeth) * (0.985 + index * 0.006)).toFixed(7),
					sampledAt: sampledAt(minutesAgo),
					symbol: token.symbol,
					token: token.address,
					venue: `${poolSnapshot.venue} ${(poolSnapshot.fee / 10_000).toString()}%`,
				})),
	),
)

const openPosition = {
	account: wallet,
	actualEntryGasCostEth: '0.0034',
	capitalAtRiskWeth: '0.151',
	closedAt: undefined,
	direction: 'sell-rep',
	entryTransactionHash: hash,
	entryTransactionHashes: [hash],
	gasExpenditures: [{ costEth: '0.0034', minedAt: sampledAt(1), transactionHash: hash }],
	historyOutbox: undefined,
	hedgeAmountToken: '38',
	hedgeWeth: '0.1692',
	hedgedProfitBeforeGasEth: '0.0182',
	lifecycleGasCostEth: '0',
	lifecycleReceiptRecovered: false,
	lifecycleTargetBlockNumber: undefined,
	lifecycleTokenDecimals: undefined,
	lifecycleTransactionHashes: [],
	lifecycleUpdatedAt: undefined,
	lifecycleWalletTokenBefore: undefined,
	lifecycleWalletWethBefore: undefined,
	lockedToken: '38',
	lockedWeth: '0.151',
	manualReconciliation: undefined,
	openedAt: sampledAt(1),
	realizedNetProfitEth: undefined,
	reportId: '816',
	status: 'open',
	token: repNo,
	tokenSymbol: 'REPv2_NO',
	withdrawnToken: '0',
	withdrawnWeth: '0',
} satisfies PositionRecord

const closedPositionHash = transactionHash('closed-open-oracle-documentation-fixture')
const closedPosition = {
	account: wallet,
	actualEntryGasCostEth: '0.0011',
	capitalAtRiskWeth: '0.164',
	closedAt: sampledAt(60),
	direction: 'sell-rep',
	entryTransactionHash: closedPositionHash,
	entryTransactionHashes: [closedPositionHash],
	gasExpenditures: [
		{ costEth: '0.0011', minedAt: sampledAt(74), transactionHash: closedPositionHash },
		{ costEth: '0.0008', minedAt: sampledAt(60), transactionHash: transactionHash('closed-lifecycle-documentation-fixture') },
	],
	historyOutbox: undefined,
	hedgeAmountToken: '42',
	hedgeWeth: '0.1955',
	hedgedProfitBeforeGasEth: '0.0315',
	lifecycleGasCostEth: '0.0008',
	lifecycleReceiptRecovered: true,
	lifecycleSettlerRewardEth: '0.002',
	lifecycleTargetBlockNumber: undefined,
	lifecycleTokenDecimals: undefined,
	lifecycleTransactionHashes: [],
	lifecycleUpdatedAt: sampledAt(60),
	lifecycleWalletTokenBefore: undefined,
	lifecycleWalletWethBefore: undefined,
	lockedToken: '42',
	lockedWeth: '0.164',
	manualReconciliation: undefined,
	openedAt: sampledAt(74),
	realizedNetProfitEth: '0.0316',
	reportId: '814',
	status: 'closed',
	token: rep,
	tokenSymbol: 'REPv2',
	withdrawnToken: '42',
	withdrawnWeth: '0.164',
} satisfies PositionRecord

const positions = [openPosition, closedPosition]
const positionDerivedSnapshot = operatorSnapshot(
	{
		activeReportCount: 0,
		balances: undefined,
		blockNumber: '23842152',
		blockTimestamp: Math.floor((now - 4_000) / 1_000).toString(),
		centralizedMarket: {
			assetId: rep,
			askDepthAttoEth: 63n * 10n ** 17n,
			bidDepthAttoEth: 71n * 10n ** 17n,
			chainId: 1,
			maximumPriceRepPerEth: 1042n * 10n ** 16n,
			minimumPriceRepPerEth: 1031n * 10n ** 16n,
			observations: [
				{ assetId: rep, askDepthAttoEth: 34n * 10n ** 17n, bestAskQuote: '9.72', bestBidQuote: '9.68', bidDepthAttoEth: 38n * 10n ** 17n, chainId: 1, ethTickerTimestamp: now, exchangeId: 'kraken', observedAt: now, orderBookTimestamp: now, priceRepPerEth: 1031n * 10n ** 16n, repMarket: 'REP/USD', usesEthTicker: true },
				{
					assetId: rep,
					askDepthAttoEth: 29n * 10n ** 17n,
					bestAskQuote: '0.097',
					bestBidQuote: '0.096',
					bidDepthAttoEth: 33n * 10n ** 17n,
					chainId: 1,
					ethTickerTimestamp: undefined,
					exchangeId: 'coinbase',
					observedAt: now,
					orderBookTimestamp: now,
					priceRepPerEth: 1042n * 10n ** 16n,
					repMarket: 'REP/ETH',
					usesEthTicker: false,
				},
			],
			priceRepPerEth: 10365n * 10n ** 15n,
			reasons: [],
			reliable: true,
		},
		marketConsensus: {
			assetId: rep,
			cex: {
				askDepthAttoEth: 63n * 10n ** 17n,
				bidDepthAttoEth: 71n * 10n ** 17n,
				kind: 'cex',
				maximumPriceRepPerEth: 1042n * 10n ** 16n,
				minimumPriceRepPerEth: 1031n * 10n ** 16n,
				observations: [
					{ assetId: rep, askDepthAttoEth: 34n * 10n ** 17n, bidDepthAttoEth: 38n * 10n ** 17n, chainId: 1, kind: 'cex', observationId: 'kraken:1', observedAt: now, priceRepPerEth: 1031n * 10n ** 16n, sourceId: 'kraken' },
					{ assetId: rep, askDepthAttoEth: 29n * 10n ** 17n, bidDepthAttoEth: 33n * 10n ** 17n, chainId: 1, kind: 'cex', observationId: 'coinbase:1', observedAt: now, priceRepPerEth: 1042n * 10n ** 16n, sourceId: 'coinbase' },
				],
				priceRepPerEth: 10365n * 10n ** 15n,
				reasons: [],
				reliable: true,
			},
			chainId: 1,
			dex: {
				askDepthAttoEth: 48n * 10n ** 17n,
				bidDepthAttoEth: 52n * 10n ** 17n,
				kind: 'dex',
				maximumPriceRepPerEth: 1041n * 10n ** 16n,
				minimumPriceRepPerEth: 1037n * 10n ** 16n,
				observations: [
					{ assetId: rep, askDepthAttoEth: 24n * 10n ** 17n, bidDepthAttoEth: 26n * 10n ** 17n, chainId: 1, kind: 'dex', observationId: 'uniswap-v2:1', observedAt: now, priceRepPerEth: 1037n * 10n ** 16n, sourceId: 'uniswap-v2' },
					{ assetId: rep, askDepthAttoEth: 24n * 10n ** 17n, bidDepthAttoEth: 26n * 10n ** 17n, chainId: 1, kind: 'dex', observationId: 'uniswap-v3:1', observedAt: now, priceRepPerEth: 1041n * 10n ** 16n, sourceId: 'uniswap-v3' },
				],
				priceRepPerEth: 1039n * 10n ** 16n,
				reasons: [],
				reliable: true,
			},
			priceRepPerEth: 103775n * 10n ** 14n,
			reasons: [],
			reliable: true,
			sourceCount: 4,
		},
		endpointChecks: [],
		executionHistory: [],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		operationLog: [],
		opportunities: [],
		paused: false,
		positions,
		priceHistory: [],
		reportPaths: [],
		status: 'running',
		tokenAddresses: [],
		tokenMarkets: [],
		transactionActivity: [],
	} satisfies OperatorState,
	{
		maxSpotTwapTicks: 120n,
		minimumProfitBps: 100n,
		minimumProfitAttoWeth: 10n ** 16n,
		minimumRemainingBlocks: 3n,
		minimumRemainingSeconds: 36n,
		pollMilliseconds: 12_000,
		twapSeconds: 1_800,
	},
	{ minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: ['https://relay.flashbots.net/'] },
	{ publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://read.example/' },
	{ execute: true, executor, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle, queuedWallet: undefined, savedWallet: wallet, wallet },
	{ lifecycleGasReserveAttoWeth: 10n ** 16n, maxConcurrentPositions: 2, maxDailyGasSpendAttoWeth: 5n * 10n ** 16n, maxPositionNotionalAttoWeth: 5n * 10n ** 18n, maxTotalLockedAttoWeth: 10n * 10n ** 18n },
)

const snapshot = {
	activeReportCount: 3,
	balances: { availableEth: '1.842', availableRep: '184.25', availableWeth: '2.375', repValueWeth: '0.770165', totalValueWeth: '4.987165' },
	blockNumber: '23842152',
	blockTimestamp: Math.floor((now - 4_000) / 1_000).toString(),
	centralizedMarket: positionDerivedSnapshot.centralizedMarket,
	marketConsensus: positionDerivedSnapshot.marketConsensus,
	connectivity: { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://read.example/' },
	deployment: positionDerivedSnapshot.deployment,
	endpointChecks: [
		{ chainId: 1, checkedAt, error: undefined, kind: 'read-rpc' as const, status: 'healthy' as const, target: 'https://read.example' },
		{ chainId: 1, checkedAt, error: undefined, kind: 'public-rpc' as const, status: 'healthy' as const, target: 'https://rpc.example' },
		{ chainId: 1, checkedAt, error: undefined, kind: 'private-relay' as const, status: 'healthy' as const, target: 'https://relay.flashbots.net' },
	],
	rpcEndpointHealth: [
		{ consecutiveFailures: 0, error: undefined, lastFailureAt: undefined, lastSuccessAt: sampledAt(0), latencyMilliseconds: 76, nextRetryAt: undefined, status: 'healthy', target: 'https://rpc.example' },
		{ consecutiveFailures: 1, error: 'HTTP 503 while calling eth_blockNumber', lastFailureAt: sampledAt(0), lastSuccessAt: undefined, latencyMilliseconds: 112, nextRetryAt: sampledAt(60), status: 'degraded', target: 'https://quorum.example' },
	],
	execute: true,
	executionHistory: history,
	executionHistoryRecordCount: history.length,
	executor,
	expectedChainId: 1,
	explorerUrl: 'https://etherscan.io',
	gameCapital: { eth: '0.06', totalEthWeth: '1.284', weth: '1.224' },
	lastError: undefined,
	lastPollAt: sampledAt(0),
	mode: 'execute' as const,
	network: 'mainnet' as const,
	networkConfigured: true,
	openOracle,
	operationLog: [
		{ category: 'decision' as const, details: 'net 0.0158 ETH · 992 bps', level: 'info' as const, message: 'Selected profitable sell-REP dispute', reason: 'quote, TWAP, inventory, and risk checks passed', reportId: '816', timestamp: sampledAt(1) },
		{ category: 'transaction' as const, details: 'https://relay.flashbots.net', level: 'info' as const, message: 'Atomic entry accepted', reason: 'target block 23842153', reportId: '816', timestamp: sampledAt(1) },
		{ category: 'configuration' as const, details: '3 supported REP-family tokens', level: 'info' as const, message: 'Token catalog synchronized', reason: undefined, reportId: undefined, timestamp: sampledAt(2) },
	],
	opportunities: [
		{
			centralizedPriceDeviationBps: '86',
			decision: 'selected' as const,
			direction: 'sell-rep' as const,
			estimatedNetProfitEth: '0.0158',
			estimatedNetProfitWeth: '0.0158',
			executablePriceRepPerEth: '10.284',
			hasRequiredInventory: true,
			pool,
			poolFee: 3_000,
			reportId: '816',
			requiredToken: '38',
			requiredWeth: '0.151',
			timeRemaining: '27',
			token: repNo,
			tokenSymbol: 'REPv2_NO',
			venue: 'uniswap-v4' as const,
			windowUnit: 'blocks' as const,
		},
		{
			centralizedPriceDeviationBps: undefined,
			decision: 'unprofitable' as const,
			direction: 'buy-rep' as const,
			estimatedNetProfitEth: '-0.0012',
			estimatedNetProfitWeth: '-0.0012',
			executablePriceRepPerEth: '9.845',
			hasRequiredInventory: true,
			pool: address(0x3201),
			poolFee: 10_000,
			reportId: '817',
			requiredToken: '24',
			requiredWeth: '0.098',
			timeRemaining: '42',
			token: repYes,
			tokenSymbol: 'REPv2_YES',
			venue: 'uniswap-v3' as const,
			windowUnit: 'blocks' as const,
		},
	],
	paused: false,
	positionRecordCount: positionDerivedSnapshot.positionRecordCount,
	positions: positionDerivedSnapshot.positions,
	priceHistory,
	queuedWallet: undefined,
	reportPaths: [
		{
			reportId: '816',
			settled: false,
			steps: [
				{ amount1: '38', amount2: '0.151', blockNumber: '23842088', event: 'submitted' as const, reporter: address(0xb0b), transactionHash: transactionHash('submitted-816') },
				{ amount1: '40', amount2: '0.159', blockNumber: '23842112', event: 'disputed' as const, reporter: wallet, transactionHash: hash },
			],
		},
	],
	risk: positionDerivedSnapshot.risk,
	savedWallet: wallet,
	settings: { maxSpotTwapTicks: '120', minimumProfitBps: '100', minimumProfitWeth: '0.01', minimumRemainingBlocks: '3', minimumRemainingSeconds: '36', pollMilliseconds: 12_000, twapSeconds: 1_800 },
	status: 'running' as const,
	submission: { minimumBundleRelaySuccesses: 1, mode: 'private' as const, relayUrls: ['https://relay.flashbots.net/'] },
	tokenAddresses: [rep, repYes, repNo],
	tokenMarkets,
	totalActualGasCostEth: '0.0034',
	totalEstimatedNetProfitEth: '0.0463',
	totalEstimatedNetProfitWeth: '0.0463',
	totalHedgedProfitBeforeGasEth: positionDerivedSnapshot.totalHedgedProfitBeforeGasEth,
	totalOpenHedgedNetProfitEth: positionDerivedSnapshot.totalOpenHedgedNetProfitEth,
	totalRealizedNetProfitEth: positionDerivedSnapshot.totalRealizedNetProfitEth,
	totalRevenueBeforeGasEth: '0.0516',
	totalTrackedNetProfitEth: '0.0444',
	transactionActivity: [
		{
			acceptedTargets: ['https://relay.flashbots.net'],
			actualGasCostEth: undefined,
			estimatedNetProfitEth: '0.0158',
			failedTargets: [],
			hash,
			kind: 'dispute' as const,
			mode: 'private' as const,
			originalHash: hash,
			reportId: '816',
			status: 'pending' as const,
			submittedAt: sampledAt(1),
			token: repNo,
			tokenSymbol: 'REPv2_NO',
			trackedNetProfitEth: undefined,
			updatedAt: sampledAt(1),
		},
	],
	updatedAt: sampledAt(0),
	wallet,
} satisfies OperatorSnapshot

if (
	snapshot.positionRecordCount !== positions.length ||
	snapshot.risk.usage.openPositions !== 1 ||
	snapshot.risk.usage.lockedWeth !== openPosition.capitalAtRiskWeth ||
	snapshot.totalOpenHedgedNetProfitEth !== '0.0148' ||
	snapshot.totalRealizedNetProfitEth !== closedPosition.realizedNetProfitEth ||
	snapshot.totalTrackedNetProfitEth !== '0.0444'
) {
	throw new Error('OpenOracle documentation fixture position, risk, and profit totals are inconsistent')
}

function currentFixtureSnapshot(): OperatorSnapshot {
	const fixturePositions = fixtureAttention === 'recovery' ? snapshot.positions.map((position, index) => (index === 0 ? { ...position, status: 'recovery-required' as const } : position)) : snapshot.positions
	const fixtureTransactions = snapshot.transactionActivity.map((transaction, index) => {
		if (index !== 0) return transaction
		if (fixtureAttention === 'transaction') return { ...transaction, status: 'confirmation-unknown' as const }
		if (fixtureAttention === 'error') return { ...transaction, failedTargets: [{ error: rawRelayFailure, target: 'https://relay.example' }], status: 'submission-failed' as const }
		return transaction
	})
	return {
		...snapshot,
		networkConfigured: fixtureNetworkConfigured,
		endpointChecks: fixtureAttention === 'error' ? snapshot.endpointChecks.map((check, index) => (index === 0 ? { ...check, chainId: undefined, error: rawRpcFailure, status: 'failed' as const } : check)) : snapshot.endpointChecks,
		lastError: fixtureAttention === 'error' ? (fixturePollFailureMetadata ? rawRpcFailure : rawNonPollFailure) : undefined,
		lastPollFailureAt: fixtureAttention === 'error' && fixturePollFailureMetadata ? new Date(Date.now() - 2_000).toISOString() : undefined,
		lastRetryAt: fixtureAttention === 'error' && fixturePollFailureMetadata && fixtureRetryInProgress ? new Date(Date.now() - 1_000).toISOString() : undefined,
		nextRetryAt: fixtureAttention === 'error' && fixturePollFailureMetadata && !fixtureRetryInProgress ? (fixtureNextRetryAt ?? new Date(Date.now() + 10_000).toISOString()) : undefined,
		retryInProgress: fixtureRetryInProgress,
		operationLog: fixtureAttention === 'error' ? [{ category: 'transaction', details: rawRelayFailure, level: 'error', message: 'Transaction submission failed', reason: rawRpcFailure, reportId: '816', timestamp: sampledAt(0) }, ...snapshot.operationLog] : snapshot.operationLog,
		paused,
		positions: fixturePositions,
		status: paused ? 'paused' : fixtureStatus,
		transactionActivity: fixtureTransactions,
	}
}

const server = startDashboardServer(0, {
	getConfiguration: async () => {
		while (fixtureConfigurationHanging) await Bun.sleep(10)
		if (fixtureConfigurationUnavailable) throw new Error('fixture configuration endpoint unavailable')
		return {
			configuration: await Bun.file(join(import.meta.dir, '..', 'config', 'operator.example.json')).json(),
			revision: 'fixture-revision',
		}
	},
	getSnapshot: async () => {
		if (fixtureStateHanging) await new Promise<never>(() => {})
		if (fixtureStateUnavailable) throw new Error('fixture state endpoint unavailable')
		return currentFixtureSnapshot()
	},
	setPaused: async value => {
		fixturePauseRequests.push(value)
		while (fixturePauseHanging) await Bun.sleep(10)
		paused = value
	},
	updateConnectivity: async () => {
		while (fixtureConnectivityHanging) await Bun.sleep(10)
		if (fixtureConnectivityFailure) throw new Error(`RPC https://operator:${protectedFailureMarker}@rpc.example returned credential-bearing provider text`)
		return { connectivity: snapshot.connectivity, network: 'mainnet' as const, restartRequired: false, rpcQuorum: 2 as const }
	},
	updateConfiguration: value => value,
	updateSigner: () => ({ wallet }),
	updateStrategy: () => snapshot.settings,
	updateSubmission: () => snapshot.submission,
	updateTokens: () => snapshot.tokenAddresses,
})

try {
	if (process.argv.includes('--serve')) {
		await new Promise(() => {})
	}
	const outputDirectory = process.env['OPEN_ORACLE_SCREENSHOT_OUTPUT_DIR'] ?? join(import.meta.dir, '..', 'docs', 'assets')
	await mkdir(outputDirectory, { recursive: true })
	const chromium = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium'
	const port = server.port
	if (port === undefined) throw new Error('Dashboard screenshot server did not expose a listening port')
	const origin = `http://${server.hostname}:${port.toString()}`
	await captureScreenshots(chromium, origin, outputDirectory)
} finally {
	server.stop(true)
}
