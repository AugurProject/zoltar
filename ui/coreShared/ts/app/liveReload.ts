type LiveReloadConnection = {
	addEventListener(eventName: 'reload', listener: () => void): void
}

export function installLiveReload({ createEventSource, reload }: { createEventSource: (url: string) => LiveReloadConnection; reload: () => void }) {
	const reloadEvents = createEventSource('/__live-reload')
	reloadEvents.addEventListener('reload', reload)
}

if (typeof EventSource !== 'undefined') {
	installLiveReload({ createEventSource: url => new EventSource(url), reload: () => window.location.reload() })
}
