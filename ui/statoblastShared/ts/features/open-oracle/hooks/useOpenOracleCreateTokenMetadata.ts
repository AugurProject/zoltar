import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { useEffect, useState } from 'preact/hooks'
import { readCreateTokenMetadata, type CreateTokenMetadataReadResult } from '../lib/openOracleTokenAccess.js'

export type LoadOpenOracleCreateTokenMetadata = (address: Address, label: 'Base' | 'Quote') => Promise<CreateTokenMetadataReadResult>

export type OpenOracleCreateTokenMetadata = { status: 'idle' } | { status: 'loading' } | { decimals: number; status: 'ready'; symbol: string | undefined } | { message: string; status: 'failure' }

export const loadOpenOracleCreateTokenMetadata: LoadOpenOracleCreateTokenMetadata = async (address, label) => await readCreateTokenMetadata(createConnectedReadClient(), address, label)

type TokenMetadataEntry = { address: Address; metadata: OpenOracleCreateTokenMetadata }

function useTokenMetadata(addressInput: string, label: 'Base' | 'Quote', environmentReady: boolean, loadTokenMetadata: LoadOpenOracleCreateTokenMetadata): OpenOracleCreateTokenMetadata {
	const address = tryParseAddressInput(addressInput)
	const [entry, setEntry] = useState<TokenMetadataEntry | undefined>(undefined)
	useEffect(() => {
		if (address === undefined || !environmentReady) return undefined
		let cancelled = false
		setEntry({ address, metadata: { status: 'loading' } })
		void loadTokenMetadata(address, label)
			.then(result => (result.status === 'success' ? { decimals: result.decimals, status: 'ready' as const, symbol: result.symbol } : { message: result.message, status: 'failure' as const }))
			.catch((error: unknown) => ({ message: getErrorMessage(error, `Unable to read the ${label.toLowerCase()} token.`), status: 'failure' as const }))
			.then(metadata => {
				if (!cancelled) setEntry({ address, metadata })
			})
		return () => {
			cancelled = true
		}
	}, [address, environmentReady, label, loadTokenMetadata])
	if (address === undefined || !environmentReady) return { status: 'idle' }
	// Until the read for a newly entered address starts, the previous token's details must not label it.
	if (entry === undefined || entry.address !== address) return { status: 'loading' }
	return entry.metadata
}

/** Reads each create-form token once its address is valid, so amount fields can show units and validate decimal precision while typing. */
export function useOpenOracleCreateTokenMetadata({ environmentReady, loadTokenMetadata, token1Address, token2Address }: { environmentReady: boolean; loadTokenMetadata: LoadOpenOracleCreateTokenMetadata; token1Address: string; token2Address: string }) {
	return {
		token1: useTokenMetadata(token1Address, 'Base', environmentReady, loadTokenMetadata),
		token2: useTokenMetadata(token2Address, 'Quote', environmentReady, loadTokenMetadata),
	}
}
