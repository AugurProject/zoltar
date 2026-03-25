import { useEffect, useState } from 'preact/hooks'
import { createPublicClient, createWalletClient, custom, formatEther, formatUnits, getAddress, http, publicActions, type Address, type Hash } from 'viem'
import { mainnet } from 'viem/chains'
import { ABIS } from './abis.js'
import { GENESIS_REPUTATION_TOKEN, getDeploymentSteps, loadDeploymentStatuses, type DeploymentStatus } from './contracts.js'
import { getInjectedEthereum, type InjectedEthereum } from './injectedEthereum.js'

const DEFAULT_RPC_URL = 'https://ethereum.dark.florist'

type AccountState = {
	address: Address | null
	chainId: string | null
	ethBalance: bigint | null
	repBalance: bigint | null
}

function createReadClient() {
	return createPublicClient({
		chain: mainnet,
		transport: http(DEFAULT_RPC_URL, { batch: { wait: 100 } }),
	})
}

function createWriteClient(ethereum: InjectedEthereum, accountAddress: Address) {
	return createWalletClient({
		account: accountAddress,
		chain: mainnet,
		transport: custom(ethereum),
	}).extend(publicActions)
}

function normalizeAccount(value: unknown): Address | null {
	if (typeof value !== 'string') return null
	return getAddress(value)
}

function formatAddress(address: Address) {
	return `${ address.slice(0, 6) }...${ address.slice(-4) }`
}

function formatCurrencyBalance(value: bigint | null, units: number = 18) {
	if (value === null) return 'Unavailable'
	return units === 18 ? Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : Number(formatUnits(value, units)).toLocaleString(undefined, { maximumFractionDigits: 6 })
}

function getPrerequisiteLabel(steps: DeploymentStatus[], index: number) {
	const missingStep = steps.slice(0, index).find(step => !step.deployed)
	return missingStep?.label ?? null
}

function renderDeploymentSection({ title, description, steps, allSteps, accountAddress, busyStepId, onDeploy }: { title: string; description: string; steps: DeploymentStatus[]; allSteps: DeploymentStatus[]; accountAddress: Address | null; busyStepId: string | null; onDeploy: (stepId: string) => Promise<void> }) {
	return (
		<section class="panel contract-panel">
			<div class="contract-panel-header">
				<div>
					<p class="panel-label">{title}</p>
					<h2>{title}</h2>
				</div>
				<p class="detail">{description}</p>
			</div>
			<div class="contract-list">
				{steps.map(step => {
					const stepIndex = allSteps.findIndex(candidate => candidate.id === step.id)
					const prerequisiteLabel = stepIndex === -1 ? null : getPrerequisiteLabel(allSteps, stepIndex)
					const isBusy = busyStepId === step.id
					const canDeploy = accountAddress !== null && prerequisiteLabel === null && !step.deployed && busyStepId === null

					return (
						<div class="contract-row" key={step.id}>
							<div class="contract-copy">
								<div class="contract-topline">
									<span class={`badge ${ step.deployed ? 'ok' : prerequisiteLabel === null ? 'pending' : 'blocked' }`}>{step.deployed ? 'Deployed' : prerequisiteLabel === null ? 'Ready' : 'Blocked'}</span>
									<h3>{step.label}</h3>
								</div>
								<p class="address">{step.address}</p>
								<p class="detail">{step.deployed ? 'Code found at expected address.' : prerequisiteLabel === null ? 'Ready to deploy.' : `Waiting for ${ prerequisiteLabel }.`}</p>
							</div>
							<button onClick={() => void onDeploy(step.id)} disabled={!canDeploy}>
								{step.deployed ? 'Deployed' : isBusy ? 'Deploying...' : 'Deploy'}
							</button>
						</div>
					)
				})}
			</div>
		</section>
	)
}

export function App() {
	const [accountState, setAccountState] = useState<AccountState>({
		address: null,
		chainId: null,
		ethBalance: null,
		repBalance: null,
	})
	const [deploymentStatuses, setDeploymentStatuses] = useState<DeploymentStatus[]>(() =>
		getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		})),
	)
	const [hasInjectedWallet, setHasInjectedWallet] = useState<boolean>(() => getInjectedEthereum() !== undefined)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [busyStepId, setBusyStepId] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [lastTransactionHash, setLastTransactionHash] = useState<Hash | null>(null)

	const refreshState = async () => {
		const ethereum = getInjectedEthereum()
		setHasInjectedWallet(ethereum !== undefined)

		setIsRefreshing(true)
		try {
			const readClient = createReadClient()
			const accounts = ethereum === undefined ? [] : await ethereum.request({ method: 'eth_accounts' })
			const connectedAddress = normalizeAccount(accounts[0])
			const chainId = ethereum === undefined ? `0x${ mainnet.id.toString(16) }` : await ethereum.request({ method: 'eth_chainId' })

			const [statuses, ethBalance, repBalance] = await Promise.all([
				loadDeploymentStatuses(readClient),
				connectedAddress === null ? Promise.resolve(null) : readClient.getBalance({ address: connectedAddress }),
				connectedAddress === null
					? Promise.resolve(null)
					: readClient
							.readContract({
								abi: ABIS.mainnet.erc20,
								functionName: 'balanceOf',
								address: GENESIS_REPUTATION_TOKEN,
								args: [connectedAddress],
							})
							.then(result => result)
							.catch(() => null),
			])

			setDeploymentStatuses(statuses)
			setAccountState({
				address: connectedAddress,
				chainId,
				ethBalance,
				repBalance,
			})
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh wallet state')
		} finally {
			setIsRefreshing(false)
		}
	}

	useEffect(() => {
		void refreshState()

		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) return

		const handleAccountsChanged = () => {
			void refreshState()
		}
		const handleChainChanged = () => {
			void refreshState()
		}

		ethereum.on?.('accountsChanged', handleAccountsChanged)
		ethereum.on?.('chainChanged', handleChainChanged)

		const intervalId = window.setInterval(() => {
			void refreshState()
		}, 15_000)

		return () => {
			window.clearInterval(intervalId)
			ethereum.removeListener?.('accountsChanged', handleAccountsChanged)
			ethereum.removeListener?.('chainChanged', handleChainChanged)
		}
	}, [])

	const connectWallet = async () => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			setErrorMessage('No injected wallet found')
			return
		}

		try {
			setErrorMessage(null)
			await ethereum.request({ method: 'eth_requestAccounts' })
			await refreshState()
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : 'Wallet connection failed')
		}
	}

	const deployStep = async (stepId: string) => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			setErrorMessage('No injected wallet found')
			return
		}
		if (accountState.address === null) {
			setErrorMessage('Connect a wallet before deploying')
			return
		}

		const latestStatuses = await loadDeploymentStatuses(createReadClient())
		const stepIndex = latestStatuses.findIndex(step => step.id === stepId)
		if (stepIndex === -1) return

		const prerequisiteLabel = getPrerequisiteLabel(latestStatuses, stepIndex)
		if (prerequisiteLabel !== null) {
			setErrorMessage(`Deploy ${ prerequisiteLabel } first`)
			return
		}

		const step = latestStatuses[stepIndex]
		if (step === undefined || step.deployed) {
			await refreshState()
			return
		}

		setBusyStepId(step.id)
		setErrorMessage(null)

		try {
			const client = createWriteClient(ethereum, accountState.address)
			const hash = await step.deploy(client)
			setLastTransactionHash(hash)
			await refreshState()
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : `Failed to deploy ${ step.label }`)
		} finally {
			setBusyStepId(null)
		}
	}

	const deployNextMissing = async () => {
		const nextMissing = deploymentStatuses.find((step, index) => !step.deployed && getPrerequisiteLabel(deploymentStatuses, index) === null)
		if (nextMissing === undefined) return
		await deployStep(nextMissing.id)
	}

	const deployedCount = deploymentStatuses.filter(step => step.deployed).length
	const nextMissingStep = deploymentStatuses.find((step, index) => !step.deployed && getPrerequisiteLabel(deploymentStatuses, index) === null) ?? null
	const proxyDeployerSteps = deploymentStatuses.filter(step => step.id === 'proxyDeployer')
	const zoltarSteps = deploymentStatuses.filter(step => step.id === 'zoltarQuestionData' || step.id === 'zoltar')
	const augurPlaceholderSteps = deploymentStatuses.filter(step => step.id !== 'proxyDeployer' && step.id !== 'zoltarQuestionData' && step.id !== 'zoltar')

	return (
		<main>
			<section class="hero">
				<div>
					<p class="eyebrow">Wallet Dashboard</p>
					<h1>Augur PLACEHOLDER deployment console</h1>
					<p class="lede">Connect a wallet, inspect ETH and REP balances, then deploy the deterministic core contracts in the grouped order below.</p>
				</div>
				<div class="actions">
					<button class="secondary" onClick={() => void refreshState()} disabled={isRefreshing}>
						{isRefreshing ? 'Refreshing...' : 'Refresh'}
					</button>
					<button onClick={() => void connectWallet()}>{accountState.address === null ? 'Connect Wallet' : 'Reconnect Wallet'}</button>
				</div>
			</section>

			{hasInjectedWallet ? null : <p class="notice warning">No injected wallet detected. Open this page in a browser with MetaMask or another EIP-1193 wallet.</p>}
			{errorMessage === null ? null : <p class="notice error">{errorMessage}</p>}
			{lastTransactionHash === null ? null : (
				<p class="notice success">
					Last transaction: <span>{lastTransactionHash}</span>
				</p>
			)}

			<section class="grid">
				<article class="panel">
					<p class="panel-label">Wallet</p>
					<h2>{accountState.address === null ? 'Not Connected' : formatAddress(accountState.address)}</h2>
					<p class="detail">{accountState.address ?? 'Connect a wallet to read balances and deploy contracts.'}</p>
					<div class="metric-row">
						<div>
							<span class="metric-label">Network</span>
							<strong>{accountState.chainId ?? 'Unknown'}</strong>
						</div>
						<div>
							<span class="metric-label">ETH</span>
							<strong>{formatCurrencyBalance(accountState.ethBalance)} ETH</strong>
						</div>
						<div>
							<span class="metric-label">REP</span>
							<strong>{formatCurrencyBalance(accountState.repBalance)} REP</strong>
						</div>
					</div>
				</article>

				<article class="panel">
					<p class="panel-label">Deployment Progress</p>
					<h2>
						{deployedCount} / {deploymentStatuses.length} Ready
					</h2>
					<p class="detail">{nextMissingStep === null ? 'All deterministic contracts are deployed.' : `Next deployable contract: ${ nextMissingStep.label }`}</p>
					<div class="actions">
						<button onClick={() => void deployNextMissing()} disabled={accountState.address === null || nextMissingStep === null || busyStepId !== null}>
							{busyStepId === null ? 'Deploy Next Missing' : 'Deployment In Progress'}
						</button>
					</div>
				</article>
			</section>

			{renderDeploymentSection({
				title: 'Proxy Deployer',
				description: 'Dedicated deployment path for the proxy deployer bootstrap transaction.',
				steps: proxyDeployerSteps,
				allSteps: deploymentStatuses,
				accountAddress: accountState.address,
				busyStepId,
				onDeploy: deployStep,
			})}

			{renderDeploymentSection({
				title: 'Zoltar',
				description: 'Core Zoltar contracts. Deploy ZoltarQuestionData before Zoltar.',
				steps: zoltarSteps,
				allSteps: deploymentStatuses,
				accountAddress: accountState.address,
				busyStepId,
				onDeploy: deployStep,
			})}

			{renderDeploymentSection({
				title: 'Augur PlaceHolder',
				description: 'Remaining deterministic deployment steps grouped under the Augur PlaceHolder bucket.',
				steps: augurPlaceholderSteps,
				allSteps: deploymentStatuses,
				accountAddress: accountState.address,
				busyStepId,
				onDeploy: deployStep,
			})}
		</main>
	)
}
