import type { Address } from '@zoltar/shared/ethereum'
import { useEffect, useId, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import { watchActiveWalletAsset, type WalletAssetWatchResult } from '../lib/walletAsset.js'
import { AddressValue } from './AddressValue.js'
import { LoadingText } from './LoadingText.js'

type WalletAssetControlProps = {
	address: Address
	isSupportedChain: boolean
	onWatchAsset?: ((address: Address) => Promise<WalletAssetWatchResult>) | undefined
	tokenLabel: string
}

type WalletAssetControlState = { status: 'accepted' } | { message: string; status: 'error' } | { status: 'idle' } | { status: 'pending' }

function getErrorMessage(result: WalletAssetWatchResult) {
	if (result.status === 'wrong-network') return commonCopy.mainnetRequiredReason
	if (result.status === 'unsupported') return commonCopy.walletAssetAutomaticImportUnavailable
	if (result.status === 'unavailable') return commonCopy.walletAssetUnavailable
	if (result.status === 'failed') return commonCopy.walletAssetRequestFailed
	return undefined
}

export function WalletAssetControl({ address, isSupportedChain, onWatchAsset = watchActiveWalletAsset, tokenLabel }: WalletAssetControlProps) {
	const [state, setState] = useState<WalletAssetControlState>({ status: 'idle' })
	const networkRequirementId = useId()
	const backend = getActiveBackend()
	const walletImportAvailable = backend.id === 'injected' && backend.hasWallet() && backend.getProvider() !== undefined

	useEffect(() => {
		setState({ status: 'idle' })
	}, [address])

	if (!walletImportAvailable) return <AddressValue address={address} />

	const handleWatchAsset = async () => {
		if (state.status === 'pending' || state.status === 'accepted' || !isSupportedChain) return
		setState({ status: 'pending' })
		let result: WalletAssetWatchResult
		try {
			result = await onWatchAsset(address)
		} catch (error) {
			if (error instanceof Error) result = { status: 'failed' }
			else throw error
		}
		if (result.status === 'accepted') {
			setState({ status: 'accepted' })
			return
		}
		const errorMessage = getErrorMessage(result)
		setState(errorMessage === undefined ? { status: 'idle' } : { message: errorMessage, status: 'error' })
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

	return (
		<span className='wallet-asset-control'>
			<AddressValue address={address} />
			<button aria-describedby={isSupportedChain ? undefined : networkRequirementId} aria-label={accessibleActionLabel} className='quiet wallet-asset-action' disabled={!isSupportedChain || state.status === 'pending' || state.status === 'accepted'} onClick={() => void handleWatchAsset()} type='button'>
				{state.status === 'pending' ? <LoadingText>{commonCopy.openingWallet}</LoadingText> : actionLabel}
			</button>
			{isSupportedChain ? undefined : (
				<span className='wallet-asset-prerequisite' id={networkRequirementId}>
					{commonCopy.mainnetRequiredReason}
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
