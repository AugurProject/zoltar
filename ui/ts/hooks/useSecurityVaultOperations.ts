import { useState } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { approveErc20, depositRepToSecurityPool, loadSecurityVaultDetails, redeemSecurityVaultFees, redeemSecurityVaultRep, updateSecurityVaultFees } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { getDefaultSecurityVaultFormState } from '../lib/marketForm.js'
import type { SecurityVaultFormState } from '../types/app.js'
import type { SecurityVaultActionResult, SecurityVaultDetails } from '../types/contracts.js'

type UseSecurityVaultOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityVaultOperations({ accountAddress, onTransaction, refreshState }: UseSecurityVaultOperationsParameters) {
	const [loadingSecurityVault, setLoadingSecurityVault] = useState(false)
	const [securityVaultDetails, setSecurityVaultDetails] = useState<SecurityVaultDetails | undefined>(undefined)
	const [securityVaultError, setSecurityVaultError] = useState<string | undefined>(undefined)
	const [securityVaultForm, setSecurityVaultForm] = useState<SecurityVaultFormState>(() => getDefaultSecurityVaultFormState())
	const [securityVaultResult, setSecurityVaultResult] = useState<SecurityVaultActionResult | undefined>(undefined)

	const loadSecurityVault = async () => {
		if (accountAddress === undefined) {
			setSecurityVaultError('Connect a wallet before loading a security vault')
			return
		}

		setLoadingSecurityVault(true)
		setSecurityVaultError(undefined)
		try {
			const securityPoolAddress = parseAddressInput(securityVaultForm.securityPoolAddress, 'Security pool address')
			const details = await loadSecurityVaultDetails(createReadClient(), securityPoolAddress, accountAddress)
			setSecurityVaultDetails(details)
		} catch (error) {
			setSecurityVaultDetails(undefined)
			setSecurityVaultError(getErrorMessage(error, 'Failed to load security vault'))
		} finally {
			setLoadingSecurityVault(false)
		}
	}

	const runVaultAction = async (action: (ethereumAddress: Address, securityPoolAddress: Address) => Promise<SecurityVaultActionResult>, errorFallback: string) => {
		const ethereum = getRequiredInjectedEthereum()
		if (ethereum === undefined) {
			setSecurityVaultError('No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSecurityVaultError('Connect a wallet before operating a security vault')
			return
		}

		try {
			const securityPoolAddress = parseAddressInput(securityVaultForm.securityPoolAddress, 'Security pool address')
			setSecurityVaultError(undefined)
			setSecurityVaultResult(undefined)
			const result = await action(accountAddress, securityPoolAddress)
			setSecurityVaultResult(result)
			onTransaction(result.hash)
			const details = await loadSecurityVaultDetails(createReadClient(), securityPoolAddress, accountAddress)
			setSecurityVaultDetails(details)
			await refreshState()
		} catch (error) {
			setSecurityVaultError(getErrorMessage(error, errorFallback))
		}
	}

	const approveRep = async () =>
		await runVaultAction(async (vaultAddress, securityPoolAddress) => {
			const details = securityVaultDetails ?? (await loadSecurityVaultDetails(createReadClient(), securityPoolAddress, vaultAddress))
			return await approveErc20(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), details.repToken, securityPoolAddress, parseBigIntInput(securityVaultForm.repApprovalAmount, 'REP approval amount'), 'approveRep')
		}, 'Failed to approve REP')

	const depositRep = async () => await runVaultAction(async (vaultAddress, securityPoolAddress) => await depositRepToSecurityPool(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), securityPoolAddress, parseBigIntInput(securityVaultForm.depositAmount, 'REP deposit amount')), 'Failed to deposit REP')

	const updateVaultFees = async () => await runVaultAction(async (vaultAddress, securityPoolAddress) => await updateSecurityVaultFees(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), securityPoolAddress, vaultAddress), 'Failed to update vault fees')

	const redeemFees = async () => await runVaultAction(async (vaultAddress, securityPoolAddress) => await redeemSecurityVaultFees(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), securityPoolAddress, vaultAddress), 'Failed to redeem fees')

	const redeemRep = async () => await runVaultAction(async (vaultAddress, securityPoolAddress) => await redeemSecurityVaultRep(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), securityPoolAddress, vaultAddress), 'Failed to redeem REP')

	return {
		approveRep,
		depositRep,
		loadSecurityVault,
		loadingSecurityVault,
		redeemFees,
		redeemRep,
		securityVaultDetails,
		securityVaultError,
		securityVaultForm,
		securityVaultResult,
		setSecurityVaultForm,
		updateVaultFees,
	}
}
