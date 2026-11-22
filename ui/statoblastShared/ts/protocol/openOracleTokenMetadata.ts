import { bigintToSafeNumber, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { ReputationToken_ReputationToken, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { tokenDisplayLabel } from '@zoltar/ui-core-shared/lib/tokenLabel.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { getGenesisReputationTokenAddress, getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/activeProtocolAddresses.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import * as openOracleCopy from '../copy/openOracle.js'
import { getZoltarAddress } from './deploymentHelpers.js'

/** A report token's decimals and display label, or why the report cannot be shown with it. */
export type OpenOracleTokenMetadata = { status: 'success'; decimals: number; label: string } | { status: 'failure'; message: string }

type RawRead = { status: 'success' | 'failure'; result?: unknown }

function parseDecimals(read: RawRead | undefined) {
	if (read?.status !== 'success') return undefined
	let decimals: number | undefined
	if (typeof read.result === 'bigint') decimals = read.result <= 255n && read.result >= 0n ? bigintToSafeNumber(read.result, 'Token decimals') : undefined
	if (typeof read.result === 'number') decimals = read.result
	return decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : undefined
}

function parseSymbol(read: RawRead | undefined) {
	return read?.status === 'success' && typeof read.result === 'string' ? read.result : undefined
}

/**
 * Zoltar REP tokens are identified by address: the profile's genesis REP, or a child REP
 * whose claimed universe Zoltar maps back to the same token. A failed lookup leaves a token unverified.
 */
async function loadZoltarReputationTokens(client: Pick<ReadClient, 'multicall'>, candidates: readonly { token: Address; universeId: unknown }[]) {
	const verified = new Set<string>()
	const claims = candidates.flatMap(({ token, universeId }) => (typeof universeId === 'bigint' && universeId > 0n && universeId < 1n << 248n ? [{ token, universeId }] : []))
	if (claims.length === 0) return verified
	const zoltar = getZoltarAddress()
	const universes = await readOptionalMulticall(
		client,
		claims.map(({ universeId }) => ({ address: zoltar, abi: Zoltar_Zoltar.abi, functionName: 'universes', args: [universeId] })),
	)
	for (const [index, { token }] of claims.entries()) {
		const universe = universes.at(index)
		// Zoltar.universes returns (forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId).
		const reputationToken = universe?.status === 'success' && Array.isArray(universe.result) ? universe.result[3] : undefined
		if (typeof reputationToken === 'string' && sameAddress(reputationToken, token)) verified.add(token.toLowerCase())
	}
	return verified
}

/** Reads every token's metadata with allow-failure calls so one unusable token never rejects the others. */
export async function loadOpenOracleTokenMetadata(client: Pick<ReadClient, 'multicall'>, tokens: readonly Address[]): Promise<Map<string, OpenOracleTokenMetadata>> {
	const metadata = new Map<string, OpenOracleTokenMetadata>()
	// OpenOracle's ETH_SENTINEL (the zero address) is native ETH, which has no ERC-20 metadata to read.
	if (tokens.some(token => sameAddress(token, zeroAddress))) metadata.set(zeroAddress, { status: 'success', decimals: 18, label: commonCopy.eth })
	const uniqueTokens = tokens.filter((token, index) => !sameAddress(token, zeroAddress) && tokens.findIndex(other => sameAddress(other, token)) === index)
	if (uniqueTokens.length === 0) return metadata
	const weth = getWethAddress()
	const genesisRep = getGenesisReputationTokenAddress()
	const repCandidates = uniqueTokens.filter(token => !sameAddress(token, weth) && !sameAddress(token, genesisRep))
	const reads: readonly RawRead[] = await readOptionalMulticall(client, [
		...uniqueTokens.map(token => ({ address: token, abi: ABIS.mainnet.erc20, functionName: 'decimals' })),
		...uniqueTokens.map(token => ({ address: token, abi: ABIS.mainnet.erc20, functionName: 'symbol' })),
		...repCandidates.map(token => ({ address: token, abi: ReputationToken_ReputationToken.abi, functionName: 'universeId' })),
	])
	const childReputationTokens = await loadZoltarReputationTokens(
		client,
		repCandidates.map((token, index) => ({ token, universeId: reads.at(uniqueTokens.length * 2 + index)?.result })),
	)
	for (const [index, token] of uniqueTokens.entries()) {
		const decimals = parseDecimals(reads.at(index))
		const symbol = parseSymbol(reads.at(uniqueTokens.length + index))
		const isWeth = sameAddress(token, weth)
		let result: OpenOracleTokenMetadata
		if (decimals === undefined) result = { status: 'failure', message: openOracleCopy.formatTokenDecimalsInvalid(token) }
		else if (isWeth && (decimals !== 18 || symbol?.trim() !== 'WETH')) result = { status: 'failure', message: openOracleCopy.formatWethMetadataInvalid(token) }
		else {
			const verified = isWeth || sameAddress(token, genesisRep) || childReputationTokens.has(token.toLowerCase())
			result = { status: 'success', decimals, label: tokenDisplayLabel({ address: token, symbol, verified }) }
		}
		metadata.set(token.toLowerCase(), result)
	}
	return metadata
}
