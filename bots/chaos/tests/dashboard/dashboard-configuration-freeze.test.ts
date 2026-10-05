import { expect } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CONFIGURATION_COMMIT_INDETERMINATE } from '../../src/runtime/configuration-commit.ts'
import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS } from '../support/chromium.ts'
import { connectToChromium, state, walletAddress } from '../support/dashboard-harness.ts'

browserTest(
	'permanently freezes dashboard mutations after an indeterminate configuration commit',
	async () => {
		const indeterminate = new Error('sensitive post-rename owner-file failure')
		indeterminate.name = CONFIGURATION_COMMIT_INDETERMINATE
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({
				hasSigner: true,
				rememberSigner: true,
				revision: 'fixture-indeterminate',
				settings: {
					network: { chainId: 11_155_111, name: 'sepolia' },
					paused: true,
					runtime: { execute: false },
					scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
					strategy: { enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'] },
				},
				signerAddress: walletAddress,
			}),
			getDeploymentArchives: () => [
				{ id: 'current', active: true },
				{ id: '12'.repeat(32), active: false, revision: 'archive-revision', profileId: 'profile:v1:old', addresses: [] },
			],
			getState: () => state({ signerReady: true, wallet: walletAddress }),
			hostname: '127.0.0.1',
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSettings: () => {},
			setSigner: () => {
				throw indeterminate
			},
			setWorkflow: () => {},
		})
		let browserSession: Awaited<ReturnType<typeof connectToChromium>> | undefined
		try {
			const cdp = await connectToChromium()
			browserSession = cdp
			await cdp.command('Network.enable')
			const waitFor = async (expression: string, message: string) => await cdp.waitFor(expression, { attempts: 200, message })
			await cdp.command('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
			await waitFor("document.querySelector('#deployment-archive-list button')?.disabled === false", 'Archive controls did not become available')
			await cdp.evaluate('document.querySelector(\'.section-nav a[href="/settings"]\')?.click()')
			await waitFor("document.querySelector('#signer-summary .identifier-value') !== null && document.querySelector('#signer-fieldset')?.disabled === false", 'Signer controls did not load before the indeterminate mutation')
			await cdp.evaluate(`(() => {
				const input = document.querySelector('#private-key')
				const form = document.querySelector('#signer-form')
				if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
				input.value = ${JSON.stringify(`0x${'99'.repeat(32)}`)}
				form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
			})()`)
			await waitFor("document.querySelector('#signer-status')?.textContent?.includes('permanently frozen in this server process and page') === true", 'Indeterminate signer commit did not latch the dashboard')
			expect(
				await cdp.evaluate(`({
					configurationNotice: document.querySelector('#configuration-status')?.textContent,
					confirmationDisabled: document.querySelector('#confirm-resume')?.disabled,
					pauseDisabled: document.querySelector('#pause-button')?.disabled,
					settingsDisabled: document.querySelector('#settings-fields')?.disabled,
					signerDisabled: document.querySelector('#signer-fieldset')?.disabled,
					archiveDisabled: document.querySelector('#deployment-archive-list button')?.disabled,
					sensitiveVisible: document.documentElement.textContent?.includes('sensitive post-rename'),
				})`),
			).toMatchObject({
				configurationNotice: expect.stringContaining('inspect and reload the owner configuration and runtime-state files offline'),
				confirmationDisabled: true,
				pauseDisabled: true,
				settingsDisabled: true,
				signerDisabled: true,
				archiveDisabled: true,
				sensitiveVisible: false,
			})

			await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
			await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false", 'Refresh did not finish after the indeterminate mutation')
			expect(await cdp.evaluate("document.querySelector('#signer-fieldset')?.disabled === true && document.querySelector('#signer-status')?.textContent?.includes('permanently frozen') === true")).toBe(true)

			await cdp.command('Page.navigate', { url: 'about:blank' })
			await waitFor("document.readyState === 'complete'", 'Chromium did not reset before checking the server-process latch')
			await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
			await waitFor("document.querySelector('#configuration-status')?.textContent?.includes('permanently frozen in this server process and page') === true", 'A new page did not inherit the server-process mutation latch')
			expect(await cdp.evaluate("document.querySelector('#pause-button')?.disabled === true && document.querySelector('#settings-fields')?.disabled === true && document.querySelector('#signer-fieldset')?.disabled === true")).toBe(true)
		} finally {
			try {
				await browserSession?.close()
			} finally {
				dashboard.stop(true)
			}
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 30_000,
)
