import * as path from 'path'
import * as url from 'url'
import { promises as fs } from 'fs'
type FileType = 'file' | 'directory'

async function recursiveDirectoryCopy(source: string, destination: string, inclusionPredicate: (path: string, fileType: FileType) => boolean | Promise<boolean>, rewriteCallback?: (sourcePath: string, destinationPath: string) => Promise<void>): Promise<void> {
	await fs.mkdir(destination, { recursive: true })
	const entries = await fs.readdir(source, { withFileTypes: true })
	for (const entry of entries) {
		const sourcePath = path.join(source, entry.name)
		const destinationPath = path.join(destination, entry.name)
		if (entry.isDirectory()) {
			if (await inclusionPredicate(sourcePath, 'directory')) {
				await recursiveDirectoryCopy(sourcePath, destinationPath, inclusionPredicate, rewriteCallback)
			}
		} else if (entry.isFile()) {
			if (await inclusionPredicate(sourcePath, 'file')) {
				await fs.copyFile(sourcePath, destinationPath)
				if (rewriteCallback) await rewriteCallback(sourcePath, destinationPath)
			}
		}
	}
}
import { copyProjectArtifacts } from './projectArtifacts.mts'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')
const VENDOR_OUTPUT_PATH = path.join(UI_ROOT_PATH, 'vendor')
const MODULES_ROOT_PATH = path.join(UI_ROOT_PATH, 'node_modules')

type Dependency = { packageName: string; packageToVendor?: string; subfolderToVendor: string; mainEntrypointFile: string; alternateEntrypoints: Record<string, string> }
const dependencyPaths: Dependency[] = [
	{ packageName: 'preact', subfolderToVendor: 'dist', mainEntrypointFile: 'preact.module.js', alternateEntrypoints: {} },
	{ packageName: 'preact/jsx-runtime', subfolderToVendor: 'dist', mainEntrypointFile: 'jsxRuntime.module.js', alternateEntrypoints: {} },
	{ packageName: 'preact/hooks', subfolderToVendor: 'dist', mainEntrypointFile: 'hooks.module.js', alternateEntrypoints: {} },
	{ packageName: '@preact/signals', subfolderToVendor: 'dist', mainEntrypointFile: 'signals.module.js', alternateEntrypoints: {} },
	{ packageName: '@preact/signals-core', subfolderToVendor: 'dist', mainEntrypointFile: 'signals-core.module.js', alternateEntrypoints: {} },
	{ packageName: 'abitype', subfolderToVendor: 'dist/esm', mainEntrypointFile: 'exports/index.js', alternateEntrypoints: {} },
	{ packageName: '@noble/hashes', subfolderToVendor: 'esm', mainEntrypointFile: 'index.js', alternateEntrypoints: { crypto: 'crypto.js', sha3: 'sha3.js', utils: 'utils.js', _assert: '_assert.js', sha256: 'sha256.js', sha512: 'sha512.js', pbkdf2: 'pbkdf2.js', hmac: 'hmac.js', ripemd160: 'ripemd160.js' } },
	{ packageName: '@noble/curves', subfolderToVendor: 'esm', mainEntrypointFile: 'index.js', alternateEntrypoints: { secp256k1: 'secp256k1.js', 'abstract/modular': 'abstract/modular.js', 'abstract/utils': 'abstract/utils.js' } },
	{ packageName: 'funtypes', subfolderToVendor: 'lib', mainEntrypointFile: 'index.mjs', alternateEntrypoints: {} },
	{ packageName: 'isows', subfolderToVendor: '_esm', mainEntrypointFile: 'native.js', alternateEntrypoints: {} },
	{ packageName: 'ox', subfolderToVendor: '_esm', mainEntrypointFile: 'index.js', alternateEntrypoints: { BlockOverrides: 'core/BlockOverrides.js', AbiConstructor: 'core/AbiConstructor.js', AbiFunction: 'core/AbiFunction.js' } },
	{ packageName: 'viem', subfolderToVendor: '_esm', mainEntrypointFile: 'index.js', alternateEntrypoints: {} },
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
		const cleanSourcePath = source.replace(/^(?:\.\/)*/, '').replace(/^(?:\.\.\/)*/, '')
		fileContents.sources[i] = ['dependencies://dependencies', packageName, cleanSourcePath].join('/')
	}
	await fs.writeFile(destinationPath, JSON.stringify(fileContents))
}

async function writeViemBrowserEntrypoints() {
	const viemOutRoot = path.join(VENDOR_OUTPUT_PATH, 'viem')
	await fs.writeFile(
		path.join(viemOutRoot, 'index.js'),
		[
			"export { createPublicClient } from './clients/createPublicClient.js'",
			"export { createWalletClient } from './clients/createWalletClient.js'",
			"export { custom } from './clients/transports/custom.js'",
			"export { http } from './clients/transports/http.js'",
			"export { publicActions } from './clients/decorators/public.js'",
			"export { zeroAddress } from './constants/address.js'",
			"export { zeroHash } from './constants/bytes.js'",
			"export { maxUint256 } from './constants/number.js'",
			"export { RpcError } from './errors/rpc.js'",
			"export { decodeAbiParameters } from './utils/abi/decodeAbiParameters.js'",
			"export { decodeEventLog } from './utils/abi/decodeEventLog.js'",
			"export { decodeFunctionData } from './utils/abi/decodeFunctionData.js'",
			"export { encodeAbiParameters } from './utils/abi/encodeAbiParameters.js'",
			"export { encodeDeployData } from './utils/abi/encodeDeployData.js'",
			"export { encodeEventTopics } from './utils/abi/encodeEventTopics.js'",
			"export { encodeFunctionData } from './utils/abi/encodeFunctionData.js'",
			"export { parseAbiItem, parseAbiParameters } from 'abitype'",
			"export { getAddress } from './utils/address/getAddress.js'",
			"export { isAddress } from './utils/address/isAddress.js'",
			"export { getCreate2Address, getCreateAddress } from './utils/address/getContractAddress.js'",
			"export { concatHex } from './utils/data/concat.js'",
			"export { isHex } from './utils/data/isHex.js'",
			"export { bytesToHex } from './utils/encoding/toHex.js'",
			"export { hexToBytes } from './utils/encoding/toBytes.js'",
			"export { numberToBytes } from './utils/encoding/toBytes.js'",
			"export { toHex } from './utils/encoding/toHex.js'",
			"export { formatEther } from './utils/unit/formatEther.js'",
			"export { formatUnits } from './utils/unit/formatUnits.js'",
			"export { parseUnits } from './utils/unit/parseUnits.js'",
			"export { defineChain } from './utils/chain/defineChain.js'",
			"export { keccak256 } from './utils/hash/keccak256.js'",
			"export { parseTransaction } from './utils/transaction/parseTransaction.js'",
			"export { recoverTransactionAddress } from './utils/signature/recoverTransactionAddress.js'",
			'',
		].join('\n'),
	)
	await fs.writeFile(path.join(viemOutRoot, 'chains', 'index.js'), "export { mainnet } from './definitions/mainnet.js'\n")
}

async function bundleTevm() {
	const tevmOutRoot = path.join(VENDOR_OUTPUT_PATH, 'tevm')
	await Promise.all([
		Bun.build({
			entrypoints: [path.join(MODULES_ROOT_PATH, 'tevm', 'index.js')],
			naming: { entry: 'index.js' },
			outdir: tevmOutRoot,
			target: 'browser',
			sourcemap: 'linked',
		}),
		Bun.build({
			entrypoints: [path.join(MODULES_ROOT_PATH, '@tevm', 'common', 'dist', 'index.js')],
			naming: { entry: 'index.js' },
			outdir: path.join(tevmOutRoot, 'common'),
			target: 'browser',
			sourcemap: 'linked',
		}),
	])
}

const vendor = async () => {
	await bundleTevm()
	await vendorDependencies()
	await writeViemBrowserEntrypoints()
	await copyProjectArtifacts()
}

vendor().catch(error => {
	console.error(error)
	debugger
	process.exit(1)
})
