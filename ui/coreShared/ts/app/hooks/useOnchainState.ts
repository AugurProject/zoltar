import { useOnchainClock } from './useOnchainClock.js'
import { useOnchainWalletActions } from './useOnchainWalletActions.js'
import { readOperationClient, runReadOperation } from '../../lib/readOperation.js'
import { batch, useComputed, useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient, normalizeAccount } from '../../wallet/clients.js'
import type { ChainBackend, ReadBackendIssue, ReadBackendStatus } from '../../wallet/chainBackend.js'
import { getErrorMessage } from '../../lib/errors.js'
import { sameAddress } from '../../lib/address.js'
import { getActiveBackend } from '../../lib/activeEnvironment.js'

import { getPublicNetworkProfileForChainId } from '../../wallet/networkProfile.js'
import { useRequestGuard } from '../../lib/requestGuard.js'
import type { AccountState, RefreshStateOptions } from '../../types/app.js'
import type { DeploymentStatus, DeploymentStep, ReadClient } from '../../types/contracts.js'
import { useLoadController } from '../../hooks/useLoadController.js'
import { sameChainId } from '../../wallet/chainId.js'
import { type ChainClock, getReadBackendStatus, validateConfiguredReadBackend } from './readBackendValidation.js'
import { loadWalletState } from './loadWalletState.js'
import { useReadBackendRecovery, useWalletBalanceRefresh } from './onchainStateRecovery.js'

export type UseOnchainStateOptions = {
	activeEnvironmentNonce?: number
	enableChainClock?: boolean
	onSupportedNetworkChange?: (chainId: string) => void
}

export type UseOnchainStateDependencies = {
	getDeploymentSteps: () => ReadonlyArray<DeploymentStep>
	getWethAddress?: () => Address
	loadDeploymentStatusOracleSnapshot: (readClient: ReadClient) => Promise<{ applicationDeploymentComplete: boolean; deploymentStatuses: DeploymentStatus[] }>
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
	const applicationDeploymentComplete = useSignal<boolean | undefined>(undefined)
	const environmentBootstrapError = useSignal<string | undefined>(undefined)
	const environmentBootstrapLabel = useSignal(getActiveBackend().bootstrapLabel)
	const environmentBootstrapProgress = useSignal(getActiveBackend().bootstrapProgress)
	const environmentReady = useSignal(getActiveBackend().isBootstrapped ?? true)
	const environmentReadyLoad = useLoadController()
	const walletBootstrapComplete = useSignal(false)
	const nextRefresh = useRequestGuard()
	// Bumped by every full refresh, so a background balance read that started earlier never overwrites newer balances.
	const balanceReadGenerationRef = useRef(0)
	const renderedBackend = getActiveBackend()
	const supportedNetworkChangeRef = useRef(onSupportedNetworkChange)
	supportedNetworkChangeRef.current = onSupportedNetworkChange
	const errorMessage = useSignal<string | undefined>(undefined)
	const deploymentStatusError = useSignal<string | undefined>(undefined)
	const ethBalanceAttoEthError = useSignal<string | undefined>(undefined)
	const wethBalanceAttoEthError = useSignal<string | undefined>(undefined)
	const readBackendMessage = useSignal<string | undefined>(undefined)
	const readBackendValidated = useSignal(false)
	const readBackendStatus = useSignal<ReadBackendStatus>(getReadBackendStatus(getActiveBackend()))
	const errorMessages = useComputed(() => [errorMessage.value, deploymentStatusError.value, ethBalanceAttoEthError.value, wethBalanceAttoEthError.value].filter((message): message is string => message !== undefined))
	const updateReadBackendStatus = (backend: ChainBackend, block?: ChainClock, issue?: ReadBackendIssue) => {
		backend.setReadBackendBlock?.({
			number: block?.currentBlockNumber,
			timestamp: block?.currentTimestamp,
		})
		readBackendStatus.value = { ...getReadBackendStatus(backend), issue: issue ?? (readBackendMessage.value === undefined ? undefined : readBackendStatus.value.issue) }
	}
	const isReadBackendReady = () => readBackendValidated.value && readBackendMessage.value === undefined
	const chainClock = useOnchainClock({ activeEnvironmentNonce, enableChainClock, environmentReady: environmentReady.value, readBackendMessage: readBackendMessage.value, readBackendValidated: readBackendValidated.value, isReadBackendReady, updateReadBackendStatus })
	const { clearChainClock, refreshChainClock } = chainClock
	const setDeploymentStatuses = (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => {
		const updated = update(deploymentStatuses.value)
		deploymentStatuses.value = updated
		if (updated.every(step => step.deployed)) applicationDeploymentComplete.value = true
	}
	const invalidateDeploymentState = () => {
		batch(() => {
			deploymentStatuses.value = dependencies.getDeploymentSteps().map(step => ({
				...step,
				deployed: false,
			}))
			deploymentStatusesLoaded.value = false
			applicationDeploymentComplete.value = undefined
		})
	}

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
		batch(() => {
			walletBootstrapComplete.value = false
			errorMessage.value = undefined
			deploymentStatusError.value = undefined
			ethBalanceAttoEthError.value = undefined
			wethBalanceAttoEthError.value = undefined
			chainClock.clearError()
			readBackendMessage.value = undefined
			readBackendValidated.value = false
			environmentBootstrapError.value = undefined
			environmentBootstrapLabel.value = renderedBackend.bootstrapLabel
			environmentBootstrapProgress.value = renderedBackend.bootstrapProgress
			environmentReady.value = renderedBackend.isBootstrapped ?? true
		})
	}, [activeEnvironmentNonce, renderedBackend])

	const refreshState = async (options: RefreshStateOptions = {}) => {
		const shouldLoadChainClock = enableChainClock && (options.loadChainClock ?? true)
		const shouldLoadDeploymentState = options.loadDeploymentState ?? true
		const shouldLoadWalletState = options.loadWalletState ?? true
		const preserveValidatedReadiness = shouldLoadWalletState && options.loadChainClock === false && options.loadDeploymentState === false
		const backend = getActiveBackend()
		updateReadBackendStatus(backend)
		const isCurrent = nextRefresh()
		balanceReadGenerationRef.current += 1
		if (shouldLoadWalletState) walletStateLoad.invalidate()
		if (shouldLoadDeploymentState) deploymentStatusLoad.invalidate()
		let connectedAddress: Address | undefined
		let connectedChainId: string | undefined
		batch(() => {
			hasInjectedWallet.value = backend.hasWallet()
			errorMessage.value = undefined
		})
		if (shouldLoadDeploymentState) {
			deploymentStatusError.value = undefined
		}
		if (shouldLoadWalletState) {
			batch(() => {
				ethBalanceAttoEthError.value = undefined
				wethBalanceAttoEthError.value = undefined
			})
		}
		if (shouldLoadChainClock) chainClock.clearError()
		if (!preserveValidatedReadiness) {
			batch(() => {
				readBackendMessage.value = undefined
				readBackendValidated.value = false
			})
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
		// Provider reads need a current wallet network even when the refresh skips wallet balances and displayed state.
		try {
			const accounts = await backend.getAccounts()
			if (!isCurrent()) return
			connectedAddress = normalizeAccount(accounts[0])
			if (connectedAddress !== undefined) {
				connectedChainId = await backend.getChainId()
				if (!isCurrent()) return
			}
		} catch (error) {
			if (!isCurrent()) return
			if (shouldLoadWalletState) {
				invalidateWalletDiscoveryState()
				batch(() => {
					walletBootstrapComplete.value = true
					errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
				})
				return
			}
			connectedAddress = undefined
			connectedChainId = undefined
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
				batch(() => {
					readBackendMessage.value = validation.readBackendMessage
					readBackendValidated.value = validation.validated
				})
				updateReadBackendStatus(backend, undefined, validation.readBackendIssue)
				if (validation.readBackendMessage !== undefined) {
					clearChainClock()
					invalidateDeploymentState()
					deploymentStatusError.value = 'Deployment status could not be refreshed because read RPC validation failed.'
				}
			} catch (error) {
				if (!isCurrent()) return
				invalidateDeploymentState()
				// An unreachable read RPC blocks content like any other untrusted read RPC: the notice explains it and the hook retries.
				batch(() => {
					deploymentStatusError.value = 'Deployment status could not be refreshed because read RPC validation failed.'
					readBackendValidated.value = false
					readBackendMessage.value = getErrorMessage(error, 'Failed to validate the configured read RPC')
				})
				updateReadBackendStatus(backend, undefined, 'unreachable')
			}
		} else {
			batch(() => {
				readBackendMessage.value = undefined
				readBackendValidated.value = true
			})
			updateReadBackendStatus(backend)
		}
		if (shouldLoadChainClock && isReadBackendReady()) void refreshChainClock(backend)

		if (backend.isBootstrapped === false) {
			invalidateDeploymentState()
			batch(() => {
				environmentBootstrapLabel.value = backend.bootstrapLabel
				environmentBootstrapProgress.value = backend.bootstrapProgress
				environmentReady.value = false
				environmentBootstrapError.value = undefined
			})
		}

		let deploymentStatePromise: Promise<void> | undefined
		if (shouldLoadDeploymentState && backend.isBootstrapped !== false && isReadBackendReady())
			deploymentStatePromise = deploymentStatusLoad.track(async () => {
				try {
					const snapshot = await runReadOperation(async operation => await dependencies.loadDeploymentStatusOracleSnapshot(readOperationClient(backend.createReadClient(), operation)), { isCurrent })
					if (!isCurrent()) return
					batch(() => {
						applicationDeploymentComplete.value = snapshot.applicationDeploymentComplete
						deploymentStatuses.value = snapshot.deploymentStatuses
						deploymentStatusesLoaded.value = true
					})
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
				batch(() => {
					// The same account on the same network keeps its last balances while they reload, so balance-based reasons do not flip to loading.
					const previous = accountState.value
					const keepBalances = connectedAddress !== undefined && walletOnExpectedChain && sameAddress(previous.address, connectedAddress) && sameChainId(previous.chainId, connectedChainId)
					accountState.value = {
						address: connectedAddress,
						chainId: previous.chainId,
						ethBalanceAttoEth: keepBalances ? previous.ethBalanceAttoEth : undefined,
						wethBalanceAttoEth: keepBalances ? previous.wethBalanceAttoEth : undefined,
					}

					walletBootstrapComplete.value = true
				})

				if (connectedAddress !== undefined && walletOnExpectedChain) {
					const readClient = createConnectedReadClient()
					const ethBalanceAttoEthPromise = readClient.getBalance({ address: connectedAddress })
					const wethBalanceAttoEthPromise = dependencies.getWethAddress === undefined ? undefined : dependencies.loadErc20Balance(readClient, dependencies.getWethAddress(), connectedAddress)
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
				batch(() => {
					walletBootstrapComplete.value = true
					errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
				})
			}
		})
	}

	const { connectWallet, changeWallet, disconnectWallet, dismissWalletActionMessage, switchNetwork, isConnectingWallet, isManagingWallet, walletActionMessage } = useOnchainWalletActions({
		activeEnvironmentNonce,
		refreshState,
	})

	useEffect(() => {
		void refreshState()
	}, [activeEnvironmentNonce])

	// A wallet extension can inject its provider after the page loads, which would otherwise leave Connect disabled until a
	// reload. Recheck when a wallet announces itself (MetaMask's `ethereum#initialized`, EIP-6963) or the page regains focus.
	const walletMissing = !hasInjectedWallet.value
	useEffect(() => {
		if (!walletMissing) return
		const recheck = () => {
			if (!getActiveBackend().hasWallet()) return
			hasInjectedWallet.value = true
			// The new provider may already hold an authorized account.
			void refreshState()
		}
		const windowEvents = ['ethereum#initialized', 'eip6963:announceProvider', 'focus']
		for (const event of windowEvents) window.addEventListener(event, recheck)
		document.addEventListener('visibilitychange', recheck)
		return () => {
			for (const event of windowEvents) window.removeEventListener(event, recheck)
			document.removeEventListener('visibilitychange', recheck)
		}
	}, [walletMissing])

	useEffect(() => {
		const backend = getActiveBackend()
		if (backend.waitUntilReady === undefined || backend.isBootstrapped === true) {
			batch(() => {
				environmentBootstrapLabel.value = backend.bootstrapLabel
				environmentBootstrapProgress.value = backend.bootstrapProgress
				environmentReady.value = true
				environmentBootstrapError.value = undefined
			})
			return
		}

		batch(() => {
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = false
			environmentBootstrapError.value = undefined
		})
		let cancelled = false
		void environmentReadyLoad.track(async () => {
			try {
				await backend.waitUntilReady?.()
				if (cancelled) return
				batch(() => {
					environmentBootstrapLabel.value = backend.bootstrapLabel
					environmentBootstrapProgress.value = backend.bootstrapProgress
					environmentReady.value = true
					environmentBootstrapError.value = undefined
				})
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

	// Wallet and backend subscriptions; a provider injected after the page loaded is subscribed once it appears.
	useEffect(() => {
		const backend = getActiveBackend()
		const unsubscribeState = backend.subscribe?.(() => {
			batch(() => {
				environmentBootstrapError.value = backend.bootstrapError
				environmentBootstrapLabel.value = backend.bootstrapLabel
				environmentBootstrapProgress.value = backend.bootstrapProgress
				environmentReady.value = backend.isBootstrapped ?? true
			})
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
	}, [activeEnvironmentNonce, enableChainClock, walletMissing])

	useWalletBalanceRefresh({ accountState, activeEnvironmentNonce, balanceErrors: { eth: ethBalanceAttoEthError, weth: wethBalanceAttoEthError }, balanceReadGeneration: balanceReadGenerationRef, dependencies, walletStateLoad })
	useReadBackendRecovery({
		activeEnvironmentNonce,
		onProbeFailed: error => {
			readBackendMessage.value = getErrorMessage(error, 'Failed to validate the configured read RPC')
		},
		refreshState: () => refreshState(),
		unreachable: readBackendStatus.value.issue === 'unreachable',
	})

	const isBootstrappingEnvironment = useComputed(() => environmentReadyLoad.isLoading.value || getActiveBackend().isBootstrapping === true)
	// Signals stay inside the hook; consumers receive the values read during this render.
	return {
		isBootstrappingEnvironment: isBootstrappingEnvironment.value,
		accountState: accountState.value,
		chainClockError: chainClock.chainClockError,
		currentBlockNumber: chainClock.currentBlockNumber,
		currentTimestamp: chainClock.currentTimestamp,
		deploymentStatusError: deploymentStatusError.value,
		deploymentStatuses: deploymentStatuses.value,
		errorMessage: errorMessage.value,
		errorMessages: errorMessages.value,
		readBackendMessage: readBackendMessage.value,
		readBackendValidated: readBackendValidated.value,
		readBackendStatus: readBackendStatus.value,
		environmentBootstrapError: environmentBootstrapError.value,
		environmentBootstrapLabel: environmentBootstrapLabel.value,
		environmentBootstrapProgress: environmentBootstrapProgress.value,
		environmentReady: environmentReady.value,
		hasInjectedWallet: hasInjectedWallet.value,
		hasLoadedDeploymentStatuses: deploymentStatusesLoaded.value,
		isConnectingWallet: isConnectingWallet,
		isManagingWallet: isManagingWallet,
		isLoadingDeploymentStatuses: deploymentStatusLoad.isLoading.value,
		isRefreshing: walletStateLoad.isLoading.value,
		applicationDeploymentComplete: applicationDeploymentComplete.value,
		walletActionMessage,
		walletBootstrapComplete: walletBootstrapComplete.value,
		changeWallet,
		connectWallet,
		dismissWalletActionMessage,
		refreshState,
		/** Validates the read RPC again now, for a notice's retry action. */
		retryReadBackend: () => refreshState(),
		setDeploymentStatuses,
		disconnectWallet,
		switchNetwork,
	}
}
