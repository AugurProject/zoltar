import { domainOf } from "./domain.js";
import { serializePrimitive } from "./primitive.js";
import { register } from "./registry.js";
export const snapshot = (data, opts = { onUndefined: "(undefined)" }) => _serialize(data, opts, []);
export const print = (data, indent) => console.log(printable(data, indent));
export const printable = (data, indent) => {
    switch (domainOf(data)) {
        case "object":
            const o = data;
            const ctorName = o.constructor.name;
            return (ctorName === "Object" || ctorName === "Array" ?
                JSON.stringify(_serialize(o, printableOpts, []), null, indent)
                : o instanceof Date ? describeCollapsibleDate(o)
                    : typeof o.expression === "string" ? o.expression
                        : ctorName);
        case "symbol":
            return printableOpts.onSymbol(data);
        default:
            return serializePrimitive(data);
    }
};
const printableOpts = {
    onCycle: () => "(cycle)",
    onSymbol: v => `Symbol(${register(v)})`,
    onFunction: v => `Function(${register(v)})`
};
const _serialize = (data, opts, seen) => {
    switch (domainOf(data)) {
        case "object": {
            if (typeof data === "function")
                return printableOpts.onFunction(data);
            if (seen.includes(data))
                return "(cycle)";
            const nextSeen = [...seen, data];
            if (Array.isArray(data))
                return data.map(item => _serialize(item, opts, nextSeen));
            if (data instanceof Date)
                return data.toDateString();
            const result = {};
            for (const k in data)
                result[k] = _serialize(data[k], opts, nextSeen);
            return result;
        }
        case "symbol":
            return printableOpts.onSymbol(data);
        case "bigint":
            return `${data}n`;
        case "undefined":
            return opts.onUndefined ?? "undefined";
        default:
            return data;
    }
};
/**
 * Converts a Date instance to a human-readable description relative to its precision
 *
 * @param {Date} date
 * @returns {string} - The generated description
 */
export const describeCollapsibleDate = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const dayOfMonth = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const milliseconds = date.getMilliseconds();
    if (month === 0 &&
        dayOfMonth === 1 &&
        hours === 0 &&
        minutes === 0 &&
        seconds === 0 &&
        milliseconds === 0)
        return `${year}`;
    const datePortion = `${months[month]} ${dayOfMonth}, ${year}`;
    if (hours === 0 && minutes === 0 && seconds === 0 && milliseconds === 0)
        return datePortion;
    let timePortion = date.toLocaleTimeString();
    const suffix = timePortion.endsWith(" AM") || timePortion.endsWith(" PM") ?
        timePortion.slice(-3)
        : "";
    if (suffix)
        timePortion = timePortion.slice(0, -suffix.length);
    if (milliseconds)
        timePortion += `.${pad(milliseconds, 3)}`;
    else if (timeWithUnnecessarySeconds.test(timePortion))
        timePortion = timePortion.slice(0, -3);
    return `${timePortion + suffix}, ${datePortion}`;
};
const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
];
const timeWithUnnecessarySeconds = /:\d\d:00$/;
const pad = (value, length) => String(value).padStart(length, "0");
