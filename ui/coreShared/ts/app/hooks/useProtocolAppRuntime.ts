import { useEnvironmentRevision } from './useEnvironmentRevision.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useRef } from 'preact/hooks'
import { shouldFollowWalletNetwork } from '../../lib/activeEnvironment.js'
import { createSupportedNetworkChangeCoordinator } from '../lib/supportedNetworkChange.js'
import { useTransactionTrayController } from './useTransactionTrayController.js'

type CommitGuard = () => boolean

export function useProtocolAppRuntime({ replaceEnvironment, onEnvironmentCommitted }: { replaceEnvironment(canCommit: CommitGuard): Promise<boolean>; onEnvironmentCommitted?(): void }) {
	const supportedNetworkChangeCoordinatorRef = useRef<ReturnType<typeof createSupportedNetworkChangeCoordinator>>()
	const transactionTray = useTransactionTrayController({ onFinished: () => supportedNetworkChangeCoordinatorRef.current?.handleTransactionFinished() })
	const environment = useEnvironmentRevision(() => transactionTray.resetForEnvironment())

	const supportedNetworkChangeCoordinator =
		supportedNetworkChangeCoordinatorRef.current ??
		createSupportedNetworkChangeCoordinator({
			getInFlightCount: () => transactionTray.transactionState.value.inFlightCount,
			replaceEnvironment: async canCommit => {
				if (!(await replaceEnvironment(canCommit))) return false
				environment.setRevision(currentNonce => currentNonce + 1)
				onEnvironmentCommitted?.()
				return true
			},
		})
	supportedNetworkChangeCoordinatorRef.current = supportedNetworkChangeCoordinator
	return {
		activeEnvironmentNonce: environment.revision.value,
		followSupportedWalletNetwork: shouldFollowWalletNetwork(),
		setActiveEnvironmentNonce: environment.setRevision,
		supportedNetworkChangeCoordinator,
		transactionTray,
	}
}

export function buildProtocolHookConfigs({ accountAddress, walletScopedAccountAddress, refreshState, transactionTray }: { accountAddress: Address | undefined; walletScopedAccountAddress: Address | undefined; refreshState(): Promise<void>; transactionTray: ReturnType<typeof useTransactionTrayController> }) {
	const { onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPrepared, onTransactionPresented, onTransactionRequested, onTransactionSubmitted } = transactionTray
	const baseHookConfig = {
		accountAddress,
		onTransactionCanceled,
		onTransactionFailed,
		onTransactionFinished,
		onTransactionPresented,
		onTransactionPrepared,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
	}
	return {
		baseHookConfig,
		walletScopedHookConfig: { ...baseHookConfig, accountAddress: walletScopedAccountAddress },
	}
}
