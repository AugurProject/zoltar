import { createPublicClient, http, type Hash, type PublicClient } from '@zoltar/shared/ethereum'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { ChainBackend } from '@zoltar/ui-core-shared/lib/chainBackend.js'
import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { shortAddress } from '../lib/format.js'
import { AddressValue, Status } from '../components/Status.js'
import { parseDeploymentSetupInput, type DeploymentConfiguration } from '../protocol/config.js'
import { isKnownDefaultRpcUrl, loadCoreDeployments } from '../protocol/coreDeployments.js'
import { deployTradingStep, deploymentConfigurationForPlan, getTradingDeploymentPlan, loadTradingDeploymentStatus, nextTradingDeploymentStep, type CoreDeployment, type TradingDeploymentPlan, type TradingDeploymentStep } from '../protocol/deployment.js'
import { createWalletContextSubscription, getInjectedEthereum, type InjectedEthereum } from '../protocol/injected.js'
import { connectedWalletAccount, connectWallet, createTradingWalletClient, publicErrorMessage, switchWalletChain, validateRpcChainId, walletChainId } from '../protocol/live.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import * as appCopy from '../copy/app.js'

export type TradingDeploymentSetupServices = Readonly<{
	createPublicClient(rpcUrl: string): PublicClient
	connectWallet?(): Promise<{ account: string; chainId: number; provider?: InjectedEthereum }>
	deployStep?(publicClient: PublicClient, plan: TradingDeploymentPlan, step: TradingDeploymentStep, onSubmitted: (hash: Hash) => void): Promise<void>
	getWalletProvider?(): InjectedEthereum | undefined
	loadCoreDeployments(): Promise<readonly CoreDeployment[]>
}>

export type DeploymentWalletState = Readonly<{ account: string | undefined; connecting: boolean; ready: boolean }>

export function createDeploymentReadClient(rpcUrl: string, backend: Pick<ChainBackend, 'createReadClient' | 'id'> = getActiveBackend()): PublicClient {
	return backend.id === 'simulation' ? backend.createReadClient() : createPublicClient({ transport: http(rpcUrl) })
}

const defaultServices: TradingDeploymentSetupServices = {
	createPublicClient: createDeploymentReadClient,
	connectWallet: async () => {
		const provider = getInjectedEthereum()
		if (provider === undefined) throw new Error('No injected wallet was found')
		const account = await connectWallet(provider)
		return { account, chainId: await walletChainId(provider), provider }
	},
	getWalletProvider: getInjectedEthereum,
	deployStep: async (publicClient, plan, step, onSubmitted) => {
		const provider = getInjectedEthereum()
		if (provider === undefined) throw new Error('No injected wallet was found')
		let currentChainId = await walletChainId(provider)
		if (currentChainId !== plan.core.chainId) {
			await switchWalletChain(provider, plan.core.chainId)
			currentChainId = await walletChainId(provider)
		}
		if (currentChainId !== plan.core.chainId) throw new Error(`Wallet must use ${plan.core.chainName}`)
		const account = await connectWallet(provider)
		const walletClient = createTradingWalletClient(provider, account)
		await deployTradingStep(walletClient, publicClient, plan, step, onSubmitted, async () => {
			validateRpcChainId(await publicClient.getChainId(), plan.core.chainId)
			if (getInjectedEthereum() !== provider || (await walletChainId(provider)) !== plan.core.chainId || (await connectWallet(provider)) !== account) throw new Error('Wallet context changed before deployment; no transaction was submitted')
		})
		if (getInjectedEthereum() !== provider || (await walletChainId(provider)) !== plan.core.chainId || (await connectWallet(provider)) !== account) throw new Error('Wallet context changed during deployment; verify the transaction before continuing')
	},
	loadCoreDeployments,
}

type DeploymentStatus = Readonly<{ factory: boolean; router: boolean }>

function initialQueryValue(name: string) {
	return new URLSearchParams(window.location.search).get(name) ?? ''
}

function deploymentProgress(status: DeploymentStatus | undefined) {
	if (status === undefined) return '—'
	return `${Number(status.factory) + Number(status.router)} / 2`
}

function inspectionPresentation(state: 'idle' | 'loading' | 'ready' | 'error', { busy, deploymentComplete, plan, registryError, registryLoading }: Readonly<{ busy: boolean; deploymentComplete: boolean; plan: boolean; registryError: boolean; registryLoading: boolean }>) {
	if (registryLoading) return { label: 'Loading networks', tone: 'neutral' as const }
	if (registryError) return { label: 'Networks unavailable', tone: 'warn' as const }
	if (busy) return { label: 'Deployment in progress', tone: 'neutral' as const }
	if (deploymentComplete) return { label: 'Deployment complete', tone: 'good' as const }
	if (state === 'loading') return { label: 'Checking network', tone: 'neutral' as const }
	if (state === 'ready') return { label: 'Ready to deploy', tone: 'good' as const }
	if (state === 'error') return { label: 'Configuration unavailable', tone: 'warn' as const }
	if (plan) return { label: 'Checking network', tone: 'neutral' as const }
	return { label: 'Select a network', tone: 'neutral' as const }
}

function deploymentActionLabel(busy: boolean, nextStep: ReturnType<typeof nextTradingDeploymentStep>, status: DeploymentStatus | undefined) {
	if (busy) return `Deploying ${nextStep?.label ?? 'contract'}…`
	if (status?.factory === true && status.router) return 'Deployment complete'
	if (nextStep === undefined) return 'Deploy trading contracts'
	return `Deploy ${nextStep.label}`
}

function contractStatusPresentation(deployed: boolean, isNext: boolean) {
	if (deployed) return { label: 'Deployed', tone: 'good' as const }
	if (isNext) return { label: 'Next to deploy', tone: 'neutral' as const }
	return { label: 'Not deployed', tone: 'warn' as const }
}

export function TradingDeploymentSetup({
	currentConfiguration,
	onComplete,
	onWorkflowLockChange = () => undefined,
	onWalletStateChange,
	services = defaultServices,
	settingsHost,
	walletControlRequestNonce,
}: {
	currentConfiguration?: DeploymentConfiguration
	onComplete(configuration: DeploymentConfiguration): void
	onWorkflowLockChange?(locked: boolean): void
	onWalletStateChange?(state: DeploymentWalletState): void
	services?: TradingDeploymentSetupServices
	settingsHost?: HTMLElement
	walletControlRequestNonce?: number
}) {
	const [coreDeployments, setCoreDeployments] = useState<readonly CoreDeployment[]>([])
	const [registryLoading, setRegistryLoading] = useState(true)
	const [registryError, setRegistryError] = useState<string>()
	const [chainId, setChainId] = useState(initialQueryValue('chainId') || currentConfiguration?.chainId.toString() || '')
	const [rpcUrl, setRpcUrl] = useState(initialQueryValue('rpcUrl') || currentConfiguration?.rpcUrl || '')
	const [rpcOverride, setRpcOverride] = useState(initialQueryValue('rpcUrl') !== '' || (currentConfiguration !== undefined && !isKnownDefaultRpcUrl(currentConfiguration.rpcUrl)))
	const feeBps = '30'
	const [walletAccount, setWalletAccount] = useState<string>()
	const [walletChain, setWalletChain] = useState<number>()
	const [walletConnectionMessage, setWalletConnectionMessage] = useState<string>()
	const [walletConnecting, setWalletConnecting] = useState(false)
	const [inspectionState, setInspectionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
	const [inspectionError, setInspectionError] = useState<string>()
	const [plan, setPlan] = useState<TradingDeploymentPlan>()
	const [publicClient, setPublicClient] = useState<PublicClient>()
	const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>()
	const [busy, setBusy] = useState(false)
	const [actionMessage, setActionMessage] = useState<string>()
	const [actionError, setActionError] = useState(false)
	const [retryNonce, setRetryNonce] = useState(0)
	const [inspectedRevision, setInspectedRevision] = useState<number>()
	const inputRevision = useRef(0)
	const walletConnectionPending = useRef(false)
	const walletConnectionRevision = useRef(0)
	const walletContextEventRevision = useRef(0)
	const mounted = useRef(true)
	const walletContextSubscription = useRef<ReturnType<typeof createWalletContextSubscription>>()
	if (walletContextSubscription.current === undefined)
		walletContextSubscription.current = createWalletContextSubscription(() => {
			walletContextEventRevision.current += 1
			if (walletConnectionPending.current) return
			walletConnectionRevision.current += 1
			setWalletAccount(undefined)
			setWalletChain(undefined)
			setWalletConnectionMessage('Wallet context changed. Reconnect before deploying.')
		})
	useEffect(() => {
		if (busy || currentConfiguration === undefined) return
		const nextChainId = currentConfiguration.chainId.toString()
		const nextRpcUrl = currentConfiguration.rpcUrl
		const nextRpcOverride = !isKnownDefaultRpcUrl(nextRpcUrl)
		if (chainId === nextChainId && rpcUrl === nextRpcUrl) {
			if (rpcOverride !== nextRpcOverride) setRpcOverride(nextRpcOverride)
			return
		}
		inputRevision.current += 1
		setChainId(nextChainId)
		setRpcUrl(nextRpcUrl)
		setRpcOverride(nextRpcOverride)
	}, [busy, currentConfiguration])
	const selectedCore = coreDeployments.find(deployment => deployment.chainId.toString() === chainId)
	useEffect(() => {
		if (busy || coreDeployments.length === 0 || selectedCore !== undefined || chainId !== '') return
		inputRevision.current += 1
		setChainId(coreDeployments[0]?.chainId.toString() ?? '')
	}, [busy, chainId, coreDeployments, selectedCore])
	useEffect(() => {
		if (busy || rpcOverride || selectedCore === undefined || rpcUrl === selectedCore.defaultRpcUrl) return
		inputRevision.current += 1
		setRpcUrl(selectedCore.defaultRpcUrl)
	}, [busy, rpcOverride, rpcUrl, selectedCore])
	const effectiveRpcUrl = rpcOverride ? rpcUrl : (selectedCore?.defaultRpcUrl ?? rpcUrl)
	const walletConnected = walletAccount !== undefined
	const walletReady = walletConnected && selectedCore !== undefined && walletChain === selectedCore.chainId
	let inputError: string | undefined
	if (chainId !== '' && rpcUrl !== '') {
		try {
			parseDeploymentSetupInput({ chainId, feeBps, rpcUrl })
		} catch (error) {
			inputError = publicErrorMessage(error, 'Deployment settings are invalid')
		}
	}

	useEffect(() => {
		let active = true
		setRegistryLoading(true)
		setRegistryError(undefined)
		setCoreDeployments([])
		void (async () => {
			try {
				const deployments = await services.loadCoreDeployments()
				if (!active) return
				setCoreDeployments(deployments)
			} catch (error) {
				if (!active) return
				setRegistryError(publicErrorMessage(error, 'Unable to load canonical core deployments'))
			} finally {
				if (active) setRegistryLoading(false)
			}
		})()
		return () => {
			active = false
		}
	}, [retryNonce, services])

	useEffect(() => {
		const revision = inputRevision.current
		setPlan(undefined)
		setPublicClient(undefined)
		setDeploymentStatus(undefined)
		setActionMessage(undefined)
		setActionError(false)
		setInspectedRevision(undefined)
		if (selectedCore === undefined || chainId === '' || effectiveRpcUrl === '' || inputError !== undefined) {
			setInspectionState('idle')
			setInspectionError(undefined)
			return
		}
		let active = true
		setInspectionState('loading')
		setInspectionError(undefined)
		void (async () => {
			try {
				const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
				const client = services.createPublicClient(input.rpcUrl)
				validateRpcChainId(await client.getChainId(), input.chainId)
				const nextPlan = getTradingDeploymentPlan(selectedCore, input.feeBps)
				const status = await loadTradingDeploymentStatus(client, nextPlan)
				if (!active || revision !== inputRevision.current) return
				setPublicClient(client)
				setPlan(nextPlan)
				setDeploymentStatus(status)
				setInspectedRevision(revision)
				setInspectionState('ready')
				if (status.factory && status.router) {
					const configuration = deploymentConfigurationForPlan(nextPlan, input.rpcUrl)
					onComplete(configuration)
					return
				}
			} catch (error) {
				if (!active) return
				setInspectionState('error')
				setInspectionError(publicErrorMessage(error, 'Unable to inspect the selected deployment'))
			}
		})()
		return () => {
			active = false
		}
	}, [chainId, effectiveRpcUrl, feeBps, inputError, onComplete, retryNonce, selectedCore, services])

	function bindWalletProvider(provider: InjectedEthereum | undefined) {
		walletContextSubscription.current?.bind(provider)
	}
	useEffect(() => {
		mounted.current = true
		bindWalletProvider(services.getWalletProvider?.())
		return () => {
			mounted.current = false
			walletConnectionRevision.current += 1
			walletConnectionPending.current = false
			walletContextSubscription.current?.dispose()
		}
	}, [services])
	async function connectDeploymentWallet() {
		if (walletConnectionPending.current) return
		walletConnectionPending.current = true
		setWalletConnecting(true)
		const revision = walletConnectionRevision.current + 1
		walletConnectionRevision.current = revision
		setWalletConnectionMessage(undefined)
		try {
			const initialProvider = services.getWalletProvider?.()
			bindWalletProvider(initialProvider)
			if (initialProvider === undefined && services.connectWallet === undefined) throw new Error('No injected wallet was found')
			if (initialProvider !== undefined && selectedCore !== undefined) {
				const currentChain = await walletChainId(initialProvider)
				if (currentChain !== selectedCore.chainId) {
					await switchWalletChain(initialProvider, selectedCore.chainId)
					const switchedChain = await walletChainId(initialProvider)
					if (switchedChain !== selectedCore.chainId) throw new Error(`Wallet must use ${selectedCore.chainName}`)
				}
			}
			const connectService = services.connectWallet
			if (connectService === undefined) throw new Error('Wallet connection service is unavailable')
			const connected = await connectService()
			if (!mounted.current || walletConnectionRevision.current !== revision) return
			const provider = initialProvider ?? connected.provider
			bindWalletProvider(provider)
			const contextRevision = walletContextEventRevision.current
			const account = provider === undefined ? connected.account : await connectedWalletAccount(provider)
			const connectedChain = provider === undefined ? connected.chainId : await walletChainId(provider)
			if (walletContextEventRevision.current !== contextRevision) throw new Error('Wallet context changed during connection')
			const currentProvider = services.getWalletProvider?.()
			if (provider !== undefined && currentProvider !== undefined && currentProvider !== provider) throw new Error('Wallet provider changed during connection')
			if (!mounted.current || walletConnectionRevision.current !== revision) return
			setWalletAccount(account)
			setWalletChain(connectedChain)
		} catch (error) {
			if (!mounted.current || walletConnectionRevision.current !== revision) return
			setWalletAccount(undefined)
			setWalletChain(undefined)
			setWalletConnectionMessage(publicErrorMessage(error, 'Wallet connection failed'))
		} finally {
			if (mounted.current && walletConnectionRevision.current === revision) {
				walletConnectionPending.current = false
				setWalletConnecting(false)
			}
		}
	}
	function disconnectDeploymentWallet() {
		walletConnectionRevision.current += 1
		walletConnectionPending.current = false
		setWalletConnecting(false)
		setWalletAccount(undefined)
		setWalletChain(undefined)
		setWalletConnectionMessage(undefined)
	}
	const walletControlRevision = useRef(walletControlRequestNonce)
	useEffect(() => {
		onWalletStateChange?.({ account: walletAccount, connecting: walletConnecting, ready: !registryLoading && registryError === undefined && selectedCore !== undefined })
	}, [onWalletStateChange, registryError, registryLoading, selectedCore, walletAccount, walletConnecting])
	useEffect(
		() => () => {
			onWalletStateChange?.({ account: undefined, connecting: false, ready: false })
		},
		[onWalletStateChange],
	)
	useEffect(() => {
		if (walletControlRequestNonce === undefined || walletControlRevision.current === walletControlRequestNonce) return
		walletControlRevision.current = walletControlRequestNonce
		if (walletAccount === undefined) void connectDeploymentWallet()
		else disconnectDeploymentWallet()
	}, [walletControlRequestNonce])
	const nextStep = plan === undefined || deploymentStatus === undefined ? undefined : nextTradingDeploymentStep(plan, deploymentStatus)
	const deploymentComplete = deploymentStatus?.factory === true && deploymentStatus.router
	const deploymentSteps =
		plan === undefined
			? []
			: [plan.factory, plan.router].map(step => {
					const deployed = deploymentStatus?.[step.id] === true
					const isNext = nextTradingDeploymentStep(plan, deploymentStatus ?? { factory: false, router: false })?.id === step.id && !deploymentComplete
					return { step, presentation: contractStatusPresentation(deployed, isNext) }
				})
	const inspectionIsCurrent = inspectedRevision === inputRevision.current
	const inspection = inspectionPresentation(inspectionState, { busy, deploymentComplete, plan: plan !== undefined, registryError: registryError !== undefined, registryLoading })
	const retryChecks = registryError !== undefined || inspectionState === 'error'
	let standaloneWalletButton
	if (walletControlRequestNonce === undefined)
		standaloneWalletButton = walletConnected ? (
			<button class='wallet-button' type='button' disabled={busy} aria-label={`Disconnect wallet ${walletAccount}`} title='Disconnect wallet' onClick={disconnectDeploymentWallet}>
				{shortAddress(walletAccount)}
			</button>
		) : (
			<button class='wallet-button' type='button' disabled={busy || walletConnecting || registryLoading || coreDeployments.length === 0} aria-busy={walletConnecting} onClick={() => void connectDeploymentWallet()}>
				{walletConnecting ? 'Connecting wallet…' : 'Connect wallet'}
			</button>
		)
	let retryAction
	if (retryChecks)
		retryAction = (
			<button
				class='secondary-action'
				type='button'
				disabled={busy || registryLoading || inspectionState === 'loading'}
				onClick={() => {
					setRegistryLoading(true)
					setRegistryError(undefined)
					setRetryNonce(current => current + 1)
				}}
			>
				Retry checks
			</button>
		)
	async function deployNext() {
		if (busy || registryLoading || registryError !== undefined || inspectedRevision !== inputRevision.current || plan === undefined || publicClient === undefined || deploymentStatus === undefined || nextStep === undefined) return
		setBusy(true)
		onWorkflowLockChange(true)
		setActionMessage(undefined)
		setActionError(false)
		let broadcastHash: Hash | undefined
		try {
			const deployStep = services.deployStep ?? defaultServices.deployStep
			if (deployStep === undefined) throw new Error('Trading deployment service is unavailable')
			await deployStep(publicClient, plan, nextStep, hash => {
				broadcastHash = hash
			})
			const status = await loadTradingDeploymentStatus(publicClient, plan)
			setDeploymentStatus(status)
			if (status.factory && status.router) {
				const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
				const configuration = deploymentConfigurationForPlan(plan, input.rpcUrl)
				onComplete(configuration)
				return
			}
			setActionMessage(`${nextStep.label} deployed. Continue with ${nextTradingDeploymentStep(plan, status)?.label ?? 'the next contract'}.`)
		} catch (error) {
			setActionError(true)
			let detail = publicErrorMessage(error, `Failed to deploy ${nextStep.label}`)
			try {
				const status = await loadTradingDeploymentStatus(publicClient, plan)
				setDeploymentStatus(status)
				if (status[nextStep.id]) {
					if (status.factory && status.router) {
						const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
						const configuration = deploymentConfigurationForPlan(plan, input.rpcUrl)
						onComplete(configuration)
						return
					}
					setActionError(false)
					setActionMessage(`${nextStep.label} is already installed. Continue with ${nextTradingDeploymentStep(plan, status)?.label ?? 'the next contract'}.`)
					return
				}
			} catch (recoveryError) {
				detail = `${detail} Unable to verify deployment status: ${publicErrorMessage(recoveryError, 'Unknown recovery error')}`
			}
			setActionMessage(broadcastHash === undefined ? detail : `Transaction ${broadcastHash} was broadcast but setup did not finish. Verify it in your wallet before retrying. ${detail}`)
		} finally {
			setBusy(false)
			onWorkflowLockChange(false)
		}
	}
	const settingsPanel = (
		<details class='deployment-settings' open={rpcOverride || undefined}>
			<summary>Settings</summary>
			<div class='deployment-settings__panel'>
				<label class='field'>
					<span>Network</span>
					<select
						value={chainId}
						disabled={busy || registryLoading || coreDeployments.length === 0}
						onChange={event => {
							inputRevision.current += 1
							const nextChainId = event.currentTarget.value
							setChainId(nextChainId)
							const nextDeployment = coreDeployments.find(deployment => deployment.chainId.toString() === nextChainId)
							setRpcOverride(false)
							setRpcUrl(nextDeployment?.defaultRpcUrl ?? '')
						}}
					>
						{coreDeployments.map(deployment => (
							<option key={deployment.chainId} value={deployment.chainId.toString()}>
								{deployment.chainName}
							</option>
						))}
					</select>
				</label>
				<label class='field'>
					<span>RPC URL</span>
					<input
						type='url'
						value={rpcOverride ? rpcUrl : (selectedCore?.defaultRpcUrl ?? '')}
						disabled={busy}
						placeholder={selectedCore?.defaultRpcUrl ?? 'https://…'}
						spellcheck={false}
						onInput={event => {
							inputRevision.current += 1
							setRpcOverride(true)
							setRpcUrl(event.currentTarget.value)
						}}
					/>
				</label>
			</div>
		</details>
	)

	return (
		<main class='route' id='main-content'>
			{settingsHost === undefined ? null : createPortal(settingsPanel, settingsHost)}
			<RouteHeader eyebrow={appCopy.standaloneLiveClient} title={appCopy.deploy} description={appCopy.deploymentDescription} actions={standaloneWalletButton} />
			<section class='section deployment-setup'>
				{settingsHost === undefined ? settingsPanel : null}
				{registryError === undefined ? null : (
					<p class='error' role='alert'>
						{registryError}
					</p>
				)}
				{inputError === undefined ? null : (
					<p class='error' role='alert'>
						{inputError}
					</p>
				)}
				{selectedCore === undefined ? null : (
					<dl class='fact-list deployment-setup__contracts'>
						<div>
							<dt>SecurityPoolFactory</dt>
							<dd>
								<AddressValue value={selectedCore.securityPoolFactory} />
							</dd>
						</div>
					</dl>
				)}
				{plan === undefined ? null : (
					<div class='deployment-setup__steps'>
						<h2>Trading contracts</h2>
						<ul>
							{deploymentSteps.map(({ step, presentation }) => (
								<li class='deployment-step' key={step.id}>
									<Status tone={presentation.tone}>{presentation.label}</Status>
									<div class='deployment-step__details'>
										<strong>{step.label}</strong>
										<code title={step.address}>{shortAddress(step.address)}</code>
									</div>
								</li>
							))}
						</ul>
					</div>
				)}
				<div class='deployment-setup__status' role='status' aria-live='polite'>
					<div>
						<span>Deployment progress</span>
						<strong>{deploymentProgress(deploymentStatus)}</strong>
					</div>
					<Status tone={inspection.tone}>{inspection.label}</Status>
				</div>
				{walletConnected && !walletReady && selectedCore !== undefined ? (
					<p class='error' role='alert'>
						{`The connected wallet must use ${selectedCore.chainName}. Reconnect to switch networks.`}
					</p>
				) : null}
				{walletConnectionMessage === undefined ? null : (
					<p class='error' role='alert'>
						{walletConnectionMessage}
					</p>
				)}
				{inspectionError === undefined ? null : (
					<p class='error' role='alert'>
						{inspectionError}
					</p>
				)}
				{actionMessage === undefined ? null : (
					<p class={actionError ? 'error' : undefined} role={actionError ? 'alert' : 'status'}>
						{actionMessage}
					</p>
				)}
				<div class='deployment-setup__actions'>
					{deploymentComplete ? null : (
						<button class='primary-action' type='button' disabled={busy || registryLoading || registryError !== undefined || !inspectionIsCurrent || inspectionState !== 'ready' || nextStep === undefined || !walletReady} aria-busy={busy} onClick={() => void deployNext()}>
							{deploymentActionLabel(busy, nextStep, deploymentStatus)}
						</button>
					)}
					{retryAction}
				</div>
			</section>
		</main>
	)
}
