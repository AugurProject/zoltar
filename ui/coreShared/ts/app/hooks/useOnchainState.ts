import { useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { createConnectedReadClient, normalizeAccount } from '../../lib/clients.js'
import type { ChainBackend, ReadBackendStatus } from '../../lib/chainBackend.js'
import { getErrorMessage, hasErrorCode, hasErrorMessage } from '../../lib/errors.js'
import { getActiveBackend } from '../../lib/activeEnvironment.js'
import { getNetworkSwitchTarget, getPublicNetworkProfileForChainId } from '../../lib/networkProfile.js'
import { useRequestGuard } from '../../lib/requestGuard.js'
import type { AccountState, RefreshStateOptions } from '../../types/app.js'
import type { DeploymentStatus, DeploymentStep, ReadClient } from '../../types/contracts.js'
import { useLoadController } from '../../hooks/useLoadController.js'
import { sameChainId } from '../../lib/chainId.js'

type ChainClock = {
	currentBlockNumber: bigint | undefined
	currentTimestamp: bigint | undefined
}

type ReadBackendValidationResult = {
	readBackendMessage: string | undefined
	validated: boolean
}

function getExpectedReadChainId(backend: ChainBackend) {
	return backend.profile.chain.id
}

function buildReadBackendMismatchMessage(backend: ChainBackend, actualChainId: number) {
	return `Configured read RPC reports chain ${actualChainId.toString()}, but this app requires ${backend.profile.displayName} (${getExpectedReadChainId(backend).toString()}).`
}

function getReadBackendStatus(backend: ChainBackend): ReadBackendStatus {
	return (
		backend.getReadBackendStatus?.() ?? {
			blockNumber: undefined,
			blockTimestamp: undefined,
			rpcSource: 'default',
			rpcUrl: backend.profile.displayName,
			transportMode: 'provider',
		}
	)
}

async function validateConfiguredReadBackend(backend: ChainBackend): Promise<ReadBackendValidationResult> {
	try {
		const readClient = backend.createReadClient()
		const readChainId = await readClient.getChainId()
		if (readChainId !== getExpectedReadChainId(backend)) {
			return {
				readBackendMessage: buildReadBackendMismatchMessage(backend, readChainId),
				validated: true,
			}
		}
		const block = await readClient.getBlock()
		const blockNumber = typeof block.number === 'bigint' ? block.number : undefined
		const blockTimestamp = typeof block.timestamp === 'bigint' ? block.timestamp : undefined
		backend.setReadBackendBlock?.({
			number: blockNumber,
			timestamp: blockTimestamp,
		})
		const currentUnixSeconds = BigInt(Math.floor(Date.now() / 1000))
		if (backend.profile.id !== 'simulation' && blockTimestamp !== undefined && currentUnixSeconds > blockTimestamp + READ_BACKEND_STALE_BLOCK_SECONDS) {
			return {
				readBackendMessage: `Configured read RPC is stale. Latest block timestamp is ${blockTimestamp.toString()}, more than 10 minutes behind local time.`,
				validated: true,
			}
		}
		return {
			readBackendMessage: undefined,
			validated: true,
		}
	} catch (error) {
		throw new Error(getErrorMessage(error, 'Failed to validate the configured read RPC'))
	}
}

type LoadWalletStateParameters = {
	chainIdPromise: Promise<string> | undefined
	connectedAddress: Address | undefined
	ethBalanceAttoEthPromise: Promise<bigint> | undefined
	fallbackChainId?: string
	getAccountState: () => AccountState
	isCurrent: () => boolean
	setAccountState: (state: AccountState) => void
	setEthBalanceErrorMessage?: (message: string | undefined) => void
	setErrorMessage: (message: string | undefined) => void
	setWethBalanceAttoEthErrorMessage?: (message: string | undefined) => void
	trackLoad: <TResult>(work: () => Promise<TResult>) => Promise<TResult>
	wethBalanceAttoEthPromise: Promise<bigint> | undefined
}

export async function loadWalletState({ chainIdPromise, connectedAddress, ethBalanceAttoEthPromise, fallbackChainId, getAccountState, isCurrent, setAccountState, setErrorMessage, setEthBalanceErrorMessage, setWethBalanceAttoEthErrorMessage, trackLoad, wethBalanceAttoEthPromise }: LoadWalletStateParameters) {
	if (connectedAddress === undefined || chainIdPromise === undefined || ethBalanceAttoEthPromise === undefined || wethBalanceAttoEthPromise === undefined) return
	const resolvedFallbackChainId = fallbackChainId ?? '0x1'
	const ethBalanceAttoEthError = setEthBalanceErrorMessage ?? setErrorMessage
	const wethBalanceAttoEthError = setWethBalanceAttoEthErrorMessage ?? setErrorMessage

	void trackLoad(async () => {
		try {
			const chainId = await chainIdPromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), chainId })
		} catch (error) {
			if (!hasErrorCode(error) && !hasErrorMessage(error)) throw error
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), chainId: resolvedFallbackChainId })
		}
	})

	void trackLoad(async () => {
		try {
			const ethBalanceAttoEth = await ethBalanceAttoEthPromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), ethBalanceAttoEth })
		} catch (error) {
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), ethBalanceAttoEth: undefined })
			ethBalanceAttoEthError(getErrorMessage(error, setEthBalanceErrorMessage === undefined ? 'Failed to refresh wallet balances' : 'Failed to refresh ETH balance'))
		}
	})

	void trackLoad(async () => {
		try {
			const wethBalanceAttoEth = await wethBalanceAttoEthPromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), wethBalanceAttoEth })
		} catch (error) {
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), wethBalanceAttoEth: undefined })
			wethBalanceAttoEthError(getErrorMessage(error, setWethBalanceAttoEthErrorMessage === undefined ? 'Failed to refresh wallet balances' : 'Failed to refresh WETH balance'))
		}
	})
}

const CHAIN_CLOCK_POLL_INTERVAL_MILLISECONDS = 12_000
const READ_BACKEND_STALE_BLOCK_SECONDS = 10n * 60n

async function loadBackendChainClock(backend: ChainBackend): Promise<ChainClock> {
	if (backend.isBootstrapped === false)
		return {
			currentBlockNumber: undefined,
			currentTimestamp: undefined,
		}

	const block = await backend.createReadClient().getBlock()
	return {
		currentBlockNumber: typeof block.number === 'bigint' ? block.number : undefined,
		currentTimestamp: typeof block.timestamp === 'bigint' ? block.timestamp : undefined,
	}
}

type UseOnchainStateOptions = {
	activeEnvironmentNonce?: number
	enableChainClock?: boolean
	onSupportedNetworkChange?: (chainId: string) => void
}

export type UseOnchainStateDependencies = {
	getDeploymentSteps: () => ReadonlyArray<DeploymentStep>
	getWethAddress: () => Address
	loadDeploymentStatusOracleSnapshot: (readClient: ReadClient) => Promise<{ augurStatoblastDeployed: boolean; deploymentStatuses: DeploymentStatus[] }>
	loadErc20Balance: (readClient: ReadClient, tokenAddress: Address, accountAddress: Address) => Promise<bigint>
}

export function useOnchainState({ activeEnvironmentNonce = 0, enableChainClock = true, onSupportedNetworkChange }: UseOnchainStateOptions = {}, dependencies: UseOnchainStateDependencies) {
	const accountState = useSignal<AccountState>({
		address: undefined,
		chainId: undefined,
		ethBalanceAttoEth: undefined,
		wethBalanceAttoEth: undefined,
	})
	const deploymentStatuses = useSignal<DeploymentStatus[]>(
		dependencies.getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		})),
	)
	const hasInjectedWallet = useSignal(getActiveBackend().hasWallet())
	const walletStateLoad = useLoadController()
	const deploymentStatusLoad = useLoadController()
	const deploymentStatusesLoaded = useSignal(false)
	const augurStatoblastDeployed = useSignal<boolean | undefined>(undefined)
	const currentTimestamp = useSignal<bigint | undefined>(getActiveBackend().currentTimestamp)
	const currentBlockNumber = useSignal<bigint | undefined>(undefined)
	const environmentBootstrapError = useSignal<string | undefined>(undefined)
	const environmentBootstrapLabel = useSignal(getActiveBackend().bootstrapLabel)
	const environmentBootstrapProgress = useSignal(getActiveBackend().bootstrapProgress)
	const environmentReady = useSignal(getActiveBackend().isBootstrapped ?? true)
	const environmentReadyLoad = useLoadController()
	const walletBootstrapComplete = useSignal(false)
	const isConnectingWallet = useSignal(false)
	const isManagingWallet = useSignal(false)
	const nextRefresh = useRequestGuard()
	const nextChainClockRefresh = useRequestGuard()
	const chainClockRefreshRef = useRef<{ activeEnvironmentNonce: number; backend: ChainBackend; promise: Promise<void> } | undefined>(undefined)
	const renderedBackend = getActiveBackend()
	const walletActionContextRef = useRef({ activeEnvironmentNonce, backend: renderedBackend })
	const connectWalletGenerationRef = useRef(0)
	const manageWalletGenerationRef = useRef(0)
	const supportedNetworkChangeRef = useRef(onSupportedNetworkChange)
	supportedNetworkChangeRef.current = onSupportedNetworkChange
	if (walletActionContextRef.current.activeEnvironmentNonce !== activeEnvironmentNonce || walletActionContextRef.current.backend !== renderedBackend) {
		walletActionContextRef.current = { activeEnvironmentNonce, backend: renderedBackend }
		connectWalletGenerationRef.current += 1
		manageWalletGenerationRef.current += 1
	}
	const chainClockContextRef = useRef({ activeEnvironmentNonce, enableChainClock })
	const previousChainClockContextRef = useRef({ activeEnvironmentNonce, enableChainClock })
	chainClockContextRef.current = { activeEnvironmentNonce, enableChainClock }
	const errorMessage = useSignal<string | undefined>(undefined)
	const deploymentStatusError = useSignal<string | undefined>(undefined)
	const ethBalanceAttoEthError = useSignal<string | undefined>(undefined)
	const wethBalanceAttoEthError = useSignal<string | undefined>(undefined)
	const chainClockError = useSignal<string | undefined>(undefined)
	const readBackendMessage = useSignal<string | undefined>(undefined)
	const readBackendValidated = useSignal(false)
	const readBackendStatus = useSignal<ReadBackendStatus>(getReadBackendStatus(getActiveBackend()))
	const clearChainClock = () => {
		currentBlockNumber.value = undefined
		currentTimestamp.value = undefined
	}
	const updateReadBackendStatus = (backend: ChainBackend, block?: ChainClock) => {
		backend.setReadBackendBlock?.({
			number: block?.currentBlockNumber,
			timestamp: block?.currentTimestamp,
		})
		readBackendStatus.value = getReadBackendStatus(backend)
	}
	const isReadBackendReady = () => readBackendValidated.value && readBackendMessage.value === undefined
	const setDeploymentStatuses = (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => {
		const updated = update(deploymentStatuses.value)
		deploymentStatuses.value = updated
		if (updated.every(step => step.deployed)) augurStatoblastDeployed.value = true
	}
	const invalidateDeploymentState = () => {
		deploymentStatuses.value = dependencies.getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		}))
		deploymentStatusesLoaded.value = false
		augurStatoblastDeployed.value = undefined
	}
	const refreshChainClock = (backend: ChainBackend) => {
		const activeRequest = chainClockRefreshRef.current
		if (activeRequest !== undefined && activeRequest.activeEnvironmentNonce === activeEnvironmentNonce && activeRequest.backend === backend) return activeRequest.promise
		const isCurrent = nextChainClockRefresh()
		const requestEnvironmentNonce = activeEnvironmentNonce
		const isCurrentChainClockRequest = () => {
			const context = chainClockContextRef.current
			return isCurrent() && context.enableChainClock && context.activeEnvironmentNonce === requestEnvironmentNonce && getActiveBackend() === backend
		}
		const promise = (async () => {
			try {
				const nextChainClock = await loadBackendChainClock(backend)
				if (!isCurrentChainClockRequest()) return
				currentTimestamp.value = nextChainClock.currentTimestamp
				currentBlockNumber.value = nextChainClock.currentBlockNumber
				chainClockError.value = undefined
				updateReadBackendStatus(backend, nextChainClock)
			} catch (error) {
				if (!isCurrentChainClockRequest()) return
				clearChainClock()
				updateReadBackendStatus(backend)
				chainClockError.value = getErrorMessage(error, 'Failed to refresh chain clock')
			}
		})()
		chainClockRefreshRef.current = { activeEnvironmentNonce: requestEnvironmentNonce, backend, promise }
		void promise.finally(() => {
			if (chainClockRefreshRef.current?.promise === promise) chainClockRefreshRef.current = undefined
		})
		return promise
	}

	useLayoutEffect(() => {
		const previousContext = previousChainClockContextRef.current
		const environmentChanged = previousContext.activeEnvironmentNonce !== activeEnvironmentNonce
		previousChainClockContextRef.current = { activeEnvironmentNonce, enableChainClock }
		nextChainClockRefresh()
		chainClockRefreshRef.current = undefined
		if (!enableChainClock || environmentChanged) {
			clearChainClock()
			chainClockError.value = undefined
		}
	}, [activeEnvironmentNonce, enableChainClock])

	useLayoutEffect(() => {
		isConnectingWallet.value = false
		isManagingWallet.value = false
	}, [activeEnvironmentNonce, renderedBackend])

	useLayoutEffect(() => {
		nextRefresh()
		walletStateLoad.invalidate()
		deploymentStatusLoad.invalidate()
		environmentReadyLoad.invalidate()
		accountState.value = {
			address: undefined,
			chainId: undefined,
			ethBalanceAttoEth: undefined,
			wethBalanceAttoEth: undefined,
		}
		invalidateDeploymentState()
		clearChainClock()
		walletBootstrapComplete.value = false
		errorMessage.value = undefined
		deploymentStatusError.value = undefined
		ethBalanceAttoEthError.value = undefined
		wethBalanceAttoEthError.value = undefined
		chainClockError.value = undefined
		readBackendMessage.value = undefined
		readBackendValidated.value = false
		environmentBootstrapError.value = undefined
		environmentBootstrapLabel.value = renderedBackend.bootstrapLabel
		environmentBootstrapProgress.value = renderedBackend.bootstrapProgress
		environmentReady.value = renderedBackend.isBootstrapped ?? true
	}, [activeEnvironmentNonce, renderedBackend])

	const refreshState = async (options: RefreshStateOptions = {}) => {
		const shouldLoadChainClock = enableChainClock && (options.loadChainClock ?? true)
		const shouldLoadDeploymentState = options.loadDeploymentState ?? true
		const shouldLoadWalletState = options.loadWalletState ?? true
		const preserveValidatedReadiness = shouldLoadWalletState && options.loadChainClock === false && options.loadDeploymentState === false
		const backend = getActiveBackend()
		updateReadBackendStatus(backend)
		const isCurrent = nextRefresh()
		if (shouldLoadWalletState) walletStateLoad.invalidate()
		if (shouldLoadDeploymentState) deploymentStatusLoad.invalidate()
		let connectedAddress: Address | undefined
		let connectedChainId: string | undefined
		hasInjectedWallet.value = backend.hasWallet()
		errorMessage.value = undefined
		if (shouldLoadDeploymentState) {
			deploymentStatusError.value = undefined
		}
		if (shouldLoadWalletState) {
			ethBalanceAttoEthError.value = undefined
			wethBalanceAttoEthError.value = undefined
		}
		if (shouldLoadChainClock) chainClockError.value = undefined
		if (!preserveValidatedReadiness) {
			readBackendMessage.value = undefined
			readBackendValidated.value = false
		}
		const invalidateWalletDiscoveryState = () => {
			accountState.value = {
				address: undefined,
				chainId: undefined,
				ethBalanceAttoEth: undefined,
				wethBalanceAttoEth: undefined,
			}
			if (shouldLoadDeploymentState) {
				invalidateDeploymentState()
				deploymentStatusError.value = 'Deployment status could not be refreshed because wallet discovery failed.'
			}
			clearChainClock()
		}
		if (shouldLoadWalletState) {
			try {
				const accounts = await backend.getAccounts()
				if (!isCurrent()) return
				connectedAddress = normalizeAccount(accounts[0])
			} catch (error) {
				if (!isCurrent()) return
				invalidateWalletDiscoveryState()
				walletBootstrapComplete.value = true
				errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
				return
			}
		}
		if (connectedAddress !== undefined) {
			try {
				connectedChainId = await backend.getChainId()
				if (!isCurrent()) return
			} catch (error) {
				if (!isCurrent()) return
				invalidateWalletDiscoveryState()
				walletBootstrapComplete.value = true
				errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
				return
			}
		}
		if (connectedChainId !== undefined && supportedNetworkChangeRef.current !== undefined && getPublicNetworkProfileForChainId(connectedChainId) !== undefined && !sameChainId(connectedChainId, backend.profile.chainIdHex)) {
			supportedNetworkChangeRef.current(connectedChainId)
			return
		}
		const walletOnExpectedChain = sameChainId(connectedChainId, backend.profile.chainIdHex)
		backend.setReadTransportMode?.(walletOnExpectedChain ? 'provider' : 'rpc')
		if (!walletOnExpectedChain) {
			clearChainClock()
			try {
				const validation = await validateConfiguredReadBackend(backend)
				if (!isCurrent()) return
				readBackendMessage.value = validation.readBackendMessage
				readBackendValidated.value = validation.validated
				updateReadBackendStatus(backend)
				if (validation.readBackendMessage !== undefined) {
					clearChainClock()
					invalidateDeploymentState()
					deploymentStatusError.value = 'Deployment status could not be refreshed because read RPC validation failed.'
				}
			} catch (error) {
				if (!isCurrent()) return
				invalidateDeploymentState()
				deploymentStatusError.value = 'Deployment status could not be refreshed because read RPC validation failed.'
				readBackendValidated.value = false
				errorMessage.value = getErrorMessage(error, 'Failed to validate the configured read RPC')
			}
		} else {
			readBackendMessage.value = undefined
			readBackendValidated.value = true
			updateReadBackendStatus(backend)
		}
		if (shouldLoadChainClock && isReadBackendReady()) void refreshChainClock(backend)

		if (backend.isBootstrapped === false) {
			invalidateDeploymentState()
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = false
			environmentBootstrapError.value = undefined
		}

		let deploymentStatePromise: Promise<void> | undefined
		if (shouldLoadDeploymentState && backend.isBootstrapped !== false && isReadBackendReady())
			deploymentStatePromise = deploymentStatusLoad.track(async () => {
				try {
					const snapshot = await dependencies.loadDeploymentStatusOracleSnapshot(backend.createReadClient())
					if (!isCurrent()) return
					augurStatoblastDeployed.value = snapshot.augurStatoblastDeployed
					deploymentStatuses.value = snapshot.deploymentStatuses
					deploymentStatusesLoaded.value = true
				} catch (error) {
					if (!isCurrent()) return
					invalidateDeploymentState()
					deploymentStatusError.value = getErrorMessage(error, 'Failed to refresh deployment status')
				}
			})

		if (!shouldLoadWalletState) {
			await deploymentStatePromise
			return
		}

		await walletStateLoad.track(async () => {
			try {
				accountState.value = {
					address: connectedAddress,
					chainId: accountState.value.chainId,
					ethBalanceAttoEth: undefined,
					wethBalanceAttoEth: undefined,
				}

				walletBootstrapComplete.value = true

				if (connectedAddress !== undefined && walletOnExpectedChain) {
					const readClient = createConnectedReadClient()
					const ethBalanceAttoEthPromise = readClient.getBalance({ address: connectedAddress })
					const wethBalanceAttoEthPromise = dependencies.loadErc20Balance(readClient, dependencies.getWethAddress(), connectedAddress)
					void loadWalletState({
						chainIdPromise: Promise.resolve(connectedChainId ?? backend.profile.chainIdHex),
						connectedAddress,
						ethBalanceAttoEthPromise,
						fallbackChainId: backend.profile.chainIdHex,
						getAccountState: () => accountState.value,
						isCurrent,
						setAccountState: state => {
							accountState.value = state
						},
						setErrorMessage: message => {
							errorMessage.value = message
						},
						setEthBalanceErrorMessage: message => {
							ethBalanceAttoEthError.value = message
						},
						setWethBalanceAttoEthErrorMessage: message => {
							wethBalanceAttoEthError.value = message
						},
						trackLoad: walletStateLoad.track,
						wethBalanceAttoEthPromise,
					})
				} else if (connectedAddress !== undefined) {
					accountState.value = { ...accountState.value, chainId: connectedChainId ?? backend.profile.chainIdHex, ethBalanceAttoEth: undefined, wethBalanceAttoEth: undefined }
				} else {
					accountState.value = { ...accountState.value, chainId: backend.profile.chainIdHex, ethBalanceAttoEth: undefined, wethBalanceAttoEth: undefined }
				}
			} catch (error) {
				if (!isCurrent()) return
				walletBootstrapComplete.value = true
				errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
			}
		})
	}

	const connectWallet = async () => {
		const backend = getActiveBackend()
		if (!backend.hasWallet()) {
			errorMessage.value = 'No wallet detected. Install or enable a wallet to continue.'
			return
		}
		if (isConnectingWallet.value) return
		connectWalletGenerationRef.current += 1
		const requestGeneration = connectWalletGenerationRef.current
		const requestContext = { activeEnvironmentNonce, backend }
		const isCurrentAction = () => {
			const currentContext = walletActionContextRef.current
			return requestGeneration === connectWalletGenerationRef.current && requestContext.activeEnvironmentNonce === currentContext.activeEnvironmentNonce && requestContext.backend === currentContext.backend
		}

		try {
			isConnectingWallet.value = true
			errorMessage.value = undefined
			await backend.requestAccounts()
			if (!isCurrentAction()) return
			await refreshState()
		} catch (error) {
			if (!isCurrentAction()) return
			errorMessage.value = getErrorMessage(error, 'Wallet connection failed')
		} finally {
			if (isCurrentAction()) isConnectingWallet.value = false
		}
	}
	const runWalletManagementAction = async (action: (backend: ChainBackend) => Promise<void>, fallbackMessage: string) => {
		if (isManagingWallet.value) return
		const backend = getActiveBackend()
		manageWalletGenerationRef.current += 1
		const requestGeneration = manageWalletGenerationRef.current
		const requestContext = { activeEnvironmentNonce, backend }
		const isCurrentAction = () => {
			const currentContext = walletActionContextRef.current
			return requestGeneration === manageWalletGenerationRef.current && requestContext.activeEnvironmentNonce === currentContext.activeEnvironmentNonce && requestContext.backend === currentContext.backend
		}
		try {
			isManagingWallet.value = true
			errorMessage.value = undefined
			await action(backend)
			if (!isCurrentAction()) return
			await refreshState()
		} catch (error) {
			if (!isCurrentAction()) return
			errorMessage.value = getErrorMessage(error, fallbackMessage)
		} finally {
			if (isCurrentAction()) isManagingWallet.value = false
		}
	}
	const changeWallet = async () =>
		await runWalletManagementAction(async backend => {
			if (backend.requestAccountSelection === undefined) throw new Error('This wallet does not support account switching from the application. Open the wallet and choose another account.')
			await backend.requestAccountSelection()
		}, 'Wallet account change failed')
	const disconnectWallet = async () =>
		await runWalletManagementAction(async backend => {
			if (backend.disconnectWallet === undefined) throw new Error('This wallet does not support disconnecting from the application. Disconnect this site in the wallet.')
			await backend.disconnectWallet()
		}, 'Wallet disconnect failed')
	const switchNetwork = async () =>
		await runWalletManagementAction(async backend => {
			if (backend.switchNetwork === undefined) throw new Error(`This wallet does not support switching networks from the application. Switch to ${getNetworkSwitchTarget(backend.profile)} in the wallet.`)
			await backend.switchNetwork()
		}, 'Network switch failed')

	useEffect(() => {
		void refreshState()
	}, [activeEnvironmentNonce])

	useEffect(() => {
		const backend = getActiveBackend()
		if (backend.waitUntilReady === undefined || backend.isBootstrapped === true) {
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = true
			environmentBootstrapError.value = undefined
			return
		}

		environmentBootstrapLabel.value = backend.bootstrapLabel
		environmentBootstrapProgress.value = backend.bootstrapProgress
		environmentReady.value = false
		environmentBootstrapError.value = undefined
		let cancelled = false
		void environmentReadyLoad.track(async () => {
			try {
				await backend.waitUntilReady?.()
				if (cancelled) return
				environmentBootstrapLabel.value = backend.bootstrapLabel
				environmentBootstrapProgress.value = backend.bootstrapProgress
				environmentReady.value = true
				environmentBootstrapError.value = undefined
				await refreshState()
			} catch (error) {
				if (cancelled) return
				environmentBootstrapError.value = getErrorMessage(error, 'Failed to bootstrap simulation environment')
			}
		})

		return () => {
			cancelled = true
		}
	}, [activeEnvironmentNonce])

	useEffect(() => {
		const backend = getActiveBackend()
		const unsubscribeState = backend.subscribe?.(() => {
			environmentBootstrapError.value = backend.bootstrapError
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = backend.isBootstrapped ?? true
			if (enableChainClock && isReadBackendReady()) void refreshChainClock(backend)
		})
		const handleWalletChange = () => {
			void refreshState()
		}
		const handleChainChange = () => {
			void (async () => {
				try {
					const chainId = await backend.getChainId()
					if (supportedNetworkChangeRef.current !== undefined && getPublicNetworkProfileForChainId(chainId) !== undefined) {
						supportedNetworkChangeRef.current(chainId)
						return
					}
				} catch (error) {
					void error
					// The normal refresh path surfaces wallet discovery failures.
				}
				await refreshState()
			})()
		}
		const unsubscribeAccounts = backend.subscribeAccountsChanged(handleWalletChange)
		const unsubscribeChain = backend.subscribeChainChanged(handleChainChange)

		return () => {
			unsubscribeChain()
			unsubscribeAccounts()
			unsubscribeState?.()
		}
	}, [activeEnvironmentNonce, enableChainClock])

	useEffect(() => {
		if (!enableChainClock) {
			return
		}
		const backend = getActiveBackend()
		if (backend.isBootstrapped === false) return
		if (!isReadBackendReady()) return

		void refreshChainClock(backend)
		const intervalId = window.setInterval(() => {
			if (!isReadBackendReady()) return
			void refreshChainClock(backend)
		}, CHAIN_CLOCK_POLL_INTERVAL_MILLISECONDS)

		return () => {
			window.clearInterval(intervalId)
		}
	}, [activeEnvironmentNonce, enableChainClock, environmentReady.value, readBackendMessage.value, readBackendValidated.value])

	return {
		accountState: accountState.value,
		changeWallet,
		connectWallet,
		chainClockError: chainClockError.value,
		currentBlockNumber: currentBlockNumber.value,
		currentTimestamp: currentTimestamp.value,
		deploymentStatusError: deploymentStatusError.value,
		deploymentStatuses: deploymentStatuses.value,
		errorMessage: errorMessage.value,
		errorMessages: [errorMessage.value, deploymentStatusError.value, ethBalanceAttoEthError.value, wethBalanceAttoEthError.value].filter((message): message is string => message !== undefined),
		readBackendMessage: readBackendMessage.value,
		readBackendValidated: readBackendValidated.value,
		readBackendStatus: readBackendStatus.value,
		environmentBootstrapError: environmentBootstrapError.value,
		environmentBootstrapLabel: environmentBootstrapLabel.value,
		environmentBootstrapProgress: environmentBootstrapProgress.value,
		environmentReady: environmentReady.value,
		isBootstrappingEnvironment: environmentReadyLoad.isLoading.value || getActiveBackend().isBootstrapping === true,
		hasInjectedWallet: hasInjectedWallet.value,
		hasLoadedDeploymentStatuses: deploymentStatusesLoaded.value,
		isConnectingWallet: isConnectingWallet.value,
		isManagingWallet: isManagingWallet.value,
		isLoadingDeploymentStatuses: deploymentStatusLoad.isLoading.value,
		isRefreshing: walletStateLoad.isLoading.value,
		augurStatoblastDeployed: augurStatoblastDeployed.value,
		refreshState,
		setDeploymentStatuses,
		disconnectWallet,
		switchNetwork,
		walletBootstrapComplete: walletBootstrapComplete.value,
	}
}
