export async function buildDashboardScript(entrypoint: string) {
	const result = await Bun.build({ entrypoints: [entrypoint], target: 'browser' })
	const output = result.outputs[0]
	if (!result.success || output === undefined) throw new Error(`Unable to build dashboard: ${result.logs.map(log => log.message).join('; ')}`)
	return await output.text()
}
