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
const browser = Bun.spawn(['/usr/bin/chromium', '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333', `--user-data-dir=${resolve(qaDirectory, `chrome-profile-${Date.now().toString()}`)}`, 'about:blank'], { stderr: 'pipe', stdout: 'pipe' })

try {
	let tabs: unknown
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			tabs = await fetch('http://127.0.0.1:9333/json/list').then(response => response.json())
			break
		} catch (error) {
			void error
			await Bun.sleep(100)
		}
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

	const capture = async (name: string, width: number, height: number, scrollY = 0) => {
		await command('Emulation.setDeviceMetricsOverride', {
			deviceScaleFactor: 1,
			height,
			mobile: false,
			width,
		})
		await evaluate(`window.scrollTo(0, ${scrollY.toString()})`)
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

	await command('Page.navigate', { url: 'http://127.0.0.1:4183/' })
	await Bun.sleep(100)
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
	await evaluate(`document.querySelector('.address-details')?.setAttribute('open', '')`)
	const expandedAddressDesktop = await capture('liquidator-address-expanded-desktop', 1440, 900)
	await evaluate(`document.querySelector('.address-details')?.removeAttribute('open')`)
	await evaluate(`document.querySelector('#pause-button')?.click()`)
	await Bun.sleep(500)
	const pausedDesktop = await capture('liquidator-paused-desktop', 1440, 900)
	const pausedMobile = await capture('liquidator-paused-mobile', 390, 844)
	const evidence = {
		configurationLoading,
		desktop,
		expandedAddressDesktop,
		pausedDesktop,
		pausedMobile,
		interactions: await evaluate(`(async () => {
			const pause = document.querySelector('#pause-button')
			if (!(pause instanceof HTMLButtonElement)) throw new Error('Pause control missing')
			const pausedMode = document.querySelector('#mode-badge')?.textContent
			const pausedStatus = document.querySelector('#run-status-badge')?.textContent
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
				const universe = universeCheckbox.closest('td')?.querySelector('.action-status')?.textContent
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
		livePaused: undefined as unknown,
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
	evidence.livePaused = {
		desktop: await capture('liquidator-paused-live-desktop', 1440, 900),
		mobile: await capture('liquidator-paused-live-mobile', 390, 844),
		status: await evaluate(`({
			mode: document.querySelector('#mode-badge')?.textContent,
			runStatus: document.querySelector('#run-status-badge')?.textContent
		})`),
	}
	await evaluate(`window.fetch = window.__qaOriginalFetch`)
	await command('Page.navigate', { url: 'http://127.0.0.1:4183/' })
	await Bun.sleep(1_000)
	evidence.mobileOverview = await capture('liquidator-mobile-overview', 390, 844)
	const universesTop = await evaluate(`Math.max(0, (document.querySelector('#universes-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 16)`)
	evidence.mobileUniverses = await capture('liquidator-mobile-universes', 390, 844, typeof universesTop === 'number' ? universesTop : 0)
	const centralizedMarketsMobileTop = await evaluate(`Math.max(0, (document.querySelector('#centralized-markets-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)`)
	evidence.centralizedMarketsMobile = await capture('liquidator-centralized-markets-mobile', 390, 844, typeof centralizedMarketsMobileTop === 'number' ? centralizedMarketsMobileTop : 0)
	await command('Emulation.setDeviceMetricsOverride', {
		deviceScaleFactor: 1,
		height: 900,
		mobile: false,
		width: 1440,
	})
	const centralizedMarketsDesktopTop = await evaluate(`Math.max(0, (document.querySelector('#centralized-markets-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 110)`)
	evidence.centralizedMarketsDesktop = await capture('liquidator-centralized-markets-desktop', 1440, 900, typeof centralizedMarketsDesktopTop === 'number' ? centralizedMarketsDesktopTop : 0)
	await evaluate(`document.querySelector('.address-details')?.setAttribute('open', '')`)
	const expandedAddressTop = await evaluate(`Math.max(0, (document.querySelector('.address-details')?.getBoundingClientRect().top ?? 0) + window.scrollY - 160)`)
	const expandedAddressScroll = typeof expandedAddressTop === 'number' ? expandedAddressTop : 0
	const expandedAddressMobile = await capture('liquidator-address-expanded-mobile', 390, 844, expandedAddressScroll)
	await evaluate(`document.querySelector('.address-details')?.removeAttribute('open')`)
	const poolsTop = await evaluate(`Math.max(0, (document.querySelector('#pools-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 16)`)
	const strategyTop = await evaluate(`Math.max(0, (document.querySelector('#strategy-title')?.closest('section')?.getBoundingClientRect().top ?? 0) + window.scrollY - 16)`)
	evidence.mobilePools = await capture('liquidator-mobile-pools', 390, 844, typeof poolsTop === 'number' ? poolsTop : 0)
	evidence.mobileStrategy = await capture('liquidator-mobile-strategy', 390, 844, typeof strategyTop === 'number' ? strategyTop : 0)
	const migrationControlTop = await evaluate(`Math.max(0, (document.querySelector('input[name="allowAutomaticVaultMigrations"]')?.getBoundingClientRect().top ?? 0) + window.scrollY - 500)`)
	evidence.mobileMigrationControl = await capture('liquidator-mobile-migration-control', 390, 844, typeof migrationControlTop === 'number' ? migrationControlTop : 0)
	Object.assign(evidence, { expandedAddressMobile })
	const mobileOverflow = await evaluate(`[...document.querySelectorAll('*')]
		.map(element => ({ className: element.className, id: element.id, name: element.tagName, rect: element.getBoundingClientRect().toJSON(), scrollWidth: element.scrollWidth }))
		.filter(item => item.rect.right > document.documentElement.clientWidth + 1 || item.scrollWidth > item.rect.width + 1)
		.slice(0, 20)`)
	await Bun.write(resolve(qaDirectory, 'evidence.json'), `${JSON.stringify({ diagnostics, evidence, mobileOverflow }, undefined, 2)}\n`)
	socket.close()
} finally {
	browser.kill()
	await browser.exited
}
