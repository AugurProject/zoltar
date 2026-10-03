import { expect } from 'bun:test'
import { walletAddress } from './dashboard-harness.ts'
import { pausedWorkflowRenderingState, rpcSecret } from './dashboard-workflow-fixtures.ts'
import type { WorkflowRecoveryContext, WorkflowViewport } from './workflow-recovery-harness.ts'

// Staged per-viewport checks of the workflow-recovery dashboard test: RPC connectivity, signer reconciliation, and execution policy validation.

/** Settings copy, RPC draft preservation and revision conflicts, connectivity saves, and unresolved signer reconciliation. */
export async function verifySettingsConnectivityAndSigner(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { cdp, dashboard, dashboardPort, expectVisibleIdentifiers, fixture, waitFor, waitForConnectivityMutation } = context
	await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
	await waitFor("document.querySelector('#signer-summary .identifier-value') !== null", `${viewport.label} signer identifier did not render`)
	await expectVisibleIdentifiers([{ type: 'transaction signer address', value: walletAddress }], viewport.width === 390 ? 44 : 32)
	expect(
		await cdp.evaluate(`({
			catalogLink: {
				href: document.querySelector('#selectable-operation-catalog-link')?.getAttribute('href'),
				text: document.querySelector('#selectable-operation-catalog-link')?.textContent,
			},
			executeDescription: document.querySelector('#execution-enabled')?.getAttribute('aria-describedby'),
			executeHelp: document.querySelector('#execution-form .section-note')?.textContent,
			connectivityDisabled: document.querySelector('#connectivity-fields')?.disabled,
			connectivityHelp: document.querySelector('#connectivity-fields .notice')?.textContent,
			initializerHelp: document.querySelector('label[for="initialize-genesis-universe"] + p')?.textContent,
			initializerHelpId: document.querySelector('#initialize-genesis-universe')?.getAttribute('aria-describedby'),
			initializeGenesisUniverse: document.querySelector('#initialize-genesis-universe')?.checked,
			selectableScopeHelp: document.querySelector('#all-selectable-operations-help')?.textContent,
			readRpcUrl: document.querySelector('#read-rpc-url')?.value,
			lede: document.querySelector('#settings-chain-scope')?.textContent,
			locked: document.querySelector('#settings-fields')?.disabled,
			pauseNote: document.querySelector('#settings-pause-note')?.textContent,
			pauseNoteVisible: document.querySelector('#settings-pause-note')?.classList.contains('hidden') === false,
		})`),
	).toEqual({
		catalogLink: { href: '/catalog', text: 'Operation catalog' },
		connectivityDisabled: false,
		connectivityHelp: "RPC checks run from the chaos-bot server. Docker service URLs such as http://reth:8545 work only when that process shares the service's container network. Saved endpoint URLs remain visible here so the active configuration can be reviewed and edited.",
		initializerHelp:
			'Continuously completes the exact genesis topology: binary question, origin security pool, wallet vault, external REP/WETH Uniswap pool creation, initialization, and seeding, Statoblast trading roots, canonical trading pair, and initial pair liquidity. Only these initializer operations bypass the selectable allowlist.',
		initializerHelpId: 'initialize-genesis-universe-help',
		initializeGenesisUniverse: true,
		readRpcUrl: `https://operator:${rpcSecret}@read-one.example/private`,
		selectableScopeHelp:
			'Turn this off for a staged rollout, then enable operations in the Operation catalog. An empty allowlist runs lifecycle obligations only unless genesis initialization is enabled; only its ordered initializer operations are exempt. Lifecycle discovery, recovery, and execution are never disabled by this control.',
		executeDescription: 'execution-checklist',
		executeHelp: 'Off is dry-run mode. Live mode can spend gas and protocol assets.',
		lede: 'Changes apply before the next selection cycle.',
		locked: true,
		pauseNote: 'Execution policy and execution mode are locked while the bot is running. Pause the bot to review and change risk, caps, reserves, timing, ecosystem scope, or the live switch.',
		pauseNoteVisible: true,
	})
	await cdp.evaluate(`(() => {
		const quorum = document.querySelector('#rpc-quorum')
		if (!(quorum instanceof HTMLSelectElement)) return false
		quorum.value = '1'
		quorum.dispatchEvent(new InputEvent('input', { bubbles: true }))
		return true
	})()`)
	await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
	await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false && document.querySelector('#rpc-quorum')?.value === '1'", `${viewport.label} RPC quorum draft was not preserved across a same-revision refresh`)
	await cdp.evaluate("document.querySelector('#discard-connectivity')?.click()")
	await waitFor("document.querySelector('#rpc-quorum')?.value === '2'", `${viewport.label} discarded RPC quorum draft did not restore the current configuration`)
	await cdp.evaluate(`(() => {
		const form = document.querySelector('#connectivity-form')
		const read = document.querySelector('#read-rpc-url')
		if (!(form instanceof HTMLFormElement) || !(read instanceof HTMLInputElement)) return false
		read.value = 'http://stale-draft.example'
		read.dispatchEvent(new InputEvent('input', { bubbles: true }))
		return true
	})()`)
	// A revision bump that leaves the saved endpoint set untouched (a pause, another panel's save) carries the draft over.
	fixture.configurationRevision = `${viewport.nextConfigurationRevision}-unrelated`
	await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
	await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false", `${viewport.label} dashboard did not refresh after an unrelated configuration change`)
	await Bun.sleep(100)
	expect(await cdp.evaluate("({ read: document.querySelector('#read-rpc-url')?.value, saveDisabled: document.querySelector('#save-connectivity')?.matches(':disabled'), blocked: document.querySelector('#connectivity-status')?.textContent?.startsWith('Configuration changed elsewhere') })")).toEqual({
		read: 'http://stale-draft.example',
		saveDisabled: false,
		blocked: false,
	})
	// A change to the saved endpoint set itself still blocks the stale draft.
	fixture.additionalPublicRpcUrls = [`https://submit-${viewport.label}.example/`]
	fixture.configurationRevision = viewport.nextConfigurationRevision
	await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
	await waitFor(
		"document.querySelector('#connectivity-status')?.textContent === 'Configuration changed elsewhere. Discard this RPC draft and re-enter the complete replacement set before saving.' && document.querySelector('#save-connectivity')?.matches(':disabled') === true",
		`${viewport.label} stale RPC draft was not blocked after a newer configuration loaded`,
	)
	const staleConnectivityMutationCount = fixture.connectivityMutations.length
	await cdp.evaluate("document.querySelector('#connectivity-form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))")
	await Bun.sleep(50)
	expect(fixture.connectivityMutations.length).toBe(staleConnectivityMutationCount)
	await cdp.evaluate("document.querySelector('#discard-connectivity')?.click()")
	await waitFor(`document.querySelector('#read-rpc-url')?.value === 'https://operator:${rpcSecret}@read-one.example/private' && document.querySelector('#save-connectivity')?.matches(':disabled') === false`, `${viewport.label} stale RPC draft could not restore the saved endpoint`)
	const connectivityMutationCount = fixture.connectivityMutations.length + 1
	await cdp.evaluate(`(() => {
		const read = document.querySelector('#read-rpc-url')
		const publicRpcs = document.querySelector('#public-rpc-urls')
		const quorumRpcs = document.querySelector('#quorum-rpc-urls')
		const form = document.querySelector('#connectivity-form')
		if (!(read instanceof HTMLInputElement) || !(publicRpcs instanceof HTMLTextAreaElement) || !(quorumRpcs instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return false
		read.value = 'http://reth:8545'
		publicRpcs.value = 'http://reth:8545'
		quorumRpcs.value = 'http://anvil:8545'
		read.dispatchEvent(new InputEvent('input', { bubbles: true }))
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
		return true
	})()`)
	await waitForConnectivityMutation(connectivityMutationCount, `${viewport.label} RPC connectivity form did not submit through the dashboard server`)
	expect(fixture.connectivityMutations.at(-1)).toEqual({
		connectivity: { publicRpcUrls: ['http://reth:8545'], quorumRpcUrls: ['http://anvil:8545'], readRpcUrl: 'http://reth:8545', rpcQuorum: 2 },
		revision: viewport.nextConfigurationRevision,
	})
	await waitFor("document.querySelector('#connectivity-status')?.textContent === 'Chain and RPCs passed server-side validation and were saved.' && document.querySelector('#save-connectivity')?.matches(':disabled') === false", `${viewport.label} RPC connectivity form did not report success and return to a usable state`)
	expect(
		await cdp.evaluate(`(() => {
			const input = document.querySelector('#workflow-valid-blocks')
			const unit = input?.nextElementSibling
			const bounds = unit?.getBoundingClientRect()
			return { disabled: input?.matches(':disabled'), unit: unit?.textContent?.trim(), unitVisible: (bounds?.width ?? 0) > 0 && (bounds?.height ?? 0) > 0 }
		})()`),
	).toEqual({ disabled: true, unit: 'blocks', unitVisible: true })
	const disabledButtonPresentation = await cdp.evaluate(`(() => {
		const button = document.querySelector('#save-settings')
		if (!(button instanceof HTMLButtonElement)) return undefined
		const style = getComputedStyle(button)
		const luminance = value => {
			const channels = value.match(/\\d+(?:\\.\\d+)?/g)?.slice(0, 3).map(Number)
			if (channels?.length !== 3) return undefined
			const linear = channels.map(channel => {
				const normalized = channel / 255
				return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
			})
			return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
		}
		const foreground = luminance(style.color)
		const background = luminance(style.backgroundColor)
		return {
			contrast: foreground === undefined || background === undefined ? undefined : (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
			opacity: style.opacity,
		}
	})()`)
	expect(Reflect.get(Object(disabledButtonPresentation), 'opacity')).toBe('1')
	expect(Reflect.get(Object(disabledButtonPresentation), 'contrast')).toBeGreaterThanOrEqual(4.5)
	fixture.failNextStateRead = true
	await cdp.command('Network.setBlockedURLs', { urls: [`*://127.0.0.1:${dashboardPort.toString()}/api/signer`] })
	await cdp.evaluate(`(() => {
			const input = document.querySelector('#private-key')
			const form = document.querySelector('#signer-form')
			if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
			input.value = ${JSON.stringify(`0x${'99'.repeat(32)}`)}
			form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
		})()`)
	await waitFor("document.querySelector('#signer-status')?.textContent?.includes('configuration and state could not be reloaded') === true", `${viewport.label} partial signer reconciliation did not remain unresolved`)
	expect(await cdp.evaluate(`document.querySelector('#signer-fieldset')?.disabled`)).toBe(true)
	await cdp.command('Network.setBlockedURLs', { urls: [] })
	await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
	await waitFor("document.querySelector('#signer-status')?.textContent?.includes('Current configuration and state were reloaded') === true && document.querySelector('#signer-fieldset')?.disabled === false", `${viewport.label} unresolved signer mutation did not recover after a complete refresh`)
}

/** Paused policy editing, unresolved settings reconciliation, allowlist validation, and live-execution policy bounds. */
export async function verifyExecutionPolicyValidation(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { cdp, dashboard, dashboardPort, fixture, setExecutionMode, waitFor, waitForSettingsMutation } = context
	fixture.initialDashboardState = pausedWorkflowRenderingState
	fixture.recoveredDashboardState = pausedWorkflowRenderingState
	fixture.stateRequests = 0
	await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
	await waitFor("document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} paused execution policy did not become editable`)
	expect(
		await cdp.evaluate(`(() => {
			const input = document.querySelector('#workflow-valid-blocks')
			const unit = input?.nextElementSibling
			const bounds = unit?.getBoundingClientRect()
			return { disabled: input?.matches(':disabled'), unit: unit?.textContent?.trim(), unitVisible: (bounds?.width ?? 0) > 0 && (bounds?.height ?? 0) > 0 }
		})()`),
	).toEqual({ disabled: false, unit: 'blocks', unitVisible: true })
	fixture.failNextStateRead = true
	await cdp.command('Network.setBlockedURLs', { urls: [`*://127.0.0.1:${dashboardPort.toString()}/api/settings`] })
	await cdp.evaluate(`document.querySelector('#settings-form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('configuration and state could not be reloaded') === true", `${viewport.label} partial settings reconciliation did not remain unresolved`)
	expect(await cdp.evaluate(`document.querySelector('#settings-fields')?.disabled`)).toBe(true)
	await cdp.command('Network.setBlockedURLs', { urls: [] })
	await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
	await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('Current configuration and state were reloaded') === true && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} unresolved settings mutation did not recover after a complete refresh`)
	expect(
		await cdp.evaluate(`({
			all: document.querySelector('#all-selectable-operations')?.checked,
			allowlistDisabled: document.querySelector('#selectable-operation-allowlist')?.disabled,
		})`),
	).toEqual({ all: true, allowlistDisabled: true })
	const rejectedAllowlistMutationCount = fixture.settingsMutations.length
	await cdp.evaluate(`(() => {
		const all = document.querySelector('#all-selectable-operations')
		const allowlist = document.querySelector('#selectable-operation-allowlist')
		const form = document.querySelector('#settings-form')
		if (!(all instanceof HTMLInputElement) || !(allowlist instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return
		all.checked = false
		all.dispatchEvent(new InputEvent('input', { bubbles: true }))
		allowlist.value = 'surface.weth9.receive'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('Unknown independently selectable operation definition ID surface.weth9.receive') === true", `${viewport.label} coverage-only alias was not rejected from the selectable-operation allowlist`)
	expect(fixture.settingsMutations).toHaveLength(rejectedAllowlistMutationCount)
	await cdp.evaluate(`(() => {
		const all = document.querySelector('#all-selectable-operations')
		const allowlist = document.querySelector('#selectable-operation-allowlist')
		const form = document.querySelector('#settings-form')
		if (!(all instanceof HTMLInputElement) || !(allowlist instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return
		all.checked = false
		all.dispatchEvent(new InputEvent('input', { bubbles: true }))
		allowlist.value = 'open-oracle.weth.typo'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('Unknown independently selectable operation definition ID open-oracle.weth.typo') === true", `${viewport.label} unknown selectable operation ID was not rejected locally`)
	expect(fixture.settingsMutations).toHaveLength(rejectedAllowlistMutationCount)
	const stagedAllowlistMutationCount = fixture.settingsMutations.length + 1
	await cdp.evaluate(`(() => {
		const all = document.querySelector('#all-selectable-operations')
		const allowlist = document.querySelector('#selectable-operation-allowlist')
		const form = document.querySelector('#settings-form')
		if (!(all instanceof HTMLInputElement) || !(allowlist instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return
		all.checked = false
		all.dispatchEvent(new InputEvent('input', { bubbles: true }))
		allowlist.value = 'open-oracle.blocked-sibling\\ntrading.position.enter'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitForSettingsMutation(stagedAllowlistMutationCount, `${viewport.label} selectable-operation canary policy was not submitted`)
	expect(fixture.settingsMutations.at(-1)).toMatchObject({
		patch: { strategy: { selectableOperationAllowlist: ['open-oracle.blocked-sibling', 'trading.position.enter'] } },
	})
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} selectable-operation canary policy did not reconcile`)
	const highRiskMutationCount = fixture.settingsMutations.length + 1
	await cdp.evaluate(`(() => {
		window.operatorDialogReview = ''
		const highRisk = document.querySelector('#allow-high-risk')
		const form = document.querySelector('#settings-form')
		if (!(highRisk instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		highRisk.checked = true
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitForSettingsMutation(highRiskMutationCount, `${viewport.label} high-risk policy was not submitted`)
	expect(await cdp.evaluate('window.operatorDialogReview')).toMatch(/High-risk operations\s*Blocked\s*→\s*Allowed/)
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} high-risk policy did not reconcile`)
	await setExecutionMode(true, `${viewport.label} execution mode did not switch to live`)
	await cdp.evaluate(`(() => {
		const ethReserve = document.querySelector('#reserve-eth')
		const repReserve = document.querySelector('#reserve-rep')
		const form = document.querySelector('#settings-form')
		if (!(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		ethReserve.value = '0'
		repReserve.value = '10'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'ETH reserve must be greater than zero for live execution.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not reject a zero ETH reserve locally`)
	await cdp.evaluate(`(() => {
		const ethReserve = document.querySelector('#reserve-eth')
		const repReserve = document.querySelector('#reserve-rep')
		const form = document.querySelector('#settings-form')
		if (!(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		ethReserve.value = '0.05'
		repReserve.value = '0.000000000000000000'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'REP reserve must be greater than zero for live execution.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not reject a zero REP reserve locally`)
	await cdp.evaluate(`(() => {
		const ethReserve = document.querySelector('#reserve-eth')
		const repReserve = document.querySelector('#reserve-rep')
		const form = document.querySelector('#settings-form')
		if (!(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		ethReserve.value = '0.01'
		repReserve.value = '10'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'ETH reserve must retain at least one maximum-gas-cost-sized safety floor.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not retain one full gas budget as a safety floor`)
	const mutationCountBeforePrecisionCheck = fixture.settingsMutations.length
	await setExecutionMode(false, `${viewport.label} execution mode did not switch to dry run`)
	await cdp.evaluate(`(() => {
		const ethReserve = document.querySelector('#reserve-eth')
		const repReserve = document.querySelector('#reserve-rep')
		const form = document.querySelector('#settings-form')
		if (!(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		ethReserve.value = '0.0000000000000000001'
		repReserve.value = '0'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'ETH reserve must be a non-negative decimal amount with at most 18 places.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} policy did not reject reserve precision beyond 18 decimal places locally`)
	expect(fixture.settingsMutations).toHaveLength(mutationCountBeforePrecisionCheck)

	const mutationCountBeforeEqualDelay = fixture.settingsMutations.length
	await setExecutionMode(true, `${viewport.label} execution mode did not switch to live`)
	await cdp.evaluate(`(() => {
		const minDelay = document.querySelector('#min-delay')
		const maxDelay = document.querySelector('#max-delay')
		const ethReserve = document.querySelector('#reserve-eth')
		const repReserve = document.querySelector('#reserve-rep')
		const form = document.querySelector('#settings-form')
		if (!(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		minDelay.value = '60'
		maxDelay.value = '60'
		ethReserve.value = '0.05'
		repReserve.value = '10'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Minimum delay must be at least one second less than maximum delay.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not reject equal delay bounds locally`)
	expect(fixture.settingsMutations).toHaveLength(mutationCountBeforeEqualDelay)

	const mutationCountBeforeMaximumMinimumDelay = fixture.settingsMutations.length
	expect(await cdp.evaluate("document.querySelector('#min-delay')?.getAttribute('max')")).toBe('3599')
	await cdp.evaluate(`(() => {
		const minDelay = document.querySelector('#min-delay')
		const maxDelay = document.querySelector('#max-delay')
		const form = document.querySelector('#settings-form')
		if (!(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		minDelay.value = '3600'
		maxDelay.value = '3600'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
	})()`)
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Minimum delay must be at least one second less than maximum delay.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not reject a 3600-second minimum delay locally`)
	expect(fixture.settingsMutations).toHaveLength(mutationCountBeforeMaximumMinimumDelay)

	const dryRunMutationCount = fixture.settingsMutations.length + 1
	await setExecutionMode(false, `${viewport.label} execution mode did not switch to dry run`)
	await cdp.evaluate(`(() => {
		const minDelay = document.querySelector('#min-delay')
		const maxDelay = document.querySelector('#max-delay')
		const ethReserve = document.querySelector('#reserve-eth')
		const repReserve = document.querySelector('#reserve-rep')
		const maximumGasCost = document.querySelector('#maximum-gas-cost')
		const form = document.querySelector('#settings-form')
		if (!(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(maximumGasCost instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		minDelay.value = '60'
		maxDelay.value = '3600'
		ethReserve.value = '0'
		repReserve.value = '0.000000000000000000'
		maximumGasCost.value = '0.02'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
		})()`)
	await waitForSettingsMutation(dryRunMutationCount, `${viewport.label} dry-run zero-reserve policy was not submitted`)
	expect(fixture.settingsMutations.at(-1)).toEqual({
		patch: {
			runtime: { execute: false },
			scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
			strategy: {
				allowHighRiskOperations: false,
				allowIrreversibleOperations: false,
				initializeGenesisUniverse: true,
				enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
				maximumEthPerOperation: '0.05',
				maximumGasCostEth: '0.02',
				maximumRepPerOperation: '10',
				minimumEthReserve: '0',
				minimumRepReserve: '0.000000000000000000',
				selectableOperationAllowlist: null,
				workflowValidForBlocks: 288,
			},
		},
		revision: viewport.nextConfigurationRevision,
	})
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} dry-run zero-reserve policy did not reconcile`)

	const exactBoundaryMutationCount = fixture.settingsMutations.length + 1
	await setExecutionMode(true, `${viewport.label} execution mode did not switch to live`)
	await cdp.evaluate(`(() => {
		const minDelay = document.querySelector('#min-delay')
		const maxDelay = document.querySelector('#max-delay')
		const ethReserve = document.querySelector('#reserve-eth')
		const repReserve = document.querySelector('#reserve-rep')
		const maximumGasCost = document.querySelector('#maximum-gas-cost')
		const form = document.querySelector('#settings-form')
		if (!(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(maximumGasCost instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
		minDelay.value = '60'
		maxDelay.value = '3600'
		maximumGasCost.value = '0.123456789012345678'
		ethReserve.value = '0.123456789012345678'
		repReserve.value = '0.000000000000000001'
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
		})()`)
	await waitForSettingsMutation(exactBoundaryMutationCount, `${viewport.label} exact gas-cost safety-floor policy was not submitted`)
	expect(fixture.settingsMutations.at(-1)).toEqual({
		patch: {
			runtime: { execute: true },
			scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
			strategy: {
				allowHighRiskOperations: false,
				allowIrreversibleOperations: false,
				initializeGenesisUniverse: true,
				enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
				maximumEthPerOperation: '0.05',
				maximumGasCostEth: '0.123456789012345678',
				maximumRepPerOperation: '10',
				minimumEthReserve: '0.123456789012345678',
				minimumRepReserve: '0.000000000000000001',
				selectableOperationAllowlist: null,
				workflowValidForBlocks: 288,
			},
		},
		revision: viewport.nextConfigurationRevision,
	})
	await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} exact gas-cost safety-floor policy did not reconcile`)
}
