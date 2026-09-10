import { printable, throwInternalError } from "@ark/util";
export const writeUnsupportedJsonSchemaTypeMessage = (input) => {
    const normalized = typeof input === "string" ? { description: input } : input;
    let message = `${normalized.description} is not convertible to JSON Schema`;
    if (normalized.reason)
        message += ` because ${normalized.reason}`;
    return message;
};
export const writeJsonSchemaMorphMessage = (description) => writeUnsupportedJsonSchemaTypeMessage({
    description: `Morph ${description}`,
    reason: "it represents a transformation, while JSON Schema only allows validation. Consider creating a Schema from one of its endpoints using `.in` or `.out`."
});
export const writeCyclicJsonSchemaMessage = (description) => writeUnsupportedJsonSchemaTypeMessage({
    description,
    reason: "cyclic types are not yet convertible to JSON Schema. If this feature is important to you, please add your feedback at https://github.com/arktypeio/arktype/issues/1087"
});
export const throwInternalJsonSchemaOperandError = (kind, schema) => throwInternalError(`Unexpected JSON Schema input for ${kind}: ${printable(schema)}`);
