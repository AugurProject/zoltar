import path from 'node:path'

export const resolvePackageRoot = async (repositoryRoot: string, packageDirectory: string): Promise<string> => {
	const packageRoot = path.resolve(repositoryRoot, packageDirectory)
	if (path.relative(repositoryRoot, packageRoot).startsWith('..')) throw new Error(`Package directory escapes the repository: ${packageDirectory}`)
	if (!(await Bun.file(path.join(packageRoot, 'package.json')).exists())) throw new Error(`Package directory has no package.json: ${packageDirectory}`)
	return packageRoot
}

if (import.meta.main) {
	const [packageDirectory, scriptName, ...scriptArguments] = process.argv.slice(2)
	if (packageDirectory === undefined || scriptName === undefined) throw new Error('Usage: run-package-script.mts <package-directory> <script> [...arguments]')

	const repositoryRoot = path.resolve(import.meta.dir, '..')
	const packageRoot = await resolvePackageRoot(repositoryRoot, packageDirectory)
	const child = Bun.spawn({
		cmd: [process.execPath, 'run', scriptName, ...scriptArguments],
		cwd: packageRoot,
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
	})
	process.exit(await child.exited)
}
