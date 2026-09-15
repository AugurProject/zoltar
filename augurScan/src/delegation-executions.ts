import { type Address, formatUnits, getAddress, type Hex, isHex } from './ethereum.ts'
import type { DecodedRecord, SerializedArguments } from './types.ts'
import { supportedWrappers } from './system-interfaces.ts'

// ERC-7579 single execution encoding is packed address (20 bytes), value
// (32 bytes), then calldata. Unknown modes remain opaque rather than being
// interpreted as single calls: https://github.com/erc7579/erc7579-implementation/blob/main/src/lib/ExecutionLib.sol
export const delegationExecutionDetails = (argumentsValue: SerializedArguments, labels: ReadonlyMap<string, string>, nativeSymbol: string, decode: (target: Address, input: Hex) => DecodedRecord): { summaries: string[]; addresses: Address[] } => {
	const modes = argumentsValue['_modes']
	const executions = argumentsValue['_executionCallDatas']
	const contexts = argumentsValue['_permissionContexts']
	if (!Array.isArray(modes) || !Array.isArray(executions) || !Array.isArray(contexts) || modes.length !== executions.length || contexts.length !== executions.length) throw new Error('Delegation arrays must have matching lengths')
	const addresses: Address[] = []
	const summaries = executions.map((execution: unknown, index) => {
		const mode: unknown = modes[index]
		const format = Object.values(supportedWrappers.delegationManager.modes).find(candidate => typeof mode === 'string' && candidate.code === mode.toLowerCase())
		if (format === undefined) return `Unsupported execution mode ${String(mode)}`
		if (typeof execution !== 'string' || !isHex(execution) || execution.length < 106 || execution.length % 2 !== 0) return 'Malformed execution'
		const target = getAddress(`0x${execution.slice(2, 42)}`)
		const value = BigInt(`0x${execution.slice(42, 106)}`)
		const input: Hex = `0x${execution.slice(106)}`
		const action = decode(target, input)
		addresses.push(target, ...(action.referencedAddresses ?? []))
		const valueLabel = value === 0n ? '' : ` · value=${formatUnits(value, 18)} ${nativeSymbol}`
		const tryLabel = format.allowFailure ? ' (allow failure)' : ''
		return `${labels.get(target.toLowerCase()) ?? target}${valueLabel}${tryLabel} · ${action.summary}`
	})
	return { summaries, addresses: [...new Map(addresses.map(address => [address.toLowerCase(), address])).values()] }
}
