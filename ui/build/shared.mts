import { promises as fs } from 'fs'
import * as path from 'path'
import * as process from 'node:process'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')
const REPOSITORY_ROOT_PATH = path.join(UI_ROOT_PATH, '..')
const SHARED_OUTPUT_ROOT_PATH = path.join(REPOSITORY_ROOT_PATH, 'shared', 'js')

const sharedArtifactCopyPaths = [
	{
		sourcePath: path.join(SHARED_OUTPUT_ROOT_PATH, 'addressDerivation.js'),
		destinationPath: path.join(UI_ROOT_PATH, 'js', 'shared', 'addressDerivation.js'),
	},
	{
		sourcePath: path.join(SHARED_OUTPUT_ROOT_PATH, 'bigInt.js'),
		destinationPath: path.join(UI_ROOT_PATH, 'js', 'shared', 'bigInt.js'),
	},
	{
		sourcePath: path.join(SHARED_OUTPUT_ROOT_PATH, 'addressDerivation.d.ts'),
		destinationPath: path.join(UI_ROOT_PATH, 'ts', 'shared', 'addressDerivation.d.ts'),
	},
	{
		sourcePath: path.join(SHARED_OUTPUT_ROOT_PATH, 'bigInt.d.ts'),
		destinationPath: path.join(UI_ROOT_PATH, 'ts', 'shared', 'bigInt.d.ts'),
	},
	{
		sourcePath: path.join(SHARED_OUTPUT_ROOT_PATH, 'deploymentAddresses.js'),
		destinationPath: path.join(UI_ROOT_PATH, 'js', 'shared', 'deploymentAddresses.js'),
	},
	{
		sourcePath: path.join(SHARED_OUTPUT_ROOT_PATH, 'deploymentAddresses.d.ts'),
		destinationPath: path.join(UI_ROOT_PATH, 'ts', 'shared', 'deploymentAddresses.d.ts'),
	},
]

const sharedSourceShimFiles = [
	{
		destinationPath: path.join(UI_ROOT_PATH, 'ts', 'shared', 'addressDerivation.js'),
		fileContents: "export * from '../../../shared/js/addressDerivation.js'\n",
	},
	{
		destinationPath: path.join(UI_ROOT_PATH, 'ts', 'shared', 'bigInt.js'),
		fileContents: "export * from '../../../shared/js/bigInt.js'\n",
	},
	{
		destinationPath: path.join(UI_ROOT_PATH, 'ts', 'shared', 'deploymentAddresses.js'),
		fileContents: "export * from '../../../shared/js/deploymentAddresses.js'\n",
	},
]

function getErrorCode(error: unknown) {
	return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

const copyArtifact = async (sourcePath: string, destinationPath: string) => {
	try {
		await fs.access(sourcePath)
	} catch (error) {
		if (getErrorCode(error) === 'ENOENT') {
			throw new Error(`Missing shared build artifact at ${sourcePath}. Run \`bun run shared:build\` before mirroring UI shared assets.`)
		}
		throw error
	}

	await fs.mkdir(path.dirname(destinationPath), { recursive: true })
	await fs.copyFile(sourcePath, destinationPath)
}

const writeArtifact = async (destinationPath: string, fileContents: string) => {
	await fs.mkdir(path.dirname(destinationPath), { recursive: true })
	await fs.writeFile(destinationPath, fileContents)
}

const mirrorSharedArtifacts = async () => {
	for (const { sourcePath, destinationPath } of sharedArtifactCopyPaths) {
		await copyArtifact(sourcePath, destinationPath)
	}
	for (const { destinationPath, fileContents } of sharedSourceShimFiles) {
		await writeArtifact(destinationPath, fileContents)
	}
}

mirrorSharedArtifacts().catch(error => {
	console.error(error)
	process.exit(1)
})
