import * as path from 'path'
import * as url from 'url';
import { promises as fs } from 'fs'
import { FileType, recursiveDirectoryCopy } from '@zoltu/file-copier'
import * as funtypes from 'funtypes'
import esbuild from 'esbuild'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const VENDOR_OUTPUT_PATH = path.join(directoryOfThisFile, '..', 'app', 'vendor')
const MODULES_ROOT_PATH = path.join(directoryOfThisFile, '..', 'node_modules')
const INDEX_HTML_PATH = path.join(directoryOfThisFile, '..', 'app', 'index.html')
const CONTRACT_PATH_APP = path.join(directoryOfThisFile, '..', 'app', 'ts', 'ABI', 'VendoredContracts.ts')

const CompileError = funtypes.ReadonlyObject({
	severity: funtypes.String,
	formattedMessage: funtypes.String
})

type CompileResult = funtypes.Static<typeof CompileResult>
const CompileResult = funtypes.ReadonlyPartial({
	contracts: funtypes.Record(funtypes.String, funtypes.Record(funtypes.String, funtypes.ReadonlyObject({
		abi: funtypes.ReadonlyArray(funtypes.ReadonlyPartial({
			inputs: funtypes.ReadonlyArray(funtypes.ReadonlyPartial({
				indexed: funtypes.Boolean,
				internalType: funtypes.String,
				name: funtypes.String,
				type: funtypes.String
			})),
			anonymous: funtypes.Boolean,
			stateMutability: funtypes.String,
			type: funtypes.String,
			name: funtypes.String,
			outputs: funtypes.ReadonlyArray(funtypes.Intersect(
				funtypes.ReadonlyObject({
					internalType: funtypes.String,
					name: funtypes.String,
					type: funtypes.String
				}),
				funtypes.ReadonlyPartial({
					components: funtypes.ReadonlyArray(
						funtypes.ReadonlyObject({
							internalType: funtypes.String,
							name: funtypes.String,
							type: funtypes.String
						})
					)
				})
			))
		})),
		evm: funtypes.ReadonlyObject({
			bytecode: funtypes.ReadonlyObject({ object: funtypes.String }),
			deployedBytecode: funtypes.ReadonlyObject({ object: funtypes.String })
		})
	}))),
	sources: funtypes.Unknown,
	errors: funtypes.Array(CompileError)
})

type Dependency = { packageName: string, packageToVendor?: string, subfolderToVendor: string, mainEntrypointFile: string, alternateEntrypoints: Record<string, string> }
const dependencyPaths: Dependency[] = [
    { packageName: 'preact', subfolderToVendor: 'dist', mainEntrypointFile: 'preact.module.js', alternateEntrypoints: {} },
    { packageName: 'preact/jsx-runtime', subfolderToVendor: 'dist', mainEntrypointFile: 'jsxRuntime.module.js', alternateEntrypoints: {} },
    { packageName: 'preact/hooks', subfolderToVendor: 'dist', mainEntrypointFile: 'hooks.module.js', alternateEntrypoints: {} },
    { packageName: '@preact/signals', subfolderToVendor: 'dist', mainEntrypointFile: 'signals.module.js', alternateEntrypoints: {} },
    { packageName: '@preact/signals-core', subfolderToVendor: 'dist', mainEntrypointFile: 'signals-core.module.js', alternateEntrypoints: {} },
    { packageName: 'viem', subfolderToVendor: '_esm', mainEntrypointFile: 'index.js', alternateEntrypoints: {} },
    { packageName: 'viem/chains', packageToVendor: 'viem/_esm', subfolderToVendor: 'chains', mainEntrypointFile: 'index.js', alternateEntrypoints: {} },
    { packageName: 'viem/window', packageToVendor: 'viem/_esm', subfolderToVendor: 'window', mainEntrypointFile: 'index.js', alternateEntrypoints: {} },
    { packageName: 'viem/actions', packageToVendor: 'viem/_esm', subfolderToVendor: 'window', mainEntrypointFile: 'index.js', alternateEntrypoints: {} },
    { packageName: 'abitype', subfolderToVendor: 'dist/esm', mainEntrypointFile: 'exports/index.js', alternateEntrypoints: { } },
	{ packageName: '@noble/hashes', subfolderToVendor: 'esm', mainEntrypointFile: 'index.js', alternateEntrypoints: { 'crypto': 'crypto.js', 'sha3': 'sha3.js', 'utils': 'utils.js', '_assert': '_assert.js', 'sha256': 'sha256.js', 'sha512': 'sha512.js', 'pbkdf2': 'pbkdf2.js', 'hmac': 'hmac.js', 'ripemd160': 'ripemd160.js' } },
	{ packageName: '@noble/curves', subfolderToVendor: 'esm', mainEntrypointFile: 'index.js', alternateEntrypoints: { 'secp256k1': 'secp256k1.js', 'abstract/modular': 'abstract/modular.js', 'abstract/utils': 'abstract/utils.js' } },
	{ packageName: 'funtypes', subfolderToVendor: 'lib', mainEntrypointFile: 'index.mjs', alternateEntrypoints: {} },
	{ packageName: 'ox', subfolderToVendor: '_esm', mainEntrypointFile: 'index.js', alternateEntrypoints: { 'BlockOverrides': 'core/BlockOverrides.js', 'AbiConstructor': 'core/AbiConstructor.js' , 'AbiFunction': 'core/AbiFunction.js' } },
]

async function vendorDependencies() {
	async function inclusionPredicate(path: string, fileType: FileType) {
		if (path.endsWith('.js')) return true
		if (path.endsWith('.ts')) return true
		if (path.endsWith('.mjs')) return true
		if (path.endsWith('.mts')) return true
		if (path.endsWith('.map')) return true
		if (path.endsWith('.git') || path.endsWith('.git/') || path.endsWith('.git\\')) return false
		if (path.endsWith('node_modules') || path.endsWith('node_modules/') || path.endsWith('node_modules\\')) return false
		if (fileType === 'directory') return true
		return false
	}
	for (const { packageName, packageToVendor, subfolderToVendor } of dependencyPaths) {
		const sourceDirectoryPath = path.join(MODULES_ROOT_PATH, packageToVendor || packageName, subfolderToVendor)
		const destinationDirectoryPath = path.join(VENDOR_OUTPUT_PATH, packageToVendor || packageName)
		await recursiveDirectoryCopy(sourceDirectoryPath, destinationDirectoryPath, inclusionPredicate, rewriteSourceMapSourcePath.bind(undefined, packageName))
	}

	const oldIndexHtml = await fs.readFile(INDEX_HTML_PATH, 'utf8')
	const importmap = dependencyPaths.reduce((importmap, { packageName, mainEntrypointFile, alternateEntrypoints }) => {
		importmap.imports[packageName] = `./vendor/${packageName}/${mainEntrypointFile}`
		for (const [alternateEntrypointName, alternateEntrypointFile] of Object.entries(alternateEntrypoints)) {
			importmap.imports[`${packageName}/${alternateEntrypointName}`] = `./vendor/${packageName}/${alternateEntrypointFile}`
		}
		return importmap
	}, { imports: {} as Record<string, string> })
	const importmapJson = JSON.stringify(importmap, undefined, '\t')
		.replace(/^/mg, '\t\t')
	const newIndexHtml = oldIndexHtml.replace(/<script type='importmap'>[\s\S]*?<\/script>/m, `<script type='importmap'>\n${importmapJson}\n\t</script>`)
	await fs.writeFile(INDEX_HTML_PATH, newIndexHtml)
}

const copySolidityContractArtifact = async () => {
	const contractLocation = path.join(directoryOfThisFile, '..', 'solidity/artifacts/VendoredContracts.json')
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

// rewrite the source paths in sourcemap files so they show up in the debugger in a reasonable location and if two source maps refer to the same (relative) path, we end up with them distinguished in the browser debugger
async function rewriteSourceMapSourcePath(packageName: string, sourcePath: string, destinationPath: string) {
	const fileExtension = path.extname(sourcePath)
	if (fileExtension !== '.map') return
	const fileContents = JSON.parse(await fs.readFile(sourcePath, 'utf-8')) as { sources: Array<string> }
	for (let i = 0; i < fileContents.sources.length; ++i) {
		const source = fileContents.sources[i]
		if (source === undefined) continue
		// we want to ensure all source files show up in the appropriate directory and don't leak out of our directory tree, so we strip leading '../' references
		const sourcePath = source.replace(/^(?:.\/)*/, '').replace(/^(?:..\/)*/, '')
		fileContents.sources[i] = ['dependencies://dependencies', packageName, sourcePath].join('/')
	}
	await fs.writeFile(destinationPath, JSON.stringify(fileContents))
}

async function bundleViem() {
	const viemSrcDir = path.join(MODULES_ROOT_PATH, 'viem', '_esm')
	const viemTmpOut = path.join(directoryOfThisFile, 'tmp-viem-bundle')

	await esbuild.build({
		entryPoints: {
			'index': path.join(viemSrcDir, 'index.js'),
			'chains/index': path.join(viemSrcDir, 'chains', 'index.js'),
			'window/index': path.join(viemSrcDir, 'window', 'index.js'),
			'actions/index': path.join(viemSrcDir, 'actions', 'index.js')
		},
		format: 'esm',
		outdir: viemTmpOut,
		bundle: true,
		platform: 'browser',
		sourcemap: true,
		target: 'esnext'
	})

	await fs.rm(viemSrcDir, { recursive: true, force: true })
	await fs.mkdir(viemSrcDir, { recursive: true })
	await recursiveDirectoryCopy(viemTmpOut, viemSrcDir, async () => true)
	await fs.rm(viemTmpOut, { recursive: true, force: true })
}

const vendor = async () => {
	await bundleViem()
	await vendorDependencies()
	await copySolidityContractArtifact()
}

vendor().catch(error => {
	console.error(error)
	debugger
	process.exit(1)
})
