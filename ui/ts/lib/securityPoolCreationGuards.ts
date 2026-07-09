import type { Address } from '@zoltar/shared/ethereum'
import type { MarketDetails } from '../types/contracts.js'
import { getWalletMainnetGuardState } from './actionGuards.js'

export function getSecurityPoolCreateDisabledReason({
	accountAddress,
	checkingDuplicateOriginPool,
	duplicateOriginPoolExists,
	isMainnet,
	marketDetails,
	securityPoolCreating,
	zoltarUniverseHasForked,
}: {
	accountAddress: Address | undefined
	checkingDuplicateOriginPool: boolean
	duplicateOriginPoolExists: boolean
	isMainnet: boolean
	marketDetails: MarketDetails | undefined
	securityPoolCreating: boolean
	zoltarUniverseHasForked: boolean
}) {
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason: 'Connect a wallet before creating a security pool.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (checkingDuplicateOriginPool) return 'Checking whether a pool already exists for this question and security multiplier.'
	if (securityPoolCreating) return 'Security pool creation is already in progress.'
	if (duplicateOriginPoolExists) return 'A pool for this question and security multiplier already exists.'
	if (marketDetails === undefined) return 'Enter an exact binary Yes / No question before creating a pool.'
	if (marketDetails.marketType !== 'binary') return 'Security pools can only be created for exact binary Yes / No questions.'
	if (zoltarUniverseHasForked) return 'Security pools cannot be created after Zoltar has forked.'
	return undefined
}
