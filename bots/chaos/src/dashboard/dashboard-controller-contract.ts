export type ChaosDashboardController = {
	getDeploymentArchives?: (() => unknown | Promise<unknown>) | undefined
	setDeploymentArchive?: ((value: unknown) => unknown | Promise<unknown>) | undefined
	getConfigurationDocument?: (() => unknown | Promise<unknown>) | undefined
	setConfigurationDocument?: ((value: unknown) => unknown | Promise<unknown>) | undefined
	getConfiguration: () => unknown | Promise<unknown>
	getState: () => unknown | Promise<unknown>
	hostname: '0.0.0.0' | '127.0.0.1'
	loopbackPublished?: boolean
	setCancellation: (value: unknown) => unknown | Promise<unknown>
	setCandidate: (value: unknown) => unknown | Promise<unknown>
	setConnectivity?: ((value: unknown) => unknown | Promise<unknown>) | undefined
	setExecution?: ((value: unknown) => unknown | Promise<unknown>) | undefined
	setOperation?: ((value: unknown) => unknown | Promise<unknown>) | undefined
	setObligation: (value: unknown) => unknown | Promise<unknown>
	setReplacement: (value: unknown) => unknown | Promise<unknown>
	setPaused: (value: unknown) => unknown | Promise<unknown>
	setRetirement?: ((value: unknown) => unknown | Promise<unknown>) | undefined
	setSchedule?: ((value: unknown) => unknown | Promise<unknown>) | undefined
	setSelection?: ((value: unknown) => unknown | Promise<unknown>) | undefined
	setSettings: (value: unknown) => unknown | Promise<unknown>
	setSigner: (value: unknown) => unknown | Promise<unknown>
	setWorkflow: (value: unknown) => unknown | Promise<unknown>
}
