






export const objectEntries = <T extends object>(obj: T) => Object.entries(obj) as [string, T[keyof T & string]][]
