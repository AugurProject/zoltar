/** OKLCH to sRGB (0–1 channels), using the CSS Color 4 Oklab conversion matrices.
 * Out-of-gamut channels remain out of range so callers can reduce chroma before encoding.
 * https://www.w3.org/TR/css-color-4/#color-conversion-code
 */
export function oklchToSrgb(lightness: number, chroma: number, hue: number) {
	const radians = (hue * Math.PI) / 180
	const a = chroma * Math.cos(radians)
	const b = chroma * Math.sin(radians)
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
	const encode = (channel: number) => {
		const absolute = Math.abs(channel)
		return Math.sign(channel) * (absolute <= 0.0031308 ? 12.92 * absolute : 1.055 * absolute ** (1 / 2.4) - 0.055)
	}
	return [encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]
}
