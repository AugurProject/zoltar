/** An account has deployed code when `eth_getCode` returned bytes other than the empty `0x`. */
export function hasCode<T extends string>(code: T | undefined): code is T {
	return code !== undefined && code !== '0x'
}
