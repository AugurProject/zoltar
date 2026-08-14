import { createPublicClient, http, type Hash, type PublicClient } from '@zoltar/shared/ethereum'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { shortAddress } from '../app/format.ts'
import { AddressValue, Status } from '../components/Status.tsx'
import { parseDeploymentSetupInput, saveDeploymentConfiguration, type DeploymentConfiguration } from '../protocol/config.ts'
import { loadCoreDeployments } from '../protocol/coreDeployments.ts'
import { deployTradingStep, deploymentConfigurationForPlan, getTradingDeploymentPlan, loadTradingDeploymentStatus, nextTradingDeploymentStep, type CoreDeployment, type TradingDeploymentPlan } from '../protocol/deployment.ts'
import { getInjectedEthereum } from '../protocol/injected.ts'
import { connectWallet, createTradingWalletClient, publicErrorMessage, switchWalletChain, validateRpcChainId, walletChainId } from '../protocol/live.ts'

export type TradingDeploymentSetupServices = Readonly<{
	createPublicClient(rpcUrl: string): PublicClient
	loadCoreDeployments(): Promise<readonly CoreDeployment[]>
	saveConfiguration(configuration: DeploymentConfiguration): void
}>

const defaultServices: TradingDeploymentSetupServices = {
	createPublicClient: rpcUrl => createPublicClient({ transport: http(rpcUrl) }),
	loadCoreDeployments,
	saveConfiguration: configuration => saveDeploymentConfiguration(configuration),
}

type DeploymentStatus = Readonly<{ factory: boolean; router: boolean }>

function initialQueryValue(name: string) {
	return new URLSearchParams(window.location.search).get(name) ?? ''
}

function deploymentProgress(status: DeploymentStatus | undefined) {
	if (status === undefined) return '—'
	return `${Number(status.factory) + Number(status.router)} / 2`
}

function inspectionPresentation(state: 'idle' | 'loading' | 'ready' | 'error') {
	if (state === 'loading') return { label: 'Checking network', tone: 'neutral' as const }
	if (state === 'ready') return { label: 'Ready to deploy', tone: 'good' as const }
	if (state === 'error') return { label: 'Configuration unavailable', tone: 'warn' as const }
	return { label: 'Enter network settings', tone: 'neutral' as const }
}

function deploymentActionLabel(busy: boolean, nextStep: ReturnType<typeof nextTradingDeploymentStep>) {
	if (busy) return `Deploying ${nextStep?.label ?? 'contract'}…`
	if (nextStep === undefined) return 'Deployment ready'
	return `Deploy ${nextStep.label}`
}

export function TradingDeploymentSetup({
	configurationError,
	currentConfiguration,
	onComplete,
	onRetryManifest,
	services = defaultServices,
}: {
	configurationError: string | undefined
	currentConfiguration?: DeploymentConfiguration
	onComplete(configuration: DeploymentConfiguration): void
	onRetryManifest(): void
	services?: TradingDeploymentSetupServices
}) {
	const [coreDeployments, setCoreDeployments] = useState<readonly CoreDeployment[]>([])
	const [registryError, setRegistryError] = useState<string>()
	const [chainId, setChainId] = useState(initialQueryValue('chainId') || currentConfiguration?.chainId.toString() || '')
	const [rpcUrl, setRpcUrl] = useState(initialQueryValue('rpcUrl') || currentConfiguration?.rpcUrl || '')
	const [feeBps, setFeeBps] = useState(initialQueryValue('feeBps') || currentConfiguration?.feeBps.toString() || '30')
	const [inspectionState, setInspectionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
	const [inspectionError, setInspectionError] = useState<string>()
	const [plan, setPlan] = useState<TradingDeploymentPlan>()
	const [publicClient, setPublicClient] = useState<PublicClient>()
	const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>()
	const [busy, setBusy] = useState(false)
	const [actionMessage, setActionMessage] = useState<string>()
	const [submittedHash, setSubmittedHash] = useState<Hash>()
	const selectedCore = useMemo(() => coreDeployments.find(deployment => deployment.chainId.toString() === chainId), [chainId, coreDeployments])
	let inputError: string | undefined
	if (chainId !== '' && rpcUrl !== '' && feeBps !== '') {
		try {
			parseDeploymentSetupInput({ chainId, feeBps, rpcUrl })
		} catch (error) {
			inputError = publicErrorMessage(error, 'Deployment settings are invalid')
		}
	}

	useEffect(() => {
		let active = true
		void services
			.loadCoreDeployments()
			.then(deployments => {
				if (!active) return
				setCoreDeployments(deployments)
				setRegistryError(undefined)
			})
			.catch(error => {
				if (!active) return
				setRegistryError(publicErrorMessage(error, 'Unable to load canonical core deployments'))
			})
		return () => {
			active = false
		}
	}, [services])

	useEffect(() => {
		setPlan(undefined)
		setPublicClient(undefined)
		setDeploymentStatus(undefined)
		setActionMessage(undefined)
		setSubmittedHash(undefined)
		if (selectedCore === undefined || chainId === '' || rpcUrl === '' || feeBps === '' || inputError !== undefined) {
			setInspectionState('idle')
			setInspectionError(undefined)
			return
		}
		let active = true
		setInspectionState('loading')
		setInspectionError(undefined)
		void (async () => {
			try {
				const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl })
				const client = services.createPublicClient(input.rpcUrl)
				validateRpcChainId(await client.getChainId(), input.chainId)
				const nextPlan = getTradingDeploymentPlan(selectedCore, input.feeBps)
				const status = await loadTradingDeploymentStatus(client, nextPlan)
				if (!active) return
				setPublicClient(client)
				setPlan(nextPlan)
				setDeploymentStatus(status)
				setInspectionState('ready')
				if (status.factory && status.router) {
					const configuration = deploymentConfigurationForPlan(nextPlan, input.rpcUrl)
					services.saveConfiguration(configuration)
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
	}, [chainId, feeBps, inputError, onComplete, rpcUrl, selectedCore, services])

	const nextStep = plan === undefined || deploymentStatus === undefined ? undefined : nextTradingDeploymentStep(plan, deploymentStatus)
	const inspection = inspectionPresentation(inspectionState)
	async function deployNext() {
		if (busy || plan === undefined || publicClient === undefined || deploymentStatus === undefined || nextStep === undefined) return
		setBusy(true)
		setActionMessage(undefined)
		setSubmittedHash(undefined)
		let broadcastHash: Hash | undefined
		try {
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
			await deployTradingStep(walletClient, publicClient, plan, nextStep, hash => {
				broadcastHash = hash
				setSubmittedHash(hash)
			})
			if (getInjectedEthereum() !== provider || (await walletChainId(provider)) !== plan.core.chainId || (await connectWallet(provider)) !== account) throw new Error('Wallet context changed during deployment; verify the transaction before continuing')
			const status = await loadTradingDeploymentStatus(publicClient, plan)
			setDeploymentStatus(status)
			setSubmittedHash(undefined)
			if (status.factory && status.router) {
				const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl })
				const configuration = deploymentConfigurationForPlan(plan, input.rpcUrl)
				services.saveConfiguration(configuration)
				onComplete(configuration)
				return
			}
			setActionMessage(`${nextStep.label} deployed. Continue with ${nextTradingDeploymentStep(plan, status)?.label ?? 'the next contract'}.`)
		} catch (error) {
			const detail = publicErrorMessage(error, `Failed to deploy ${nextStep.label}`)
			setActionMessage(broadcastHash === undefined ? detail : `Transaction ${broadcastHash} was broadcast but setup did not finish. Verify it in your wallet before retrying. ${detail}`)
		} finally {
			setBusy(false)
		}
	}

	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Standalone live client</span>
					<h1>Set up two-way trading</h1>
					<p>Select a canonical Zoltar deployment and submit the two deterministic trading contracts from your wallet.</p>
				</div>
			</header>
			<section class='section deployment-setup'>
				{configurationError === undefined ? null : (
					<p class='deployment-setup__notice' role='alert'>
						{configurationError}
					</p>
				)}
				<div class='deployment-setup__fields'>
					<label class='field'>
						<span>Core network</span>
						<select value={chainId} disabled={busy || coreDeployments.length === 0} onChange={event => setChainId(event.currentTarget.value)}>
							<option value=''>Select network</option>
							{coreDeployments.map(deployment => (
								<option key={deployment.chainId} value={deployment.chainId.toString()}>
									{deployment.chainName} · chain {deployment.chainId.toString()}
								</option>
							))}
						</select>
					</label>
					<label class='field'>
						<span>RPC URL</span>
						<input type='url' value={rpcUrl} disabled={busy} placeholder='https://…' spellcheck={false} onInput={event => setRpcUrl(event.currentTarget.value)} />
					</label>
					<label class='field'>
						<span>Trading fee</span>
						<div class='amount-input'>
							<input inputMode='numeric' value={feeBps} disabled={busy} onInput={event => setFeeBps(event.currentTarget.value)} />
							<span>bps</span>
						</div>
					</label>
				</div>
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
						<div>
							<dt>Trading factory</dt>
							<dd>{plan === undefined ? 'Calculated after RPC verification' : <code title={plan.factory.address}>{shortAddress(plan.factory.address)}</code>}</dd>
						</div>
						<div>
							<dt>Router</dt>
							<dd>{plan === undefined ? 'Calculated after RPC verification' : <code title={plan.router.address}>{shortAddress(plan.router.address)}</code>}</dd>
						</div>
					</dl>
				)}
				<div class='deployment-setup__status' aria-live='polite'>
					<div>
						<span>Deployment progress</span>
						<strong>{deploymentProgress(deploymentStatus)}</strong>
					</div>
					<Status tone={inspection.tone}>{inspection.label}</Status>
				</div>
				{inspectionError === undefined ? null : (
					<p class='error' role='alert'>
						{inspectionError}
					</p>
				)}
				{actionMessage === undefined ? null : (
					<p class={submittedHash === undefined ? undefined : 'error'} role={submittedHash === undefined ? 'status' : 'alert'}>
						{actionMessage}
					</p>
				)}
				<div class='deployment-setup__actions'>
					<button class='primary-action' type='button' disabled={busy || inspectionState !== 'ready' || nextStep === undefined} aria-busy={busy} onClick={() => void deployNext()}>
						{deploymentActionLabel(busy, nextStep)}
					</button>
					<button class='secondary-action' type='button' disabled={busy} onClick={onRetryManifest}>
						Retry deployment
					</button>
				</div>
			</section>
		</main>
	)
}
