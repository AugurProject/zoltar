import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CHROMIUM_STARTUP_BUDGET_MILLISECONDS, startChromiumSession } from './chromium-session.ts'

const chromium = process.env['CHROMIUM_PATH'] ?? Bun.which('chromium') ?? '/usr/bin/chromium'
const browserTest = existsSync(chromium) ? test : test.skip
const wallet = `0x${'ab'.repeat(20)}`
const repToken = `0x${'e1'.repeat(20)}`

browserTest(
	'execution mode lists every live prerequisite, gates the switch on them, and saves the mode explicitly at both widths',
	async () => {
		let execute = false
		let revision = 1
		let ready = false
		let rejectSave = false
		let releaseSave = () => {}
		let saveGate: Promise<void> | undefined
		const executionMutations: unknown[] = []
		const settingsMutations: unknown[] = []
		const checkedAt = () => new Date().toISOString()
		const dashboard = startDashboardServer(0, {
			hostname: '127.0.0.1',
			getConfiguration: () => ({
				hasSigner: ready,
				revision: String(revision),
				settings: {
					connectivity: ready ? { publicRpcUrls: ['https://submit.example/'], quorumRpcUrls: [], readRpcUrl: 'https://read.example/', rpcQuorum: 1 } : undefined,
					network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' },
					networkConfigured: ready,
					paused: true,
					runtime: { execute },
					scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
					strategy: {
						allowHighRiskOperations: false,
						allowIrreversibleOperations: false,
						enabledEcosystems: ['open-oracle'],
						initializeGenesisUniverse: false,
						maximumEthPerOperation: '0.05',
						maximumGasCostEth: '0.02',
						maximumRepPerOperation: '10',
						minimumEthReserve: ready ? '0.05' : '0',
						minimumRepReserve: '10',
						selectableOperationAllowlist: null,
						workflowValidForBlocks: 288,
					},
					submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
				},
				signerAddress: ready ? wallet : undefined,
			}),
			getState: () => ({
				activities: [],
				evaluations: [],
				execute,
				inventory: ready ? { eth: '1000000000000000000', rep: [{ balance: '100000000000000000000', symbol: 'REP', token: repToken, universeId: '0' }] } : { rep: [] },
				inventoryAvailable: ready,
				lastScanAt: ready ? checkedAt() : undefined,
				lastScannedBlock: ready ? '4242' : undefined,
				obligations: [],
				paused: true,
				pendingTransactions: [],
				rpcEndpointHealth: ready
					? [
							{ chainId: 11_155_111, checkedAt: checkedAt(), kind: 'read-rpc', status: 'healthy', target: 'https://read.example/' },
							{ lastSuccessAt: checkedAt(), status: 'healthy', target: 'https://read.example/' },
							{ chainId: 11_155_111, checkedAt: checkedAt(), kind: 'public-rpc', status: 'healthy', target: 'https://submit.example/' },
						]
					: [],
				scheduler: { status: 'paused' },
				topology: ready ? { anchor: { blockNumber: '4242', timestamp: '1000' }, auctions: [], complete: true, pairs: [], pools: [], reports: [], universes: [{ id: '0', knownChildOutcomes: [], repToken }] } : undefined,
				wallet: ready ? wallet : undefined,
				workflows: [],
			}),
			setCancellation: () => {},
			setCandidate: () => {},
			setExecution: async value => {
				executionMutations.push(value)
				await saveGate
				if (rejectSave) throw new Error('Execution change rejected')
				execute = Reflect.get(Object(value), 'execute') === true
				revision += 1
			},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSettings: value => {
				settingsMutations.push(value)
				revision += 1
			},
			setSigner: () => {},
			setWorkflow: () => {},
		})
		const session = await startChromiumSession(chromium)
		await session.send('Runtime.enable')
		await session.send('Page.enable')
		const cdp = {
			command: session.send,
			close: session.close,
			issues: session.issues,
			evaluate: async (expression: string) => {
				const response = await session.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
				return Reflect.get(Object(Reflect.get(Object(response), 'result')), 'value')
			},
		}
		const waitFor = async (expression: string) => {
			for (let attempt = 0; attempt < 200; attempt += 1) {
				if ((await cdp.evaluate(expression)) === true) return
				await Bun.sleep(25)
			}
			throw new Error(`Timed out: ${expression}`)
		}
		const readiness = "Array.from(document.querySelectorAll('#execution-checklist li'), item => `${item.dataset.ready}${item.dataset.advisory === 'true' ? '~' : ''}:${item.querySelector('.readiness-label')?.textContent}`)"
		const capture = async (name: string) => {
			const result = await cdp.command('Page.captureScreenshot', { format: 'png' })
			const data = Reflect.get(Object(result), 'data')
			if (typeof data !== 'string') throw new Error('Screenshot unavailable')
			await Bun.write(`/tmp/chaos-policy-qa/${name}.png`, Buffer.from(data, 'base64'))
		}
		try {
			for (const width of [1440, 390]) {
				execute = false
				ready = false
				revision += 1
				await cdp.command('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false })
				await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
				await waitFor("document.querySelector('#settings-fields')?.disabled === false && document.querySelector('#execution-fieldset')?.disabled === false")
				expect(await cdp.evaluate("Array.from(document.querySelectorAll('#settings-nav a'), chip => chip.textContent)")).toEqual(['1Connect', '2Execution policy', '3Go live'])
				expect(await cdp.evaluate("Array.from(document.querySelectorAll('#settings-go-live .settings-group > summary strong'), title => title.textContent)")).toEqual(['Transaction signer', 'Execution mode'])
				// Nothing but the pause holds yet, so every required prerequisite is listed as missing and the switch stays locked.
				expect(await cdp.evaluate(readiness)).toEqual(['true:Bot paused', 'false:Transaction signer', 'false:Chain and RPC endpoints', 'true:Independent quorum RPCs', 'false:Reserve policy', 'false:Canonical scan', 'false:Live inventory', 'false:Delivery', 'true~:Recovery work'])
				expect(await cdp.evaluate("document.querySelector('#execution-mode-summary')?.textContent")).toBe('Dry run · prerequisites missing')
				expect(await cdp.evaluate("document.querySelector('#execution-enabled')?.disabled")).toBe(true)
				await cdp.evaluate("document.querySelector('#execution-mode').scrollIntoView({ block: 'start' }); window.scrollBy(0, -document.querySelector('.operator-shell').getBoundingClientRect().height - 16)")
				await capture(`blocked-${width}`)
				// The policy form keeps its own draft badge, independent of the execution mode switch.
				await cdp.evaluate("document.querySelector('#allow-high-risk').click()")
				expect(await cdp.evaluate("document.querySelector('#settings-draft-status')?.hidden")).toBe(false)
				expect(await cdp.evaluate("document.querySelector('#settings-draft-status')?.textContent")).toBe('Unsaved changes')
				await cdp.evaluate("document.querySelector('#discard-settings').click()")
				expect(await cdp.evaluate("document.querySelector('#settings-draft-status')?.hidden")).toBe(true)
				expect(await cdp.evaluate("document.querySelector('#allow-high-risk')?.checked")).toBe(false)
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)

				ready = true
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#execution-mode-summary')?.textContent === 'Dry run · ready to go live'")
				expect(await cdp.evaluate(readiness)).toEqual(['true:Bot paused', 'true:Transaction signer', 'true:Chain and RPC endpoints', 'true:Independent quorum RPCs', 'true:Reserve policy', 'true:Canonical scan', 'true:Live inventory', 'true:Delivery', 'true~:Recovery work'])
				expect(await cdp.evaluate("document.querySelector('#execution-enabled')?.disabled")).toBe(false)
				expect(await cdp.evaluate("document.querySelector('#execution-form button[type=\"submit\"]').matches(':disabled')")).toBe(true)
				await capture(`ready-${width}`)
				const before = executionMutations.length
				await cdp.evaluate("document.querySelector('#execution-enabled').click()")
				expect(executionMutations).toHaveLength(before)
				expect(await cdp.evaluate("document.querySelector('#execution-form button[type=\"submit\"]').matches(':disabled')")).toBe(false)
				expect(await cdp.evaluate('Array.from(document.querySelectorAll(\'.settings-badges[data-form="execution-form"] .settings-badge\'), badge => badge.textContent)')).toEqual(['Unsaved changes'])
				// The periodic refresh reloads the configuration without discarding the unsaved flip.
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await Bun.sleep(300)
				expect(await cdp.evaluate("document.querySelector('#execution-enabled')?.checked")).toBe(true)
				expect(await cdp.evaluate('Array.from(document.querySelectorAll(\'.settings-badges[data-form="execution-form"] .settings-badge\'), badge => badge.textContent)')).toEqual(['Unsaved changes'])
				rejectSave = true
				await cdp.evaluate('document.querySelector(\'#execution-form button[type="submit"]\').click()')
				await waitFor("document.querySelector('#execution-status')?.textContent === 'Execution change rejected'")
				expect(executionMutations.at(-1)).toEqual({ execute: true, revision: String(revision) })
				expect(await cdp.evaluate("document.querySelector('#execution-enabled')?.checked")).toBe(false)
				expect(await cdp.evaluate("document.querySelector('#execution-mode-summary')?.textContent")).toBe('Dry run · ready to go live')
				await capture(`rejected-${width}`)
				rejectSave = false
				saveGate = new Promise(resolve => {
					releaseSave = resolve
				})
				await cdp.evaluate("document.querySelector('#execution-enabled').click()")
				await cdp.evaluate('document.querySelector(\'#execution-form button[type="submit"]\').click()')
				await waitFor("document.querySelector('#execution-status')?.textContent === 'Enabling live execution…'")
				expect(await cdp.evaluate("document.querySelector('#execution-fieldset')?.disabled")).toBe(true)
				// A refresh and a repeated submit while the save is in flight neither unlock the form nor send it twice.
				const inFlight = executionMutations.length
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await Bun.sleep(300)
				await cdp.evaluate("document.querySelector('#execution-form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))")
				await Bun.sleep(100)
				expect(executionMutations).toHaveLength(inFlight)
				expect(await cdp.evaluate("document.querySelector('#execution-fieldset')?.disabled")).toBe(true)
				expect(await cdp.evaluate("document.querySelector('#execution-form button[type=\"submit\"]').matches(':disabled')")).toBe(true)
				await capture(`saving-${width}`)
				releaseSave()
				saveGate = undefined
				await waitFor("document.querySelector('#execution-mode-summary')?.textContent === 'Live'")
				expect(await cdp.evaluate("document.querySelector('#execution-status')?.textContent")).toContain('Live execution enabled')
				expect(await cdp.evaluate("document.querySelector('#execution-enabled')?.checked")).toBe(true)
				expect(await cdp.evaluate('Array.from(document.querySelectorAll(\'.settings-badges[data-form="execution-form"] .settings-badge\'), badge => badge.textContent)')).toEqual([])
				await capture(`live-${width}`)
				// A live operator can always return to dry run, even after a prerequisite lapses.
				ready = false
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#execution-checklist li:nth-child(2)')?.dataset.ready === 'false'")
				expect(await cdp.evaluate("document.querySelector('#execution-enabled')?.disabled")).toBe(false)
				await cdp.evaluate("document.querySelector('#execution-enabled').click()")
				await cdp.evaluate('document.querySelector(\'#execution-form button[type="submit"]\').click()')
				await waitFor("document.querySelector('#execution-status')?.textContent === 'Dry-run mode saved.'")
				expect(executionMutations.at(-1)).toEqual({ execute: false, revision: String(revision - 1) })
				expect(settingsMutations).toHaveLength(0)
			}
			expect(cdp.issues).toEqual([])
		} finally {
			releaseSave()
			await cdp.close()
			await dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 60_000,
)
