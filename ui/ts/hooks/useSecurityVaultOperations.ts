import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { approveErc20, depositRepToSecurityPool, loadSecurityVaultDetails, redeemSecurityVaultFees, redeemSecurityVaultRep, updateSecurityVaultFees } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { getDefaultSecurityVaultFormState } from '../lib/marketForm.js'
import { setSignalValue, updateSignalValue } from '../lib/signals.js'
import type { SecurityVaultFormState } from '../types/app.js'
import type { SecurityVaultActionResult, SecurityVaultDetails } from '../types/contracts.js'

type UseSecurityVaultOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityVaultOperations({ accountAddress, onTransaction, refreshState }: UseSecurityVaultOperationsParameters) {
	const loadingSecurityVault = useSignal(false)
	const securityVaultDetails = useSignal<SecurityVaultDetails | undefined>(undefined)
	const securityVaultError = useSignal<string | undefined>(undefined)
	const securityVaultForm = useSignal<SecurityVaultFormState>(getDefaultSecurityVaultFormState())
	const securityVaultResult = useSignal<SecurityVaultActionResult | undefined>(undefined)

	const loadSecurityVault = async () => {
		if (accountAddress === undefined) {
			setSignalValue(securityVaultError, 'Connect a wallet before loading a security vault')
			return
		}

		setSignalValue(loadingSecurityVault, true)
		setSignalValue(securityVaultError, undefined)
		try {
			const securityPoolAddress = parseAddressInput(securityVaultForm.value.securityPoolAddress, 'Security pool address')
			const details = await loadSecurityVaultDetails(createReadClient(), securityPoolAddress, accountAddress)
			setSignalValue(securityVaultDetails, details)
		} catch (error) {
			setSignalValue(securityVaultDetails, undefined)
			setSignalValue(securityVaultError, getErrorMessage(error, 'Failed to load security vault'))
		} finally {
			setSignalValue(loadingSecurityVault, false)
		}
	}

	const runVaultAction = async (action: (ethereumAddress: Address, securityPoolAddress: Address) => Promise<SecurityVaultActionResult>, errorFallback: string) => {
		const ethereum = getRequiredInjectedEthereum()
		if (ethereum === undefined) {
			setSignalValue(securityVaultError, 'No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSignalValue(securityVaultError, 'Connect a wallet before operating a security vault')
			return
		}

		try {
			const securityPoolAddress = parseAddressInput(securityVaultForm.value.securityPoolAddress, 'Security pool address')
			setSignalValue(securityVaultError, undefined)
			setSignalValue(securityVaultResult, undefined)
			const result = await action(accountAddress, securityPoolAddress)
			setSignalValue(securityVaultResult, result)
			onTransaction(result.hash)
			const details = await loadSecurityVaultDetails(createReadClient(), securityPoolAddress, accountAddress)
			setSignalValue(securityVaultDetails, details)
			await refreshState()
		} catch (error) {
			setSignalValue(securityVaultError, getErrorMessage(error, errorFallback))
		}
	}

	const approveRep = async () =>
		await runVaultAction(async (vaultAddress, securityPoolAddress) => {
			const details = securityVaultDetails.value ?? (await loadSecurityVaultDetails(createReadClient(), securityPoolAddress, vaultAddress))
			return await approveErc20(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), details.repToken, securityPoolAddress, parseBigIntInput(securityVaultForm.value.repApprovalAmount, 'REP approval amount'), 'approveRep')
		}, 'Failed to approve REP')

	const depositRep = async () => await runVaultAction(async (vaultAddress, securityPoolAddress) => await depositRepToSecurityPool(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), securityPoolAddress, parseBigIntInput(securityVaultForm.value.depositAmount, 'REP deposit amount')), 'Failed to deposit REP')

	const updateVaultFees = async () => await runVaultAction(async (vaultAddress, securityPoolAddress) => await updateSecurityVaultFees(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), securityPoolAddress, vaultAddress), 'Failed to update vault fees')

	const redeemFees = async () => await runVaultAction(async (vaultAddress, securityPoolAddress) => await redeemSecurityVaultFees(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), securityPoolAddress, vaultAddress), 'Failed to redeem fees')

	const redeemRep = async () => await runVaultAction(async (vaultAddress, securityPoolAddress) => await redeemSecurityVaultRep(createWriteClient(getRequiredInjectedEthereum(), vaultAddress), securityPoolAddress, vaultAddress), 'Failed to redeem REP')

	return {
		approveRep,
		depositRep,
		loadSecurityVault,
		loadingSecurityVault: loadingSecurityVault.value,
		redeemFees,
		redeemRep,
		securityVaultDetails: securityVaultDetails.value,
		securityVaultError: securityVaultError.value,
		securityVaultForm: securityVaultForm.value,
		securityVaultResult: securityVaultResult.value,
		setSecurityVaultForm: (updater: (current: SecurityVaultFormState) => SecurityVaultFormState) => {
			updateSignalValue(securityVaultForm, updater)
		},
		updateVaultFees,
	}
}
