import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

type CdpResponse = {
	error: { message: string | undefined } | undefined
	id: number | undefined
	method: string | undefined
	params: unknown
	result: unknown
}

const qaDirectory = resolve(import.meta.dir, '..', '.state', 'qa')
await mkdir(qaDirectory, { recursive: true })
const chromium = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium'
const browser = Bun.spawn([chromium, '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333', `--user-data-dir=${resolve(qaDirectory, `chrome-profile-${Date.now().toString()}`)}`, 'about:blank'], { stderr: 'pipe', stdout: 'pipe' })
const chainProfileCaptureComplete = Symbol('chain-profile-capture-complete')

try {
	let tabs: unknown
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			const candidate: unknown = await fetch('http://127.0.0.1:9333/json/list').then(response => response.json())
			if (Array.isArray(candidate) && candidate.length > 0) {
				tabs = candidate
				break
			}
		} catch (error) {
			void error
		}
		await Bun.sleep(100)
	}
	if (!Array.isArray(tabs) || tabs.length === 0) throw new Error('Chromium debugging tab did not become available')
	const firstTab = tabs[0]
	if (typeof firstTab !== 'object' || firstTab === null || Array.isArray(firstTab)) throw new Error('Chromium returned an invalid tab')
	const webSocketDebuggerUrl = Reflect.get(firstTab, 'webSocketDebuggerUrl')
	if (typeof webSocketDebuggerUrl !== 'string') throw new Error('Chromium tab is missing its debugger URL')
	const socket = new WebSocket(webSocketDebuggerUrl)
	const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
	const diagnostics: CdpResponse[] = []
	let requestId = 0
	socket.addEventListener('message', event => {
		const parsed: unknown = JSON.parse(String(event.data))
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
		const error = Reflect.get(parsed, 'error')
		const errorMessage = typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined
		const id = Reflect.get(parsed, 'id')
		const method = Reflect.get(parsed, 'method')
		const message: CdpResponse = {
			error: typeof error === 'object' && error !== null ? { message: typeof errorMessage === 'string' ? errorMessage : undefined } : undefined,
			id: typeof id === 'number' ? id : undefined,
			method: typeof method === 'string' ? method : undefined,
			params: Reflect.get(parsed, 'params'),
			result: Reflect.get(parsed, 'result'),
		}
		if (message.id !== undefined) {
			const handler = pending.get(message.id)
			if (handler === undefined) return
			pending.delete(message.id)
			if (message.error !== undefined) handler.reject(new Error(message.error.message ?? 'CDP command failed'))
			else handler.resolve(message.result)
			return
		}
		if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') diagnostics.push(message)
	})
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener('open', () => resolve(), { once: true })
		socket.addEventListener('error', () => reject(new Error('Chromium debugger connection failed')), { once: true })
	})
	const command = (method: string, params: Record<string, unknown> = {}) =>
		new Promise<unknown>((resolve, reject) => {
			requestId += 1
			pending.set(requestId, { reject, resolve })
			socket.send(JSON.stringify({ id: requestId, method, params }))
		})
	await command('Runtime.enable')
	await command('Log.enable')
	await command('Page.enable')
	await command('Page.addScriptToEvaluateOnNewDocument', {
		source: `(() => {
			const originalFetch = window.fetch
			window.__qaPauseRequestCount = 0
			window.__qaStateRequestCount = 0
			window.fetch = (input, init) => {
				const path = typeof input === 'string' ? new URL(input, window.location.href).pathname : input instanceof Request ? new URL(input.url).pathname : String(input)
				if (path === '/api/state' && init?.method === undefined) window.__qaStateRequestCount += 1
				if (new URL(window.location.href).searchParams.get('qaState') === 'unavailable' && path === '/api/state' && init?.method === undefined) {
					return Promise.resolve(new Response(JSON.stringify({ error: 'fixture state endpoint unavailable' }), { headers: { 'content-type': 'application/json' }, status: 503 }))
				}
				if (new URL(window.location.href).searchParams.get('qaPause') === 'pending' && path === '/api/paused' && init?.method === 'PUT') {
					window.__qaPauseRequestCount += 1
					return new Promise(resolve => {
						window.__qaReleasePause = () => resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))
					})
				}
				return originalFetch(input, init)
			}
		})()`,
	})

	const evaluate = async (expression: string) => {
		const response = await command('Runtime.evaluate', {
			awaitPromise: true,
			expression,
			returnByValue: true,
		})
		if (typeof response !== 'object' || response === null || Array.isArray(response)) throw new Error('Runtime evaluation returned an invalid response')
		const result = Reflect.get(response, 'result')
		if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new Error('Runtime evaluation is missing its result')
		return Reflect.get(result, 'value')
	}
	const navigateToDashboard = async (url: string) => {
		let observedTitle: unknown
		for (let attempt = 0; attempt < 3; attempt += 1) {
			await command('Page.navigate', { url })
			for (let poll = 0; poll < 50; poll += 1) {
				observedTitle = await evaluate(`document.querySelector('h1')?.textContent`)
				if (observedTitle === 'Statoblast liquidator') return
				await Bun.sleep(100)
			}
		}
		throw new Error(`Liquidator dashboard fixture did not load at ${url}: ${String(observedTitle)}`)
	}

	const capture = async (name: string, width: number, height: number, scrollY = 0, fragment = 'overview') => {
		await command('Emulation.setDeviceMetricsOverride', {
			deviceScaleFactor: 1,
			height,
			mobile: false,
			width,
		})
		await evaluate(`(() => {
			const primaryFragment = ${JSON.stringify(fragment === 'recovery' ? 'operations' : fragment)}
			history.replaceState(null, '', '/' + primaryFragment + ${JSON.stringify(fragment === 'recovery' ? '#recovery' : '')})
			const links = [...document.querySelectorAll('.section-nav a')]
			document.body.dataset.page = primaryFragment
			const activeLink = links.find(link => link instanceof HTMLAnchorElement && new URL(link.href).pathname === '/' + primaryFragment)
			for (const link of links) {
				if (link === activeLink) link.setAttribute('aria-current', 'page')
				else link.removeAttribute('aria-current')
			}
			const navigation = activeLink?.closest('.section-nav')
			if (navigation instanceof HTMLElement && activeLink instanceof HTMLElement) {
				const activeRect = activeLink.getBoundingClientRect()
				const navigationRect = navigation.getBoundingClientRect()
				navigation.scrollLeft += activeRect.left - navigationRect.left - (navigationRect.width - activeRect.width) / 2
			}
			window.scrollTo(0, ${scrollY.toString()})
		})()`)
		await Bun.sleep(200)
		const response = await command('Page.captureScreenshot', {
			captureBeyondViewport: false,
			format: 'png',
			fromSurface: true,
		})
		if (typeof response !== 'object' || response === null || Array.isArray(response)) throw new Error('Screenshot response is invalid')
		const data = Reflect.get(response, 'data')
		if (typeof data !== 'string') throw new Error('Screenshot response is missing PNG data')
		await Bun.write(resolve(qaDirectory, `${name}.png`), Buffer.from(data, 'base64'))
		return await evaluate(`({
			bodyScrollWidth: document.body.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
			innerHeight: window.innerHeight,
			innerWidth: window.innerWidth,
			scrollHeight: document.documentElement.scrollHeight,
			scrollY: window.scrollY
		})`)
	}
	const readSafetyActionPositions = () =>
		evaluate(`(() => Object.fromEntries(['refresh-button', 'pause-button'].map(id => {
			const element = document.getElementById(id)
			if (!(element instanceof HTMLElement)) return [id, undefined]
			const rect = element.getBoundingClientRect()
			return [id, { height: rect.height, visible: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight, width: rect.width }]
		})))()`)
	const assertStableSafetyActions = (expected: unknown, actual: unknown, label: string) => {
		void expected
		if (typeof actual !== 'object' || actual === null) throw new Error(`${label} hid mobile safety actions: ${JSON.stringify(actual)}`)
		for (const id of ['refresh-button', 'pause-button']) {
			const value = Reflect.get(actual, id)
			if (typeof value !== 'object' || value === null) throw new Error(`${label} made ${id} inaccessible: ${JSON.stringify(value)}`)
			const height = Reflect.get(value, 'height')
			const width = Reflect.get(value, 'width')
			if (Reflect.get(value, 'visible') !== true || typeof height !== 'number' || height < 44 || typeof width !== 'number' || width < 44) {
				throw new Error(`${label} made ${id} inaccessible: ${JSON.stringify(value)}`)
			}
		}
	}

	await navigateToDashboard('http://127.0.0.1:4183/')
	const configurationLoading = await evaluate(`({
		checkboxDisabled: document.querySelector('#pool-rows input[type="checkbox"]')?.disabled,
		strategyDisabled: document.querySelector('#strategy-fields')?.disabled,
		status: document.querySelector('#configuration-status')?.textContent
	})`)
	await Bun.sleep(500)
	const configurationFailure = await evaluate(`document.querySelector('#configuration-status')?.textContent`)
	await evaluate(`document.querySelector('#configuration-status button')?.click()`)
	await Bun.sleep(900)
	diagnostics.length = 0
	const desktop = await capture('liquidator-desktop', 1440, 900)
	await evaluate(`document.querySelector('#attention-badge')?.click()`)
	await Bun.sleep(100)
	const unconfiguredNetworkState = await evaluate(`({
			activeSection: document.querySelector('.section-nav a[aria-current="page"]')?.getAttribute('href'),
			attentionHref: document.querySelector('#attention-badge')?.getAttribute('href'),
			attentionText: document.querySelector('#attention-badge')?.textContent,
			detailOpen: document.querySelector('#network-connectivity')?.hasAttribute('open'),
			hash: window.location.hash,
			networkBadge: document.querySelector('#network-badge')?.textContent
		})`)
	const unconfiguredNetworkMobile = await capture('liquidator-network-unconfigured-mobile', 390, 844)
	await evaluate(`(() => {
		const network = document.querySelector('#network-name')
		if (!(network instanceof HTMLSelectElement)) throw new Error('Network profile control missing')
		network.value = 'mainnet'
		network.dispatchEvent(new Event('change', { bubbles: true }))
	})()`)
	await Bun.sleep(1_300)
	await evaluate(`(() => {
		const form = document.querySelector('#network-form')
		const readRpc = document.querySelector('#read-rpc-url')
		const publicRpcs = document.querySelector('#public-rpc-urls')
		const quorumRpcs = document.querySelector('#quorum-rpc-urls')
		if (!(form instanceof HTMLFormElement) || !(readRpc instanceof HTMLInputElement) || !(publicRpcs instanceof HTMLTextAreaElement) || !(quorumRpcs instanceof HTMLTextAreaElement)) throw new Error('Network configuration controls missing')
		readRpc.value = 'https://read.example'
		publicRpcs.value = 'https://rpc.example'
		quorumRpcs.value = 'https://quorum.example'
		form.requestSubmit()
	})()`)
	await Bun.sleep(700)
	const configuredNetwork = await evaluate(`({
		attention: document.querySelector('#attention-badge')?.textContent,
		badge: document.querySelector('#network-badge')?.textContent,
		status: document.querySelector('#network-status')?.textContent
	})`)
	if (
		typeof unconfiguredNetworkState !== 'object' ||
		unconfiguredNetworkState === null ||
		!('attentionText' in unconfiguredNetworkState) ||
		unconfiguredNetworkState.attentionText !== '2 actions' ||
		!('hash' in unconfiguredNetworkState) ||
		unconfiguredNetworkState.hash !== '#network-connectivity' ||
		!('detailOpen' in unconfiguredNetworkState) ||
		unconfiguredNetworkState.detailOpen !== true ||
		typeof configuredNetwork !== 'object' ||
		configuredNetwork === null ||
		!('badge' in configuredNetwork) ||
		configuredNetwork.badge !== 'Mainnet · chain 1' ||
		!('attention' in configuredNetwork) ||
		configuredNetwork.attention !== '2 actions'
	) {
		throw new Error(`Network safety badge did not update from unconfigured to mainnet: ${JSON.stringify({ configuredNetwork, unconfiguredNetworkState })}`)
	}
	const configuredNetworkDesktop = await capture('liquidator-network-mainnet-desktop', 1440, 900)
	const configuredNetworkMobile = await capture('liquidator-network-mainnet-mobile', 390, 844)
	const mobileSafetyActionPositions = await readSafetyActionPositions()
	const networkStates = {
		configured: configuredNetwork,
		configuredDesktop: configuredNetworkDesktop,
		configuredMobile: configuredNetworkMobile,
		unconfigured: unconfiguredNetworkState,
		unconfiguredDesktop: desktop,
		unconfiguredMobile: unconfiguredNetworkMobile,
	}
	if (process.env['LIQUIDATOR_CAPTURE_CHAIN_PROFILES'] === '1') {
		await evaluate(`(() => {
			const network = document.querySelector('#network-name')
			if (!(network instanceof HTMLSelectElement)) throw new Error('Network profile control missing')
			network.value = 'sepolia'
			network.dispatchEvent(new Event('change', { bubbles: true }))
		})()`)
		await Bun.sleep(100)
		const sepoliaSwitching = {
			desktop: await capture('liquidator-network-sepolia-switching-desktop', 1440, 900, 0, 'settings'),
			mobile: await capture('liquidator-network-sepolia-switching-mobile', 390, 844, 0, 'settings'),
		}
		await Bun.sleep(1_300)
		const sepoliaUnconfigured = {
			desktop: await capture('liquidator-network-sepolia-unconfigured-desktop', 1440, 900, 0, 'settings'),
			mobile: await capture('liquidator-network-sepolia-unconfigured-mobile', 390, 844, 0, 'settings'),
			state: await evaluate(`({
				badge: document.querySelector('#network-badge')?.textContent,
				scope: document.querySelector('#settings-chain-scope')?.textContent,
				status: document.querySelector('#network-status')?.textContent
			})`),
		}
		await evaluate(`(() => {
			const form = document.querySelector('#network-form')
			const readRpc = document.querySelector('#read-rpc-url')
			const publicRpcs = document.querySelector('#public-rpc-urls')
			const quorumRpcs = document.querySelector('#quorum-rpc-urls')
			if (!(form instanceof HTMLFormElement) || !(readRpc instanceof HTMLInputElement) || !(publicRpcs instanceof HTMLTextAreaElement) || !(quorumRpcs instanceof HTMLTextAreaElement)) throw new Error('Sepolia RPC controls missing')
			readRpc.value = 'https://sepolia-read.example'
			publicRpcs.value = 'https://sepolia-rpc.example'
			quorumRpcs.value = 'https://sepolia-quorum.example'
			form.requestSubmit()
		})()`)
		await Bun.sleep(700)
		const sepoliaConfigured = {
			desktop: await capture('liquidator-network-sepolia-desktop', 1440, 900, 0, 'settings'),
			mobile: await capture('liquidator-network-sepolia-mobile', 390, 844, 0, 'settings'),
			state: await evaluate(`({
				badge: document.querySelector('#network-badge')?.textContent,
				scope: document.querySelector('#settings-chain-scope')?.textContent,
				status: document.querySelector('#network-status')?.textContent
			})`),
		}
		await Bun.write(resolve(qaDirectory, 'chain-profile-evidence.json'), `${JSON.stringify({ diagnostics, networkStates, sepoliaConfigured, sepoliaSwitching, sepoliaUnconfigured }, undefined, 2)}\n`)
		throw chainProfileCaptureComplete
	}
	const pausePending: Record<string, unknown> = {}
	for (const mobile of [false, true]) {
		const width = mobile ? 390 : 1440
		const height = mobile ? 844 : 900
		await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width })
		await navigateToDashboard(`http://127.0.0.1:4183/?qaPause=pending&pending=${mobile ? 'mobile' : 'desktop'}`)
		await Bun.sleep(1_000)
		await evaluate(`document.querySelector('#pause-button')?.click()`)
		await Bun.sleep(150)
		await evaluate(`document.querySelector('#refresh-button')?.click()`)
		await Bun.sleep(250)
		await evaluate(`document.querySelector('#pause-button')?.click()`)
		const state = await evaluate(`(() => {
			const pause = document.querySelector('#pause-button')
			const refresh = document.querySelector('#refresh-button')
			if (!(pause instanceof HTMLButtonElement) || !(refresh instanceof HTMLButtonElement)) return undefined
			return {
				bodyScrollWidth: document.body.scrollWidth,
				pauseBusy: pause.getAttribute('aria-busy'),
				pauseDisabled: pause.disabled,
				pauseLabel: pause.textContent,
				pauseRequests: window.__qaPauseRequestCount,
				refreshBusy: refresh.hasAttribute('aria-busy'),
				refreshDisabled: refresh.disabled,
				refreshLabel: refresh.textContent,
				runStatus: document.querySelector('#run-status-badge')?.textContent,
				scrollX: window.scrollX,
				stateRequests: window.__qaStateRequestCount
			}
		})()`)
		if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(), 'Pending Pause')
		if (
			typeof state !== 'object' ||
			state === null ||
			!('bodyScrollWidth' in state) ||
			typeof state.bodyScrollWidth !== 'number' ||
			state.bodyScrollWidth > width ||
			!('pauseBusy' in state) ||
			state.pauseBusy !== 'true' ||
			!('pauseDisabled' in state) ||
			state.pauseDisabled !== true ||
			!('pauseLabel' in state) ||
			state.pauseLabel !== 'Pausing…' ||
			!('pauseRequests' in state) ||
			state.pauseRequests !== 1 ||
			!('refreshBusy' in state) ||
			state.refreshBusy !== false ||
			!('refreshDisabled' in state) ||
			state.refreshDisabled !== false ||
			!('refreshLabel' in state) ||
			state.refreshLabel !== 'Refresh' ||
			!('runStatus' in state) ||
			state.runStatus !== 'Running' ||
			!('scrollX' in state) ||
			state.scrollX !== 0 ||
			!('stateRequests' in state) ||
			typeof state.stateRequests !== 'number' ||
			state.stateRequests < 2
		) {
			throw new Error(`Liquidator pending Pause state is not single-flight: ${JSON.stringify(state)}`)
		}
		pausePending[mobile ? 'mobile' : 'desktop'] = {
			screenshot: await capture(`liquidator-pause-pending-${mobile ? 'mobile' : 'desktop'}`, width, height),
			state,
		}
		await evaluate(`window.__qaReleasePause?.()`)
		await Bun.sleep(300)
	}
	const readConnectionState = () =>
		evaluate(`(() => {
			const safetyVisible = ['mode-badge', 'network-badge', 'run-status-badge', 'attention-badge', 'refresh-button', 'pause-button'].every(id => {
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
				network: document.querySelector('#network-badge')?.textContent,
				noticeCopy: document.querySelector('#global-error')?.textContent,
				pauseDisabled: document.querySelector('#pause-button')?.disabled,
				refreshDisabled: document.querySelector('#refresh-button')?.disabled,
				refreshText: document.querySelector('#refresh-button')?.textContent,
				runStatus: document.querySelector('#run-status-badge')?.textContent,
				safetyVisible,
				settingsDisabled: ['network-fields', 'market-configuration-fields', 'strategy-fields', 'clear-signer'].every(id => {
					const target = document.getElementById(id)
					return target instanceof HTMLFieldSetElement || target instanceof HTMLButtonElement ? target.disabled : false
				}),
				dynamicControlsDisabled: [...document.querySelectorAll('#pool-rows input, #universe-rows input, #recovery-list input, #recovery-list button')].every(control => control instanceof HTMLInputElement || control instanceof HTMLButtonElement ? control.disabled : false),
				scrollX: window.scrollX
			}
		})()`)
	const connectionFailures: Record<string, unknown> = {}
	for (const mobile of [false, true]) {
		const width = mobile ? 390 : 1440
		const height = mobile ? 844 : 900
		await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width })
		await navigateToDashboard(`http://127.0.0.1:4183/?qaState=unavailable&connection=initial-${mobile ? 'mobile' : 'desktop'}`)
		await Bun.sleep(1_000)
		const initialFailure = await readConnectionState()
		if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(), 'Initial connection failure')
		const stateRequestsBeforeManualRefresh = await evaluate(`window.__qaStateRequestCount`)
		await evaluate(`document.querySelector('#refresh-button')?.click()`)
		await Bun.sleep(250)
		const stateRequestsAfterManualRefresh = await evaluate(`window.__qaStateRequestCount`)
		if (
			typeof initialFailure !== 'object' ||
			initialFailure === null ||
			!('attentionText' in initialFailure) ||
			initialFailure.attentionText !== '1 action' ||
			!('mode' in initialFailure) ||
			initialFailure.mode !== 'Mode unavailable' ||
			!('network' in initialFailure) ||
			initialFailure.network !== 'Mainnet · chain 1 · unverified' ||
			!('pauseDisabled' in initialFailure) ||
			initialFailure.pauseDisabled !== true ||
			!('refreshDisabled' in initialFailure) ||
			initialFailure.refreshDisabled !== false ||
			!('refreshText' in initialFailure) ||
			initialFailure.refreshText !== 'Refresh' ||
			!('runStatus' in initialFailure) ||
			initialFailure.runStatus !== 'Disconnected' ||
			!('settingsDisabled' in initialFailure) ||
			initialFailure.settingsDisabled !== true ||
			!('dynamicControlsDisabled' in initialFailure) ||
			initialFailure.dynamicControlsDisabled !== true ||
			!('safetyVisible' in initialFailure) ||
			initialFailure.safetyVisible !== true ||
			!('bodyScrollWidth' in initialFailure) ||
			typeof initialFailure.bodyScrollWidth !== 'number' ||
			initialFailure.bodyScrollWidth > width ||
			!('scrollX' in initialFailure) ||
			initialFailure.scrollX !== 0 ||
			typeof stateRequestsBeforeManualRefresh !== 'number' ||
			typeof stateRequestsAfterManualRefresh !== 'number' ||
			stateRequestsAfterManualRefresh !== stateRequestsBeforeManualRefresh + 1
		) {
			throw new Error(`Initial Liquidator state-request failure is unsafe: ${JSON.stringify(initialFailure)}`)
		}
		connectionFailures[`initial-${mobile ? 'mobile' : 'desktop'}`] = { screenshot: await capture(`liquidator-connection-initial-failure-${mobile ? 'mobile' : 'desktop'}`, width, height), state: initialFailure }
		await navigateToDashboard(`http://127.0.0.1:4183/?connection=post-success-${mobile ? 'mobile' : 'desktop'}`)
		await Bun.sleep(1_000)
		await evaluate(`history.replaceState(null, '', '?qaState=unavailable')`)
		await Bun.sleep(3_200)
		const postSuccessFailure = await readConnectionState()
		if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(), 'Post-success connection failure')
		if (
			typeof postSuccessFailure !== 'object' ||
			postSuccessFailure === null ||
			!('attentionHref' in postSuccessFailure) ||
			postSuccessFailure.attentionHref !== '/overview#global-error' ||
			!('attentionText' in postSuccessFailure) ||
			postSuccessFailure.attentionText !== '3 actions' ||
			!('mode' in postSuccessFailure) ||
			postSuccessFailure.mode !== 'Dry run · last known' ||
			!('network' in postSuccessFailure) ||
			postSuccessFailure.network !== 'Mainnet · chain 1 · last known' ||
			!('noticeCopy' in postSuccessFailure) ||
			typeof postSuccessFailure.noticeCopy !== 'string' ||
			!postSuccessFailure.noticeCopy.includes('Automatic retry is active') ||
			postSuccessFailure.noticeCopy.includes('fixture state endpoint unavailable') ||
			!('pauseDisabled' in postSuccessFailure) ||
			postSuccessFailure.pauseDisabled !== false ||
			!('refreshDisabled' in postSuccessFailure) ||
			postSuccessFailure.refreshDisabled !== false ||
			!('refreshText' in postSuccessFailure) ||
			postSuccessFailure.refreshText !== 'Refresh' ||
			!('runStatus' in postSuccessFailure) ||
			postSuccessFailure.runStatus !== 'Disconnected' ||
			!('settingsDisabled' in postSuccessFailure) ||
			postSuccessFailure.settingsDisabled !== true ||
			!('dynamicControlsDisabled' in postSuccessFailure) ||
			postSuccessFailure.dynamicControlsDisabled !== true ||
			!('safetyVisible' in postSuccessFailure) ||
			postSuccessFailure.safetyVisible !== true ||
			!('bodyScrollWidth' in postSuccessFailure) ||
			typeof postSuccessFailure.bodyScrollWidth !== 'number' ||
			postSuccessFailure.bodyScrollWidth > width ||
			!('scrollX' in postSuccessFailure) ||
			postSuccessFailure.scrollX !== 0
		) {
			throw new Error(`Post-success Liquidator state-request failure is unsafe: ${JSON.stringify(postSuccessFailure)}`)
		}
		connectionFailures[`post-success-${mobile ? 'mobile' : 'desktop'}`] = { screenshot: await capture(`liquidator-connection-post-success-failure-${mobile ? 'mobile' : 'desktop'}`, width, height), state: postSuccessFailure }
		await evaluate(`document.querySelector('#pause-button')?.click()`)
		await Bun.sleep(250)
		await evaluate(`history.replaceState(null, '', '/')`)
		await Bun.sleep(3_200)
		const recovery = await readConnectionState()
		if (
			typeof recovery !== 'object' ||
			recovery === null ||
			!('attentionText' in recovery) ||
			recovery.attentionText !== '2 actions' ||
			!('mode' in recovery) ||
			recovery.mode !== 'Dry run' ||
			!('network' in recovery) ||
			recovery.network !== 'Mainnet · chain 1' ||
			!('pauseDisabled' in recovery) ||
			recovery.pauseDisabled !== false ||
			!('runStatus' in recovery) ||
			recovery.runStatus !== 'Paused'
		) {
			throw new Error(`Liquidator emergency Pause was not applied while state polling was unavailable: ${JSON.stringify(recovery)}`)
		}
		await evaluate(`document.querySelector('#pause-button')?.click()`)
		await Bun.sleep(500)
		const resumed = await readConnectionState()
		if (typeof resumed !== 'object' || resumed === null || !('runStatus' in resumed) || resumed.runStatus !== 'Running') throw new Error(`Liquidator did not resume after emergency Pause QA: ${JSON.stringify(resumed)}`)
	}
	await evaluate(`(() => {
		window.__qaErrorOriginalFetch = window.fetch
		window.fetch = async (input, init) => {
			const path = typeof input === 'string' ? input : input instanceof Request ? new URL(input.url).pathname : String(input)
			const response = await window.__qaErrorOriginalFetch(input, init)
			if (path !== '/api/state' || init?.method !== undefined) return response
			const state = await response.json()
			return new Response(JSON.stringify({ ...state, alerts: [], error: 'Read RPC stalled at block 8842011', pendingStagedOperations: [], pendingTransactions: [] }), {
				headers: { 'content-type': 'application/json' },
				status: response.status
			})
		}
	})()`)
	await Bun.sleep(3_200)
	const errorOnlyState = await evaluate(`({
		action: document.querySelector('#attention-badge[href="/overview#global-error"]')?.textContent,
		attention: document.querySelector('#attention-badge')?.textContent,
		detail: document.querySelector('#global-error')?.textContent,
		noticeCount: [...document.querySelectorAll('main > .notice.error:not(.hidden)')].length,
		operatorAlertsHidden: document.querySelector('#operator-alerts')?.classList.contains('hidden'),
		runStatus: document.querySelector('#run-status-badge')?.textContent
	})`)
	if (
		typeof errorOnlyState !== 'object' ||
		errorOnlyState === null ||
		!('action' in errorOnlyState) ||
		!('attention' in errorOnlyState) ||
		!('detail' in errorOnlyState) ||
		!('noticeCount' in errorOnlyState) ||
		!('operatorAlertsHidden' in errorOnlyState) ||
		!('runStatus' in errorOnlyState) ||
		errorOnlyState.action !== '1 action' ||
		errorOnlyState.attention !== '1 action' ||
		typeof errorOnlyState.detail !== 'string' ||
		!errorOnlyState.detail.includes('RPC connectivity or chain reads failed.') ||
		!errorOnlyState.detail.includes('Automatic retry is active.') ||
		errorOnlyState.detail.includes('Read RPC stalled at block 8842011') ||
		errorOnlyState.noticeCount !== 1 ||
		errorOnlyState.operatorAlertsHidden !== true ||
		errorOnlyState.runStatus !== 'Error'
	) {
		throw new Error(`Scan-only error did not create one actionable operator blocker: ${JSON.stringify(errorOnlyState)}`)
	}
	const errorOnlyDesktop = await capture('liquidator-error-only-desktop', 1440, 900)
	const errorOnlyMobile = await capture('liquidator-error-only-mobile', 390, 844)
	await evaluate(`window.fetch = window.__qaErrorOriginalFetch`)
	await Bun.sleep(3_200)
	await evaluate(`document.querySelector('.address-details')?.setAttribute('open', '')`)
	const expandedAddressDesktop = await capture('liquidator-address-expanded-desktop', 1440, 900)
	await evaluate(`document.querySelector('.address-details')?.removeAttribute('open')`)
	await evaluate(`document.querySelector('#operator-alerts a[href="/operations#recovery"]')?.click()`)
	await Bun.sleep(100)
	const runningGuidance = await evaluate(`({
		hidden: document.querySelector('#recovery-guidance')?.hidden,
		text: document.querySelector('#recovery-guidance')?.textContent
	})`)
	if (typeof runningGuidance !== 'object' || runningGuidance === null || !('hidden' in runningGuidance) || runningGuidance.hidden !== false || !('text' in runningGuidance) || typeof runningGuidance.text !== 'string' || !runningGuidance.text.includes('Pause the bot')) {
		throw new Error(`Running recovery guidance is unavailable: ${JSON.stringify(runningGuidance)}`)
	}
	const runningRecoveryDesktopOffset = await evaluate(`Math.max(0, (document.querySelector('#recovery-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)`)
	if (typeof runningRecoveryDesktopOffset !== 'number') throw new Error('Running desktop recovery section offset is unavailable')
	const runningRecoveryDesktop = await capture('liquidator-recovery-running-desktop', 1440, 900, runningRecoveryDesktopOffset, 'recovery')
	await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 844, mobile: false, width: 390 })
	await evaluate(`document.querySelector('#operator-alerts a[href="/operations#recovery"]')?.click()`)
	await Bun.sleep(100)
	const runningRecoveryMobileOffset = await evaluate(`Math.max(0, (document.querySelector('#recovery-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)`)
	if (typeof runningRecoveryMobileOffset !== 'number') throw new Error('Running mobile recovery section offset is unavailable')
	const runningRecoveryMobile = await capture('liquidator-recovery-running-mobile', 390, 844, runningRecoveryMobileOffset, 'recovery')
	const signerSummaryMobileOffset = await evaluate(`Math.max(0, (document.querySelector('#wallet-address')?.closest('details')?.getBoundingClientRect().top ?? 0) + window.scrollY - 500)`)
	if (typeof signerSummaryMobileOffset !== 'number') throw new Error('Mobile signer summary offset is unavailable')
	const signerSummaryMobile = await capture('liquidator-signer-summary-mobile', 390, 844, signerSummaryMobileOffset, 'settings')
	const signerSummaryState = await evaluate(`(() => {
		const copy = document.querySelector('#wallet-address')
		const container = copy?.parentElement
		const summary = copy?.closest('summary')
		if (!(copy instanceof HTMLElement) || !(container instanceof HTMLElement) || !(summary instanceof HTMLElement)) return undefined
		return {
			fits: container.scrollWidth <= container.clientWidth + 1 && container.getBoundingClientRect().right <= summary.getBoundingClientRect().right,
			text: copy.textContent
		}
	})()`)
	if (typeof signerSummaryState !== 'object' || signerSummaryState === null || !('fits' in signerSummaryState) || signerSummaryState.fits !== true || !('text' in signerSummaryState) || typeof signerSummaryState.text !== 'string' || !signerSummaryState.text.startsWith('0x')) {
		throw new Error(`Mobile signer summary overflowed its disclosure control: ${JSON.stringify(signerSummaryState)}`)
	}
	await evaluate(`document.querySelector('#pause-button')?.click()`)
	await Bun.sleep(500)
	const pausedGuidanceHidden = await evaluate(`document.querySelector('#recovery-guidance')?.hidden`)
	if (pausedGuidanceHidden !== true) throw new Error('Paused recovery guidance still instructs the operator to pause')
	const pausedDesktop = await capture('liquidator-paused-desktop', 1440, 900)
	await evaluate(`document.querySelector('#operator-alerts a[href="/operations#recovery"]')?.click()`)
	await Bun.sleep(100)
	const recoveryDesktopOffset = await evaluate(`Math.max(0, (document.querySelector('#recovery-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)`)
	if (typeof recoveryDesktopOffset !== 'number') throw new Error('Desktop recovery section offset is unavailable')
	const recoveryDesktop = await capture('liquidator-recovery-desktop', 1440, 900, recoveryDesktopOffset, 'recovery')
	const pausedMobile = await capture('liquidator-paused-mobile', 390, 844)
	await evaluate(`document.querySelector('#operator-alerts a[href="/operations#recovery"]')?.click()`)
	await Bun.sleep(100)
	const recoveryMobileOffset = await evaluate(`Math.max(0, (document.querySelector('#recovery-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)`)
	if (typeof recoveryMobileOffset !== 'number') throw new Error('Mobile recovery section offset is unavailable')
	const recoveryMobile = await capture('liquidator-recovery-mobile', 390, 844, recoveryMobileOffset, 'recovery')
	const evidence = {
		connectionFailures,
		configurationLoading,
		desktop,
		errorOnly: { desktop: errorOnlyDesktop, mobile: errorOnlyMobile, state: errorOnlyState },
		expandedAddressDesktop,
		networkStates,
		pausePending,
		pausedDesktop,
		pausedMobile,
		recoveryDesktop,
		recoveryMobile,
		runningRecoveryDesktop,
		runningRecoveryMobile,
		signerSummaryMobile,
		interactions: await evaluate(`(async () => {
			const pause = document.querySelector('#pause-button')
			if (!(pause instanceof HTMLButtonElement)) throw new Error('Pause control missing')
			const pausedMode = document.querySelector('#mode-badge')?.textContent
			const pausedStatus = document.querySelector('#run-status-badge')?.textContent
			const sourceTest = document.querySelector('#test-market-sources')
			if (!(sourceTest instanceof HTMLButtonElement)) throw new Error('Market source test control missing')
			sourceTest.click()
			await new Promise(resolve => setTimeout(resolve, 500))
			const sourceTestStatus = document.querySelector('#market-source-test-status')?.textContent
			const replacement = document.querySelector('.reconciliation-form input')
			const reconciliationForm = document.querySelector('.reconciliation-form')
			if (!(replacement instanceof HTMLInputElement) || !(reconciliationForm instanceof HTMLFormElement)) throw new Error('Transaction reconciliation controls missing')
			replacement.value = \`0x\${'2'.repeat(64)}\`
			const originalRecoveryConfirm = window.confirm
			window.confirm = () => true
			reconciliationForm.requestSubmit()
			await new Promise(resolve => setTimeout(resolve, 500))
			const reconciliationStatus = reconciliationForm.querySelector('.action-status')?.textContent
			window.confirm = originalRecoveryConfirm
			pause.click()
			await new Promise(resolve => setTimeout(resolve, 500))
			const checkboxes = [...document.querySelectorAll('#pool-rows input[type="checkbox"]')]
			const second = checkboxes[1]
			if (!(second instanceof HTMLInputElement)) throw new Error('Second pool control missing')
			second.click()
			await new Promise(resolve => setTimeout(resolve, 500))
			const universeCheckboxes = [...document.querySelectorAll('#universe-rows input[type="checkbox"]')]
			const unapprovedUniverse = universeCheckboxes.at(-1)
			if (!(unapprovedUniverse instanceof HTMLInputElement)) throw new Error('Universe approval control missing')
			unapprovedUniverse.click()
			await new Promise(resolve => setTimeout(resolve, 500))
			const filter = document.querySelector('#pool-filter')
			if (!(filter instanceof HTMLInputElement)) throw new Error('Pool filter missing')
			filter.value = '900719925474099312345'
			filter.dispatchEvent(new Event('input', { bubbles: true }))
			const filteredRows = document.querySelectorAll('#pool-rows tr').length
			filter.value = ''
			filter.dispatchEvent(new Event('input', { bubbles: true }))
			const minimumReward = document.querySelector('input[name="minimumRewardValueEth"]')
			const strategyForm = document.querySelector('#strategy-form')
			if (!(minimumReward instanceof HTMLInputElement) || !(strategyForm instanceof HTMLFormElement)) throw new Error('Strategy controls missing')
			minimumReward.value = '0.03'
			strategyForm.requestSubmit()
			await new Promise(resolve => setTimeout(resolve, 500))
			const strategyStatus = document.querySelector('#strategy-status')?.textContent
			const poolCreation = document.querySelector('input[name="allowAutomaticPoolCreation"]')
			if (!(poolCreation instanceof HTMLInputElement)) throw new Error('Pool creation control missing')
			poolCreation.checked = true
			strategyForm.requestSubmit()
			await new Promise(resolve => setTimeout(resolve, 500))
			const poolCreationEnabled = poolCreation.checked && document.querySelector('#strategy-status')?.textContent === 'Saved'
			poolCreation.checked = false
			strategyForm.requestSubmit()
			await new Promise(resolve => setTimeout(resolve, 500))
			const poolCreationDisabled = !poolCreation.checked && document.querySelector('#strategy-status')?.textContent === 'Saved'
			const privateKey = document.querySelector('input[name="privateKey"]')
			const updateSigner = document.querySelector('#update-signer')
			const signerForm = document.querySelector('#signer-form')
			if (!(privateKey instanceof HTMLInputElement) || !(updateSigner instanceof HTMLButtonElement) || !(signerForm instanceof HTMLFormElement)) throw new Error('Signer controls missing')
			const blankSignerDisabled = updateSigner.disabled
			privateKey.value = \`0x\${'1'.repeat(64)}\`
			privateKey.dispatchEvent(new Event('input', { bubbles: true }))
			signerForm.requestSubmit()
			await new Promise(resolve => setTimeout(resolve, 500))
			const signerActivated = document.querySelector('#signer-status')?.textContent
			const originalConfirm = window.confirm
			window.confirm = () => false
			document.querySelector('#clear-signer')?.click()
			await new Promise(resolve => setTimeout(resolve, 100))
			const signerClearCancelled = document.querySelector('#signer-status')?.textContent
			window.confirm = () => true
			document.querySelector('#clear-signer')?.click()
			await new Promise(resolve => setTimeout(resolve, 500))
			const signerCleared = document.querySelector('#signer-status')?.textContent
			window.confirm = originalConfirm
			return {
				blankSignerDisabled,
				filteredRows,
				pausedMode,
				pausedStatus,
				secondSelected: second.checked,
				universeApproved: unapprovedUniverse.checked,
				signerActivated,
				signerClearCancelled,
				signerCleared,
				poolCreationDisabled,
				poolCreationEnabled,
				reconciliationStatus,
				sourceTestStatus,
				strategyStatus
			}
		})()`),
		mutationFailures: await evaluate(`(async () => {
			const originalFetch = window.fetch
			let failedPath = ''
			window.fetch = (input, init) => {
				const path = typeof input === 'string' ? input : input instanceof Request ? new URL(input.url).pathname : String(input)
				if (path === failedPath && init?.method === 'PUT') {
					return Promise.resolve(new Response(JSON.stringify({ error: \`Fixture rejected \${path}\` }), {
						headers: { 'content-type': 'application/json' },
						status: 400
					}))
				}
				return originalFetch(input, init)
			}
			try {
				failedPath = '/api/selected-pools'
				const checkbox = document.querySelector('#pool-rows input[type="checkbox"]')
				if (!(checkbox instanceof HTMLInputElement)) throw new Error('Pool checkbox missing')
				checkbox.click()
				await new Promise(resolve => setTimeout(resolve, 100))
				const pool = checkbox.closest('td')?.querySelector('.action-status')?.textContent
				failedPath = '/api/approved-universes'
				const universeCheckbox = document.querySelector('#universe-rows input[type="checkbox"]')
				if (!(universeCheckbox instanceof HTMLInputElement)) throw new Error('Universe checkbox missing')
				universeCheckbox.click()
				await new Promise(resolve => setTimeout(resolve, 100))
				const universe = universeCheckbox.closest('.truth-family')?.querySelector('.action-status')?.textContent
				failedPath = '/api/strategy'
				document.querySelector('#strategy-form')?.requestSubmit()
				await new Promise(resolve => setTimeout(resolve, 100))
				const strategy = document.querySelector('#strategy-status')?.textContent
				failedPath = '/api/signer'
				const privateKey = document.querySelector('input[name="privateKey"]')
				if (!(privateKey instanceof HTMLInputElement)) throw new Error('Signer key missing')
				privateKey.value = \`0x\${'2'.repeat(64)}\`
				privateKey.dispatchEvent(new Event('input', { bubbles: true }))
				document.querySelector('#signer-form')?.requestSubmit()
				await new Promise(resolve => setTimeout(resolve, 100))
				const signer = document.querySelector('#signer-status')?.textContent
				failedPath = '/api/paused'
				document.querySelector('#pause-button')?.click()
				await new Promise(resolve => setTimeout(resolve, 100))
				const pause = document.querySelector('#pause-status')?.textContent
				return { pause, pool, signer, strategy, universe }
			} finally {
				window.fetch = originalFetch
			}
		})()`),
		configurationFailure,
		centralizedMarketsDesktop: undefined as unknown,
		centralizedMarketsMobile: undefined as unknown,
		livePaused: {} as Record<string, unknown>,
		mobileOverview: undefined as unknown,
		mobileMigrationControl: undefined as unknown,
		mobilePools: undefined as unknown,
		mobileStrategy: undefined as unknown,
		mobileUniverses: undefined as unknown,
	}
	await evaluate(`(() => {
		window.__qaOriginalFetch = window.fetch
		window.fetch = async (input, init) => {
			const path = typeof input === 'string' ? input : input instanceof Request ? new URL(input.url).pathname : String(input)
			const response = await window.__qaOriginalFetch(input, init)
			if (path !== '/api/state' || init?.method !== undefined) return response
			const state = await response.json()
			return new Response(JSON.stringify({ ...state, execute: true, paused: true, status: 'paused' }), {
				headers: { 'content-type': 'application/json' },
				status: response.status
			})
		}
	})()`)
	await Bun.sleep(3_200)
	await evaluate(`document.querySelector('#pause-status')?.replaceChildren()`)
	evidence.livePaused = {
		desktop: await capture('liquidator-paused-live-desktop', 1440, 900),
		mobile: await capture('liquidator-paused-live-mobile', 390, 844),
		status: await evaluate(`({
			mode: document.querySelector('#mode-badge')?.textContent,
			runStatus: document.querySelector('#run-status-badge')?.textContent
		})`),
	}
	const resumePreflight: Record<string, unknown> = {}
	for (const mobile of [false, true]) {
		const width = mobile ? 390 : 1440
		const height = mobile ? 844 : 900
		await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width })
		await evaluate(`document.querySelector('#pause-button')?.click()`)
		await Bun.sleep(200)
		const state = await evaluate(`(() => {
			const dialog = document.querySelector('#resume-dialog')
			const title = document.querySelector('#resume-title')
			const consequence = document.querySelector('#resume-dialog .dialog-body > .muted')
			const firstCheck = document.querySelector('#resume-preflight li')
			const actions = document.querySelector('#resume-dialog .dialog-actions')
			const dialogRect = dialog?.getBoundingClientRect()
			return {
				actionsReachable: dialog instanceof HTMLElement && actions instanceof HTMLElement && actions.offsetTop + actions.offsetHeight <= dialog.scrollHeight,
				bodyScrollWidth: document.body.scrollWidth,
				dialogBounded: dialogRect !== undefined && dialogRect.top >= 0 && dialogRect.bottom <= window.innerHeight && dialogRect.left >= 0 && dialogRect.right <= window.innerWidth,
				focusedTitle: document.activeElement === title,
				introVisible: [title, consequence, firstCheck].every(element => {
					const rect = element?.getBoundingClientRect()
					return rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight
				}),
				open: dialog?.hasAttribute('open'),
				scrollTop: dialog instanceof HTMLElement ? dialog.scrollTop : undefined,
				text: document.querySelector('#resume-preflight')?.textContent
			}
		})()`)
		if (
			typeof state !== 'object' ||
			state === null ||
			!('open' in state) ||
			state.open !== true ||
			!('focusedTitle' in state) ||
			state.focusedTitle !== true ||
			!('scrollTop' in state) ||
			state.scrollTop !== 0 ||
			!('dialogBounded' in state) ||
			state.dialogBounded !== true ||
			!('introVisible' in state) ||
			state.introVisible !== true ||
			!('actionsReachable' in state) ||
			state.actionsReachable !== true ||
			!('bodyScrollWidth' in state) ||
			typeof state.bodyScrollWidth !== 'number' ||
			state.bodyScrollWidth > width
		) {
			throw new Error(`Liquidator resume dialog lost its safety context at ${width.toString()}px: ${JSON.stringify(state)}`)
		}
		resumePreflight[mobile ? 'mobile' : 'desktop'] = {
			screenshot: await capture(`liquidator-resume-preflight-${mobile ? 'mobile' : 'desktop'}`, width, height),
			state,
		}
		await evaluate(`document.querySelector('#cancel-resume')?.click()`)
	}
	Object.assign(evidence.livePaused, { resumePreflight })
	await evaluate(`window.fetch = window.__qaOriginalFetch`)
	await navigateToDashboard('http://127.0.0.1:4183/')
	await Bun.sleep(1_000)
	await evaluate(`document.querySelector('#test-market-sources')?.click()`)
	await Bun.sleep(500)
	const sourceProbeRows = await evaluate(`[...document.querySelectorAll('#market-source-rows tr')].map(row => row.textContent)`)
	Object.assign(evidence, { sourceProbeRows })
	evidence.mobileOverview = await capture('liquidator-mobile-overview', 390, 844)
	const universesTop = await evaluate(`(() => {
		const target = document.querySelector('#universes-title')?.closest('details')
		target?.setAttribute('open', '')
		return Math.max(0, (target?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)
	})()`)
	evidence.mobileUniverses = await capture('liquidator-mobile-universes', 390, 844, typeof universesTop === 'number' ? universesTop : 0, 'settings')
	const deepScrollSafety = await evaluate(`(() => {
		const ids = ['mode-badge', 'network-badge', 'run-status-badge', 'attention-badge', 'refresh-button', 'pause-button']
		return Object.fromEntries(ids.map(id => {
			const target = document.getElementById(id)
			if (!(target instanceof HTMLElement)) return [id, { visible: false }]
			const rect = target.getBoundingClientRect()
			return [id, {
				bottom: rect.bottom,
				left: rect.left,
				right: rect.right,
				top: rect.top,
				visible: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
			}]
		}))
	})()`)
	if (typeof deepScrollSafety !== 'object' || deepScrollSafety === null || Object.values(deepScrollSafety).some(value => typeof value !== 'object' || value === null || !('visible' in value) || value.visible !== true)) {
		throw new Error(`Deep-scroll safety controls are not fully visible: ${JSON.stringify(deepScrollSafety)}`)
	}
	Object.assign(evidence, { deepScrollSafety })
	const rootUniverseTarget = await evaluate(`(() => {
		const target = document.querySelector('.truth-root-toggle')
		if (!(target instanceof HTMLElement)) return undefined
		const rect = target.getBoundingClientRect()
		return { height: rect.height, width: rect.width }
	})()`)
	if (typeof rootUniverseTarget !== 'object' || rootUniverseTarget === null || !('height' in rootUniverseTarget) || !('width' in rootUniverseTarget) || typeof rootUniverseTarget.height !== 'number' || typeof rootUniverseTarget.width !== 'number' || rootUniverseTarget.height < 44 || rootUniverseTarget.width < 44) {
		throw new Error(`Root universe approval target is smaller than 44px: ${JSON.stringify(rootUniverseTarget)}`)
	}
	Object.assign(evidence, { rootUniverseTarget })
	const centralizedMarketsMobileTop = await evaluate(`Math.max(0, (document.querySelector('#centralized-markets-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)`)
	evidence.centralizedMarketsMobile = await capture('liquidator-centralized-markets-mobile', 390, 844, typeof centralizedMarketsMobileTop === 'number' ? centralizedMarketsMobileTop : 0, 'markets')
	await command('Emulation.setDeviceMetricsOverride', {
		deviceScaleFactor: 1,
		height: 900,
		mobile: false,
		width: 1440,
	})
	const centralizedMarketsDesktopTop = await evaluate(`Math.max(0, (document.querySelector('#centralized-markets-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)`)
	const sourceProbeDesktop = await capture('liquidator-source-probe-desktop', 1440, 900, typeof centralizedMarketsDesktopTop === 'number' ? centralizedMarketsDesktopTop : 0, 'markets')
	Object.assign(evidence, { sourceProbeDesktop })
	await evaluate(`document.querySelector('#show-active-admission')?.click()`)
	await Bun.sleep(200)
	evidence.centralizedMarketsDesktop = await capture('liquidator-centralized-markets-desktop', 1440, 900, typeof centralizedMarketsDesktopTop === 'number' ? centralizedMarketsDesktopTop : 0, 'markets')
	await evaluate(`document.querySelector('.address-details')?.setAttribute('open', '')`)
	const expandedAddressTop = await evaluate(`Math.max(0, (document.querySelector('.address-details')?.getBoundingClientRect().top ?? 0) + window.scrollY - 160)`)
	const expandedAddressScroll = typeof expandedAddressTop === 'number' ? expandedAddressTop : 0
	const expandedAddressMobile = await capture('liquidator-address-expanded-mobile', 390, 844, expandedAddressScroll, 'pools')
	await evaluate(`document.querySelector('.address-details')?.removeAttribute('open')`)
	const poolsTop = await evaluate(`Math.max(0, (document.querySelector('#pools-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 16)`)
	const strategyTop = await evaluate(`(() => {
		const target = document.querySelector('#strategy-title')?.closest('details')
		target?.setAttribute('open', '')
		return Math.max(0, (target?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)
	})()`)
	evidence.mobilePools = await capture('liquidator-mobile-pools', 390, 844, typeof poolsTop === 'number' ? poolsTop : 0, 'pools')
	evidence.mobileStrategy = await capture('liquidator-mobile-strategy', 390, 844, typeof strategyTop === 'number' ? strategyTop : 0, 'settings')
	const migrationControlTop = await evaluate(`Math.max(0, (document.querySelector('input[name="allowAutomaticVaultMigrations"]')?.getBoundingClientRect().top ?? 0) + window.scrollY - 500)`)
	evidence.mobileMigrationControl = await capture('liquidator-mobile-migration-control', 390, 844, typeof migrationControlTop === 'number' ? migrationControlTop : 0, 'settings')
	Object.assign(evidence, { expandedAddressMobile })
	const mobileOverflow = await evaluate(`[...document.querySelectorAll('*')]
		.filter(element => element.closest('thead') === null && !element.classList.contains('visually-hidden'))
		.map(element => ({ className: element.className, id: element.id, name: element.tagName, rect: element.getBoundingClientRect().toJSON(), scrollWidth: element.scrollWidth }))
		.filter(item => item.rect.right > document.documentElement.clientWidth + 1 || item.scrollWidth > item.rect.width + 1)
		.slice(0, 20)`)
	const directFragments: Record<string, unknown> = {}
	for (const fragment of ['overview', 'pools', 'markets', 'operations', 'settings']) {
		for (const mobile of [false, true]) {
			const width = mobile ? 390 : 1440
			const height = mobile ? 844 : 900
			await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width })
			await navigateToDashboard(`http://127.0.0.1:4183/${fragment}?qa=${fragment}-${mobile ? 'mobile' : 'desktop'}`)
			await Bun.sleep(1_000)
			const directEvidence = await evaluate(`(() => {
				const active = document.querySelector('.section-nav a[aria-current="page"]')
				const header = document.querySelector('.operator-shell')
				const navigation = document.querySelector('.section-nav')
				const target = document.getElementById(${JSON.stringify(fragment)})
				if (!(active instanceof HTMLAnchorElement) || !(header instanceof HTMLElement) || !(navigation instanceof HTMLElement) || !(target instanceof HTMLElement)) return undefined
				const context = target.querySelector('h2') ?? target
				const activeRect = active.getBoundingClientRect()
				const navigationRect = navigation.getBoundingClientRect()
				return {
					activeLeft: activeRect.left,
					activeRight: activeRect.right,
					activeHref: active.getAttribute('href'),
					activeVisible: activeRect.left >= navigationRect.left - 1 && activeRect.right <= navigationRect.right + 1,
					bodyScrollWidth: document.body.scrollWidth,
					headerBottom: header.getBoundingClientRect().bottom,
					navigationClientWidth: navigation.clientWidth,
					navigationLeft: navigationRect.left,
					navigationRight: navigationRect.right,
					navigationScrollLeft: navigation.scrollLeft,
					navigationScrollWidth: navigation.scrollWidth,
					settingsSummaryCopyFits: [...target.querySelectorAll('.settings-summary-copy small')].every(copy => {
						const container = copy.parentElement
						const summary = copy.closest('summary')
						if (!(container instanceof HTMLElement) || !(summary instanceof HTMLElement)) return false
						return container.scrollWidth <= container.clientWidth + 1 && container.getBoundingClientRect().right <= summary.getBoundingClientRect().right
					}),
					targetTop: context.getBoundingClientRect().top
				}
			})()`)
			if (
				typeof directEvidence !== 'object' ||
				directEvidence === null ||
				!('activeHref' in directEvidence) ||
				directEvidence.activeHref !== `/${fragment}` ||
				!('activeVisible' in directEvidence) ||
				directEvidence.activeVisible !== true ||
				!('headerBottom' in directEvidence) ||
				!('targetTop' in directEvidence) ||
				typeof directEvidence.headerBottom !== 'number' ||
				typeof directEvidence.targetTop !== 'number' ||
				directEvidence.targetTop < directEvidence.headerBottom ||
				(mobile && 'bodyScrollWidth' in directEvidence && typeof directEvidence.bodyScrollWidth === 'number' && directEvidence.bodyScrollWidth > width) ||
				(mobile && fragment === 'settings' && (!('settingsSummaryCopyFits' in directEvidence) || directEvidence.settingsSummaryCopyFits !== true))
			) {
				throw new Error(`Direct #${fragment} navigation failed at ${width.toString()}px: ${JSON.stringify(directEvidence)}`)
			}
			const response = await command('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png', fromSurface: true })
			if (typeof response !== 'object' || response === null || Array.isArray(response)) throw new Error(`Direct #${fragment} screenshot response is invalid`)
			const data = Reflect.get(response, 'data')
			if (typeof data !== 'string') throw new Error(`Direct #${fragment} screenshot is missing PNG data`)
			const key = `${fragment}-${mobile ? 'mobile' : 'desktop'}`
			directFragments[key] = directEvidence
			await Bun.write(resolve(qaDirectory, `liquidator-direct-${key}.png`), Buffer.from(data, 'base64'))
		}
	}
	Object.assign(evidence, { directFragments })
	await navigateToDashboard('http://127.0.0.1:4183/#settings')
	await Bun.sleep(1_000)
	await evaluate(`(() => {
		const network = document.querySelector('#network-name')
		if (!(network instanceof HTMLSelectElement)) throw new Error('Network profile control missing')
		network.value = 'sepolia'
		network.dispatchEvent(new Event('change', { bubbles: true }))
	})()`)
	await Bun.sleep(1_300)
	const sepoliaUnconfigured = {
		desktop: await capture('liquidator-network-sepolia-unconfigured-desktop', 1440, 900, 0, 'settings'),
		mobile: await capture('liquidator-network-sepolia-unconfigured-mobile', 390, 844, 0, 'settings'),
		state: await evaluate(`({
			badge: document.querySelector('#network-badge')?.textContent,
			scope: document.querySelector('#settings-chain-scope')?.textContent,
			status: document.querySelector('#network-status')?.textContent
		})`),
	}
	await evaluate(`(() => {
		const form = document.querySelector('#network-form')
		const readRpc = document.querySelector('#read-rpc-url')
		const publicRpcs = document.querySelector('#public-rpc-urls')
		const quorumRpcs = document.querySelector('#quorum-rpc-urls')
		if (!(form instanceof HTMLFormElement) || !(readRpc instanceof HTMLInputElement) || !(publicRpcs instanceof HTMLTextAreaElement) || !(quorumRpcs instanceof HTMLTextAreaElement)) throw new Error('Sepolia RPC controls missing')
		readRpc.value = 'https://sepolia-read.example'
		publicRpcs.value = 'https://sepolia-rpc.example'
		quorumRpcs.value = 'https://sepolia-quorum.example'
		form.requestSubmit()
	})()`)
	await Bun.sleep(700)
	const sepoliaConfigured = {
		desktop: await capture('liquidator-network-sepolia-desktop', 1440, 900, 0, 'settings'),
		mobile: await capture('liquidator-network-sepolia-mobile', 390, 844, 0, 'settings'),
		state: await evaluate(`({
			badge: document.querySelector('#network-badge')?.textContent,
			scope: document.querySelector('#settings-chain-scope')?.textContent,
			status: document.querySelector('#network-status')?.textContent
		})`),
	}
	Object.assign(evidence, { sepoliaConfigured, sepoliaUnconfigured })
	await Bun.write(resolve(qaDirectory, 'evidence.json'), `${JSON.stringify({ diagnostics, evidence, mobileOverflow }, undefined, 2)}\n`)
	socket.close()
} catch (error) {
	if (error !== chainProfileCaptureComplete) throw error
} finally {
	browser.kill()
	await browser.exited
}
