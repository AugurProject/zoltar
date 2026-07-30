import type { Address } from '@zoltar/shared/ethereum'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { normalizeWalletAssetFailure, watchActiveWalletAsset, type WalletAssetWatchResult } from '../lib/walletAsset.js'
import { AddressValue } from './AddressValue.js'
import { LoadingText } from './LoadingText.js'
import { getWrongNetworkMessage } from '../lib/network.js'

type WalletAssetControlProps = {
	accountAddress: Address | undefined
	address: Address
	isSupportedChain: boolean
	onWatchAsset?: ((address: Address, accountAddress: Address, isCurrent: () => boolean) => Promise<WalletAssetWatchResult>) | undefined
	tokenLabel: string
}

type WalletAssetControlStatus = { status: 'accepted' } | { message: string; status: 'error' } | { status: 'idle' } | { status: 'pending' }
type WalletAssetControlState = WalletAssetControlStatus & { scopeGeneration: number }

function getErrorMessage(result: WalletAssetWatchResult) {
	if (result.status === 'wrong-network') return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason
	if (result.status === 'unsupported') return commonCopy.walletAssetAutomaticImportUnavailable
	if (result.status === 'unavailable') return commonCopy.walletAssetUnavailable
	if (result.status === 'failed') return commonCopy.walletAssetRequestFailed
	return undefined
}

export function WalletAssetControl({ accountAddress, address, isSupportedChain, onWatchAsset = watchActiveWalletAsset, tokenLabel }: WalletAssetControlProps) {
	const currentScope = useRef({ accountAddress, address, generation: 0, isSupportedChain })
	if (currentScope.current.accountAddress !== accountAddress || currentScope.current.address !== address || currentScope.current.isSupportedChain !== isSupportedChain) currentScope.current = { accountAddress, address, generation: currentScope.current.generation + 1, isSupportedChain }
	const scopeGeneration = currentScope.current.generation
	const [storedState, setState] = useState<WalletAssetControlState>({ scopeGeneration, status: 'idle' })
	const state: WalletAssetControlStatus = storedState.scopeGeneration === scopeGeneration ? storedState : { status: 'idle' }
	const networkRequirementId = useId()
	const backend = getActiveBackend()
	const walletImportAvailable = accountAddress !== undefined && backend.id === 'injected' && backend.hasWallet() && backend.getProvider() !== undefined
	const nextWatchAssetRequest = useRequestGuard()

	useEffect(
		() => () => {
			nextWatchAssetRequest()
		},
		[nextWatchAssetRequest],
	)

	if (!walletImportAvailable) return <AddressValue address={address} />

	const handleWatchAsset = async () => {
		if (state.status === 'pending' || state.status === 'accepted' || !isSupportedChain) return
		const isCurrent = nextWatchAssetRequest()
		const isCurrentScope = () => isCurrent() && currentScope.current.generation === scopeGeneration
		setState({ scopeGeneration, status: 'pending' })
		let result: WalletAssetWatchResult
		try {
			result = await onWatchAsset(address, accountAddress, isCurrentScope)
		} catch (error) {
			result = normalizeWalletAssetFailure(error)
		}
		if (!isCurrentScope()) return
		if (result.status === 'accepted') {
			setState({ scopeGeneration, status: 'accepted' })
			return
		}
		const errorMessage = getErrorMessage(result)
		setState(errorMessage === undefined ? { scopeGeneration, status: 'idle' } : { message: errorMessage, scopeGeneration, status: 'error' })
	}

	const actionLabel = (() => {
		if (state.status === 'accepted') return commonCopy.walletAssetRequestAccepted
		if (state.status === 'error') return commonCopy.retry
		return commonCopy.addToWallet
	})()
	const accessibleActionLabel = (() => {
		if (state.status === 'accepted') return commonCopy.formatWalletAssetRequestAccepted(tokenLabel)
		if (state.status === 'pending') return commonCopy.formatOpeningWalletForToken(tokenLabel)
		if (state.status === 'error') return commonCopy.formatRetryWalletAssetRequest(tokenLabel)
		return commonCopy.formatAddTokenToWallet(tokenLabel)
	})()
	const actionIcon = (() => {
		if (state.status === 'accepted') return '✓'
		if (state.status === 'error') return '↻'
		return '+'
	})()

	return (
		<span className='wallet-asset-control'>
			<AddressValue address={address} />
			<button
				aria-describedby={isSupportedChain ? undefined : networkRequirementId}
				aria-label={accessibleActionLabel}
				className={`wallet-asset-action wallet-asset-action-${state.status}`}
				disabled={!isSupportedChain || state.status === 'pending' || state.status === 'accepted'}
				onClick={() => void handleWatchAsset()}
				type='button'
			>
				{state.status === 'pending' ? (
					<LoadingText>{commonCopy.openingWallet}</LoadingText>
				) : (
					<>
						<span aria-hidden='true' className='wallet-asset-action-icon'>
							{actionIcon}
						</span>
						<span>{actionLabel}</span>
					</>
				)}
			</button>
			{isSupportedChain ? undefined : (
				<span className='wallet-asset-prerequisite' id={networkRequirementId}>
					{getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason}
				</span>
			)}
			{state.status === 'accepted' ? (
				<span aria-live='polite' className='visually-hidden' role='status'>
					{commonCopy.formatWalletAssetRequestAccepted(tokenLabel)}
				</span>
			) : undefined}
			{state.status === 'error' ? (
				<span aria-live='assertive' className='wallet-asset-feedback' role='alert'>
					{state.message}
				</span>
			) : undefined}
		</span>
	)
}
