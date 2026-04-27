import type { Address } from 'viem'
import { formatCurrencyBalance } from './formatters.js'
import type { SecurityPoolSystemState } from '../types/contracts.js'

export function getRemainingMintCapacity(totalSecurityBondAllowance: bigint | undefined, completeSetCollateralAmount: bigint | undefined) {
	if (totalSecurityBondAllowance === undefined || completeSetCollateralAmount === undefined) return undefined
	return totalSecurityBondAllowance > completeSetCollateralAmount ? totalSecurityBondAllowance - completeSetCollateralAmount : 0n
}

export function getTradingMintGuardMessage({
	accountAddress,
	completeSetCollateralAmount,
	ethBalance,
	isMainnet,
	mintAmountInput,
	systemState,
	totalSecurityBondAllowance,
}: {
	accountAddress: Address | undefined
	completeSetCollateralAmount: bigint | undefined
	ethBalance: bigint | undefined
	isMainnet: boolean
	mintAmountInput: string
	systemState: SecurityPoolSystemState | undefined
	totalSecurityBondAllowance: bigint | undefined
}) {
	if (accountAddress === undefined) return 'Connect a wallet before minting complete sets.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before minting complete sets.'
	if (systemState !== undefined && systemState !== 'operational') return 'Minting is only available while the pool is operational.'

	const remainingCapacity = getRemainingMintCapacity(totalSecurityBondAllowance, completeSetCollateralAmount)
	if (remainingCapacity === undefined) return 'Loading pool mint capacity.'
	if (remainingCapacity === 0n) return 'This pool has no remaining mint capacity.'

	const trimmedAmount = mintAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a mint amount greater than zero.'

	let mintAmount: bigint
	try {
		mintAmount = BigInt(trimmedAmount)
	} catch {
		return 'Enter a valid whole-number mint amount.'
	}

	if (mintAmount <= 0n) return 'Enter a mint amount greater than zero.'
	if (mintAmount > remainingCapacity) return `This pool only has ${formatCurrencyBalance(remainingCapacity)} ETH of mint capacity remaining.`
	if (ethBalance === undefined) return 'Loading wallet ETH balance.'
	if (mintAmount > ethBalance) return `Need ${formatCurrencyBalance(mintAmount - ethBalance)} more ETH in this wallet to mint the selected amount.`
	return undefined
}
