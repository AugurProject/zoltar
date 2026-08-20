const eventSource = new EventSource('/__live-reload')

eventSource.addEventListener('reload', () => {
	window.location.reload()
})
