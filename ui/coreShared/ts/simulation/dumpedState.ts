import type { DumpStateResult } from '@tevm/actions'
import type { Address, Hex } from '@zoltar/core-shared/evm/ethereum'
import type { TevmLikeClient } from './clock.js'

/** tevm state dumps as the engine copies them between the live chain and a temporary one. */
export type DumpedTevmState = DumpStateResult['state']
type DumpedTevmAccountState = DumpedTevmState[string]
type TevmErrorLike = {
	message: string
}

export function formatTevmErrors(errors: readonly TevmErrorLike[]) {
	return errors.map(error => error.message).join(', ')
}

export async function requireSuccessfulLoadState(memoryClient: TevmLikeClient, state: DumpedTevmState) {
	const result = await memoryClient.tevmLoadState({ state })
	if (result.errors === undefined || result.errors.length === 0) return
	throw new Error(formatTevmErrors(result.errors))
}

export async function requireSuccessfulDumpState(memoryClient: TevmLikeClient): Promise<DumpedTevmState> {
	const result = await memoryClient.tevmDumpState()
	if (result.errors === undefined || result.errors.length === 0) return result.state
	throw new Error(formatTevmErrors(result.errors))
}

function getDumpedAccountState(state: DumpedTevmState, address: Address) {
	const normalizedAddress = address.toLowerCase()
	const matchingEntry = Object.entries(state).find(([candidateAddress]) => candidateAddress.toLowerCase() === normalizedAddress)
	return matchingEntry?.[1]
}

function normalizeDumpedStorage(storage: NonNullable<DumpedTevmAccountState['storage']>): Record<Hex, Hex> {
	const normalizedStorage: Record<Hex, Hex> = {}
	for (const [key, value] of Object.entries(storage)) {
		normalizedStorage[key as Hex] = value as Hex
	}
	return normalizedStorage
}

export async function applyDumpedAccountState(memoryClient: TevmLikeClient, address: Address, state: DumpedTevmState) {
	const accountState = getDumpedAccountState(state, address)
	if (accountState === undefined) throw new Error(`Missing simulation account state for ${address}`)

	const setAccountResult = await memoryClient.tevmSetAccount({
		address,
		balance: BigInt(accountState.balance),
		...(accountState.deployedBytecode === undefined ? {} : { deployedBytecode: accountState.deployedBytecode }),
		nonce: BigInt(accountState.nonce),
		...(accountState.storage === undefined ? {} : { state: normalizeDumpedStorage(accountState.storage) }),
	})
	if (setAccountResult.errors !== undefined && setAccountResult.errors.length > 0) {
		throw new Error(formatTevmErrors(setAccountResult.errors))
	}
}

export async function applyDumpedStorageState(memoryClient: TevmLikeClient, address: Address, state: DumpedTevmState) {
	const accountState = getDumpedAccountState(state, address)
	if (accountState === undefined) throw new Error(`Missing simulation account state for ${address}`)
	if (accountState.storage === undefined) throw new Error(`Missing simulation storage state for ${address}`)

	for (const [index, value] of Object.entries(accountState.storage)) {
		await memoryClient.setStorageAt({
			address,
			index: index as Hex,
			value: value as Hex,
		})
	}
}
