export function dashboardHeaders(contentType: string) {
	return {
		'cache-control': 'no-store',
		'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
		'content-type': contentType,
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
	}
}

export function dashboardJson(value: unknown, status = 200, responseHeaders = dashboardHeaders('application/json; charset=utf-8')) {
	return Response.json(value, {
		headers: responseHeaders,
		status,
	})
}

export function closingDashboardJson(value: unknown) {
	return Response.json(value, { headers: { ...dashboardHeaders('application/json; charset=utf-8'), connection: 'close' } })
}
