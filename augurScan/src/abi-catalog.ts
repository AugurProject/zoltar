import path from 'node:path'
import { effectiveAbiSourceHash } from './abi-provenance.ts'
import { type Abi, type Hex, toFunctionSelector } from './ethereum.ts'
import { supportedWrappers, type SystemContractKind, systemInterfaces } from './system-interfaces.ts'
import type { AbiCatalogEntry } from './types.ts'

type CatalogFile = {
	readonly sourceHash: string
	readonly contracts: Record<string, AbiCatalogEntry>
}

const catalogFile = (await Bun.file(path.resolve(import.meta.dir, '../config/abis.json')).json()) as CatalogFile

const interfaces = new Map<string, (typeof systemInterfaces)[SystemContractKind]>(Object.entries(systemInterfaces))

export const abiSourceHash = effectiveAbiSourceHash(catalogFile.contracts, systemInterfaces, supportedWrappers)

export const abiForKind = (kind: string): Abi | undefined => {
	const definition = interfaces.get(kind)
	if (definition === undefined) return undefined
	if (definition.type === 'raw') return []
	if (definition.type === 'interface') return definition.abi
	return catalogFile.contracts[definition.name]?.abi
}

export const assertAbiCoverage = (kinds: Iterable<string>): void => {
	for (const kind of new Set(kinds)) {
		const definition = interfaces.get(kind)
		if (definition === undefined) throw new Error(`Unsupported system contract kind: ${kind}`)
		const abi = abiForKind(kind)
		if (abi === undefined || (abi.length === 0 && definition.type !== 'raw')) throw new Error(`Missing ABI for system contract kind: ${kind}`)
	}
}

const wrapperAbi = abiForKind('delegationManager')
const wrapperFunction = wrapperAbi?.find(item => item.type === 'function' && item.name === supportedWrappers.delegationManager.functionName)
if (wrapperFunction === undefined) throw new Error('Missing delegation wrapper ABI')
const wrapperSelector = toFunctionSelector(wrapperFunction)
export const wrapperAbiForInput = (input: Hex): Abi | undefined => (input.slice(0, 10).toLowerCase() === wrapperSelector ? wrapperAbi : undefined)

export const catalogAbis = (): readonly Abi[] => [...Object.values(catalogFile.contracts).map(({ abi }) => abi), ...Object.values(systemInterfaces).flatMap(definition => (definition.type === 'interface' ? [definition.abi] : []))]
