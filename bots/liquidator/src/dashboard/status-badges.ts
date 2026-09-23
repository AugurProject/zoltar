export function activityBadgeClass(status: string) {
	if (status === 'failed') return 'error'
	if (status === 'dry-run') return 'info'
	if (status === 'pending') return 'warning'
	return status === 'confirmed' ? 'success' : ''
}
