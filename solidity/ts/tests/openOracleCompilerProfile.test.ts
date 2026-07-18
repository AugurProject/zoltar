import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { createOpenOracleCompilerSources, loadOpenOracleCompiler, openOracleCompilerSettings } from '../compile'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

describe('OpenOracle compiler profile', () => {
	test('preserves the upstream compiler, optimizer, EVM target, and exact pragma', async () => {
		const compiler = await loadOpenOracleCompiler()
		const sources = createOpenOracleCompilerSources(
			new Map([
				['contracts/peripherals/openOracle/OpenOracle.sol', 'pragma solidity 0.8.28; contract OpenOracle {}'],
				['contracts/peripherals/openOracle/libraries/Errors.sol', 'pragma solidity 0.8.28; library Errors {}'],
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
		if (!isRecord(artifact) || !isRecord(artifact['sources']) || !isRecord(artifact['contracts'])) throw new Error('Generated contract artifact is missing sources or contracts')

		const sourceIds = new Set<number>()
		for (const [sourcePath, sourceData] of Object.entries(artifact['sources'])) {
			if (!isRecord(sourceData) || typeof sourceData['id'] !== 'number') throw new Error(`Generated source ${sourcePath} is missing its numeric id`)
			if (sourceIds.has(sourceData['id'])) throw new Error(`Generated source id ${sourceData['id'].toString()} is assigned more than once`)
			sourceIds.add(sourceData['id'])
		}

		for (const [sourcePath, sourceContracts] of Object.entries(artifact['contracts'])) {
			if (!isRecord(sourceContracts)) continue
			for (const [contractName, contractData] of Object.entries(sourceContracts)) {
				if (!isRecord(contractData) || !isRecord(contractData['evm'])) continue
				for (const sectionName of ['bytecode', 'deployedBytecode']) {
					const section = contractData['evm'][sectionName]
					if (!isRecord(section) || typeof section['sourceMap'] !== 'string') continue
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
})
