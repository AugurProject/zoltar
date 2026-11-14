import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { createOpenOracleCompilerSources, loadOpenOracleCompiler, openOracleCompilerSettings } from '../compile'
import { isObjectRecord } from '@zoltar/core-shared/validation/guards'

describe('OpenOracle compiler profile', () => {
	test('normalizes Windows line endings before compiling vendored sources', () => {
		const sources = createOpenOracleCompilerSources(
			new Map([
				['contracts/statoblast/openOracle/OpenOracle.sol', 'pragma solidity 0.8.28;\r\ncontract OpenOracle {}\r\n'],
				['contracts/statoblast/openOracle/libraries/Errors.sol', 'pragma solidity 0.8.28;\r\nlibrary Errors {}\r\n'],
			]),
		)

		expect(sources.get('src/OpenOracleSlim.sol')).toBe('pragma solidity 0.8.28;\ncontract OpenOracle {}\n')
		expect(sources.get('src/libraries/Errors.sol')).toBe('pragma solidity 0.8.28;\nlibrary Errors {}\n')
	})

	test('preserves the upstream compiler, optimizer, EVM target, and exact pragma', async () => {
		const compiler = await loadOpenOracleCompiler()
		const sources = createOpenOracleCompilerSources(
			new Map([
				['contracts/statoblast/openOracle/OpenOracle.sol', 'pragma solidity 0.8.28; contract OpenOracle {}'],
				['contracts/statoblast/openOracle/libraries/Errors.sol', 'pragma solidity 0.8.28; library Errors {}'],
			]),
		)

		expect(compiler.version()).toStartWith('0.8.28+')
		expect(openOracleCompilerSettings).toMatchObject({
			evmVersion: 'cancun',
			optimizer: {
				enabled: true,
				runs: 190,
			},
			viaIR: true,
		})
		expect(sources.get('src/OpenOracleSlim.sol')).toContain('pragma solidity 0.8.28;')
		expect(sources.get('src/libraries/Errors.sol')).toContain('pragma solidity 0.8.28;')
	})

	test('generated artifacts use unique and complete source-map ids across compiler profiles', async () => {
		const artifact: unknown = JSON.parse(await fs.readFile('solidity/artifacts/Contracts.json', 'utf8'))
		if (!isObjectRecord(artifact) || !isObjectRecord(artifact['sources']) || !isObjectRecord(artifact['contracts'])) throw new Error('Generated contract artifact is missing sources or contracts')

		const sourceIds = new Set<number>()
		for (const [sourcePath, sourceData] of Object.entries(artifact['sources'])) {
			if (!isObjectRecord(sourceData) || typeof sourceData['id'] !== 'number') throw new Error(`Generated source ${sourcePath} is missing its numeric id`)
			if (sourceIds.has(sourceData['id'])) throw new Error(`Generated source id ${sourceData['id'].toString()} is assigned more than once`)
			sourceIds.add(sourceData['id'])
		}

		for (const [sourcePath, sourceContracts] of Object.entries(artifact['contracts'])) {
			if (!isObjectRecord(sourceContracts)) continue
			for (const [contractName, contractData] of Object.entries(sourceContracts)) {
				if (!isObjectRecord(contractData) || !isObjectRecord(contractData['evm'])) continue
				for (const sectionName of ['bytecode', 'deployedBytecode']) {
					const section = contractData['evm'][sectionName]
					if (!isObjectRecord(section) || typeof section['sourceMap'] !== 'string') continue
					let currentSourceId: number | undefined
					for (const segment of section['sourceMap'].split(';')) {
						const sourceIdField = segment.split(':')[2]
						if (sourceIdField !== undefined && sourceIdField !== '') currentSourceId = Number.parseInt(sourceIdField, 10)
						if (currentSourceId !== undefined && currentSourceId >= 0 && !sourceIds.has(currentSourceId)) {
							throw new Error(`${sourcePath}:${contractName} ${sectionName} references missing source id ${currentSourceId.toString()}`)
						}
					}
				}
			}
		}
	})

	test('generated artifacts retain immutable and link ranges required for deployed-bytecode coverage matching', async () => {
		const artifact: unknown = JSON.parse(await fs.readFile('solidity/artifacts/Contracts.json', 'utf8'))
		if (!isObjectRecord(artifact) || !isObjectRecord(artifact['contracts'])) throw new Error('Generated contract artifact is missing contracts')
		const securityPoolSource = artifact['contracts']['contracts/statoblast/factories/SecurityPoolFactory.sol']
		if (!isObjectRecord(securityPoolSource) || !isObjectRecord(securityPoolSource['SecurityPoolFactory'])) throw new Error('Generated contract artifact is missing SecurityPool')
		const evm = securityPoolSource['SecurityPoolFactory']['evm']
		if (!isObjectRecord(evm) || !isObjectRecord(evm['deployedBytecode'])) throw new Error('Generated SecurityPool artifact is missing deployed bytecode')
		const immutableReferences = evm['deployedBytecode']['immutableReferences']
		const linkReferences = evm['deployedBytecode']['linkReferences']
		if (!isObjectRecord(immutableReferences)) throw new Error('Generated SecurityPool artifact is missing immutable references')
		if (!isObjectRecord(linkReferences)) throw new Error('Generated SecurityPool artifact is missing link references')
		expect(Object.values(immutableReferences).some(ranges => Array.isArray(ranges) && ranges.length > 0)).toBe(true)
		expect(Object.values(linkReferences).some(libraries => isObjectRecord(libraries) && Object.values(libraries).some(ranges => Array.isArray(ranges) && ranges.length > 0))).toBe(true)
	})
})
