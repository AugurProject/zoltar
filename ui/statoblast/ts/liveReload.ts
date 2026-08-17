const SHOULD_ENABLE_LIVE_RELOAD = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && typeof EventSource !== 'undefined'

if (SHOULD_ENABLE_LIVE_RELOAD) {
	const reloadEvents = new EventSource('/__live-reload')

	reloadEvents.addEventListener('reload', () => {
		window.location.reload()
	})
}
