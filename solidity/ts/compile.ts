import { promises as fs } from 'fs'
import * as path from 'path'
import solc from 'solc'
import * as funtypes from 'funtypes'

const CompileError = funtypes.ReadonlyObject({
	severity: funtypes.String,
	formattedMessage: funtypes.String
})

type CompileResult = funtypes.Static<typeof CompileResult>
const CompileResult = funtypes.ReadonlyObject({
	errors: funtypes.Array(CompileError)
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
	const artifactsDir = path.join(process.cwd(), 'artifacts')
	if (!await exists(artifactsDir)) await fs.mkdir(artifactsDir, { recursive: false })
	await fs.writeFile(path.join(artifactsDir, 'Contracts.json'), output)
}

compileContracts().catch(error => {
	console.error(error)
	debugger
	process.exit(1)
})
