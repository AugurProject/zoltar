import { promises as fs } from 'fs'
import * as path from 'path'
import solc from 'solc'
import * as funtypes from 'funtypes'
import * as url from 'url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const CONTRACT_PATH_APP = path.join(directoryOfThisFile, '..', 'ts', 'types', 'contractArtifact.ts')

const CompileError = funtypes.ReadonlyObject({
	severity: funtypes.String,
	formattedMessage: funtypes.String
})

const AbiParameter: funtypes.Runtype<{
	readonly name?: string
	readonly type?: string
	readonly internalType?: string
	readonly indexed?: boolean
	readonly components?: readonly any[]
}> = funtypes.Lazy(() =>
	funtypes.ReadonlyPartial({
		name: funtypes.String,
		type: funtypes.String,
		internalType: funtypes.String,
		indexed: funtypes.Boolean,
		components: funtypes.ReadonlyArray(AbiParameter)
	})
)

const AbiEntry = funtypes.ReadonlyPartial({
	type: funtypes.String,
	name: funtypes.String,
	stateMutability: funtypes.String,
	anonymous: funtypes.Boolean,
	inputs: funtypes.ReadonlyArray(AbiParameter),
	outputs: funtypes.ReadonlyArray(AbiParameter)
})


type CompileResult = funtypes.Static<typeof CompileResult>
const CompileResult = funtypes.ReadonlyObject({
	contracts: funtypes.Record(
		funtypes.String,
		funtypes.Record(
			funtypes.String,
			funtypes.ReadonlyObject({
				abi: funtypes.ReadonlyArray(AbiEntry),
				evm: funtypes.ReadonlyObject({
					bytecode: funtypes.ReadonlyObject({
						object: funtypes.String
					}),
					deployedBytecode: funtypes.ReadonlyObject({
						object: funtypes.String
					})
				})
			})
		)
	),
	sources: funtypes.Unknown,
	errors: funtypes.Union(
		funtypes.ReadonlyArray(CompileError),
		funtypes.Undefined
	)
})

class CompilationError extends Error {
	errors: string[]
	constructor(errors: string[]) {
		super('compilation error')
		this.name = "CompilationError"
		this.errors = errors
	}
}

async function exists(path: string) {
	try {
		await fs.stat(path)
		return true
	} catch {
		return false
	}
}

const getAllFiles = async (dirPath: string, fileList: string[] = []): Promise<string[]> => {
	const files = await fs.readdir(dirPath);
	for (const file of files) {
		const filePath = path.join(dirPath, file);
		const stat = await fs.stat(filePath);
		if (stat.isDirectory()) {
			await getAllFiles(filePath, fileList);
		} else {
			fileList.push(filePath);
		}
	}
	return fileList;
}

const copySolidityContractArtifact = async (contractLocation: string) => {
	const solidityContract = CompileResult.parse(JSON.parse(await fs.readFile(contractLocation, 'utf8')))
	if (solidityContract.contracts === undefined) throw new Error('contracts object missing')
	const contracts = Object.entries(solidityContract.contracts).flatMap(([filename, contract]) => {
		if (contract === undefined) throw new Error('missing contract')
		return Object.entries(contract).map(([contractName, contractData]) => ({ contractName: `${ filename.replace('contracts/', '').replace(/-/g, '').replace(/\//g, '_').replace(/\\/g, '_').replace(/\.sol$/, '') }_${ contractName }`, contractData }))
	})
	if (new Set(contracts.map((x) => x.contractName)).size !== contracts.length) throw new Error('duplicated contract name!')
	const typescriptString = contracts.map((contract) => `export const ${ contract.contractName } = ${ JSON.stringify(contract.contractData, null, 4) } as const`).join('\r\n\r\n')
	await fs.writeFile(CONTRACT_PATH_APP, typescriptString)
}

const compileContracts = async () => {
	const files = await getAllFiles('contracts')
	const sources = await files.reduce(async (acc, curr) => {
		const value = { content: await fs.readFile(curr, 'utf8') }
		const relativePath = path.relative(process.cwd(), curr).replace(/\\/g, '/')
		acc.then(obj => obj[relativePath] = value)
		return acc
	}, Promise.resolve(<{ [key: string]: { content: string } }>{}))

	const input = {
		language: 'Solidity',
		sources,
		settings: {
			viaIR: true,
			optimizer: {
				enabled: true,
				runs: 500,
				details: {
					inliner: true,
				}
			},
			outputSelection: {
				"*": {
					'*': [ 'evm.bytecode.object', 'evm.deployedBytecode.object', 'abi' ]
				}
			},
		},
	}

	const output = solc.compile(JSON.stringify(input))
	const result = CompileResult.parse(JSON.parse(output))
	const errors = (result!.errors || []).filter(x => x.severity === 'error').map(x => x.formattedMessage)
	if (errors.length) throw new CompilationError(errors)

	const warnings = (result!.errors || []).map(x => x.formattedMessage)
	if (warnings.length > 0) warnings.forEach((warning) => console.warn(warning))

	const artifactsDir = path.join(process.cwd(), 'artifacts')
	if (!await exists(artifactsDir)) await fs.mkdir(artifactsDir, { recursive: false })
	await fs.writeFile(path.join(artifactsDir, 'Contracts.json'), output)
	await copySolidityContractArtifact(path.join(artifactsDir, 'Contracts.json'))
}

compileContracts().catch(error => {
	console.error(error)
	debugger
	process.exit(1)
})
