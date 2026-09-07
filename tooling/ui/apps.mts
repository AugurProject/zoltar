import { getUiAppDependencyOrder, getUiAppPaths, parseUiAppId, UI_APP_IDS, type UiAppId } from './appPaths.mts'

export function getAppBuildCommands(appIds: readonly UiAppId[]): readonly string[][] {
	const packages = [...new Set(appIds.flatMap(getUiAppDependencyOrder))]
	return [['run', 'ensure-contract-artifacts'], ...appIds.map(appId => ['./tooling/ui/vendor.mts', appId]), ...packages.map(packageId => ['x', 'tsc', '--project', `ui/${packageId}/tsconfig.json`]), ...appIds.map(appId => ['./tooling/ui/workers.mts', appId, '--artifacts-current'])]
}

if (import.meta.main) {
	const appIds = process.argv[2] === undefined ? UI_APP_IDS : [parseUiAppId(process.argv[2], 'application build')]
	const { repositoryRoot } = getUiAppPaths(appIds[0] ?? 'zoltar')
	for (const args of getAppBuildCommands(appIds)) {
		const child = Bun.spawn([process.execPath, ...args], { cwd: repositoryRoot, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' })
		const exitCode = await child.exited
		if (exitCode !== 0) process.exit(exitCode)
	}
}
