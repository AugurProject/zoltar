import type { Address } from 'viem'
import type { MarketDetails } from '../types/contracts.js'

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
	if (accountAddress === undefined) return 'Connect a wallet before creating a security pool.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before creating a security pool.'
	if (checkingDuplicateOriginPool) return 'Checking whether a pool already exists for this question and security multiplier.'
	if (securityPoolCreating) return 'Security pool creation is already in progress.'
	if (duplicateOriginPoolExists) return 'A pool for this question and security multiplier already exists.'
	if (marketDetails === undefined) return 'Load a binary market before creating a pool.'
	if (marketDetails.marketType !== 'binary') return 'Security pools can only be created for binary markets.'
	if (zoltarUniverseHasForked) return 'Security pools cannot be created after Zoltar has forked.'
	return undefined
}
