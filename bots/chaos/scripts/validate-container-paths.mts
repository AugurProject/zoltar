#!/usr/bin/env bun

import { lstat, mkdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

function requiredString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
	return value
}

function containedPath(root: string, candidate: string, label: string) {
	const resolved = resolve(candidate)
	const relation = relative(root, resolved)
	if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`)) {
		throw new Error(`${label} must be a file or directory below the persistent ${root} directory`)
	}
	return resolved
}

async function assertExistingPathComponentsAreRealDirectories(root: string, targetDirectory: string, label: string) {
	const relation = relative(root, targetDirectory)
	let current = root
	for (const component of relation.split(sep).filter(Boolean)) {
		current = resolve(current, component)
		try {
			const metadata = await lstat(current)
			if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`${label} traverses ${current}, which is not a real directory`)
		} catch (error) {
			if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return
			throw error
		}
	}
}

export async function validateContainerPaths(settingsPath: string, stateRootPath = '.state', signerLockRootPath = process.env['ZOLTAR_BOT_SIGNER_LOCK_ROOT'] ?? '') {
	const stateRoot = resolve(stateRootPath)
	const settings: unknown = JSON.parse(await readFile(settingsPath, 'utf8'))
	if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new Error('chaos settings must be a JSON object')
	const runtime = Reflect.get(settings, 'runtime')
	if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) throw new Error('chaos settings runtime must be a JSON object')
	const stateFile = containedPath(stateRoot, requiredString(Reflect.get(runtime, 'stateFile'), 'runtime.stateFile'), 'runtime.stateFile')
	await assertExistingPathComponentsAreRealDirectories(stateRoot, dirname(stateFile), 'runtime.stateFile')

	if (process.env['ZOLTAR_BOT_CONTAINER'] === 'true' && signerLockRootPath === '') {
		throw new Error('live-capable container packaging requires ZOLTAR_BOT_SIGNER_LOCK_ROOT in the persistent state volume')
	}
	if (signerLockRootPath !== '') {
		const lockRoot = containedPath(stateRoot, signerLockRootPath, 'ZOLTAR_BOT_SIGNER_LOCK_ROOT')
		await assertExistingPathComponentsAreRealDirectories(stateRoot, dirname(lockRoot), 'ZOLTAR_BOT_SIGNER_LOCK_ROOT')
		await mkdir(lockRoot, { mode: 0o700, recursive: true })
		const metadata = await lstat(lockRoot)
		if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('ZOLTAR_BOT_SIGNER_LOCK_ROOT must be a real directory')
		if ((metadata.mode & 0o7777) !== 0o700) throw new Error('ZOLTAR_BOT_SIGNER_LOCK_ROOT must have mode 0700')
	}
	return { signerLockRoot: signerLockRootPath === '' ? undefined : resolve(signerLockRootPath), stateFile, stateRoot }
}

if (import.meta.main) {
	const settingsPath = process.argv[2]
	if (settingsPath === undefined) throw new Error('Usage: validate-container-paths.mts <settings-file>')
	await validateContainerPaths(settingsPath)
}
