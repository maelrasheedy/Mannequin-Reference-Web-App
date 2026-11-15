// Compress/minify app bundle and images metadata JSON for delivery size under ~7MB
const KEY_MAP = {
    id: "i",
    name: "n",
    type: "t",
    width: "w",
    height: "h",
    size: "s",
    path: "p",
    url: "u",
    format: "f",
    images: "img",
    thumbnail: "th",
    metadata: "m"
};

const REVERSE_KEY_MAP = Object.fromEntries(
    Object.entries(KEY_MAP).map(([key, value]) => [
        value,
        key
    ])
);

// Compress metadata recursively.
function compressObject(value) {
    if (Array.isArray(value)) {
        return value.map(compressObject);
    }

    if (value && typeof value === "object") {
        const result = {};

        for (const [key, val] of Object.entries(value)) {
            if (val === null || val === undefined) continue;

            const compressedKey = KEY_MAP[key] || key;

            if (Object.hasOwn(result, compressedKey)) {
                throw new Error(
                    `Compression key collision: ${compressedKey}`
                );
            }

            result[compressedKey] = compressObject(val);
        }

        return result;
    }

    return value;
}

// Restore metadata recursively.
function decompressObject(value) {
    if (Array.isArray(value)) {
        return value.map(decompressObject);
    }

    if (value && typeof value === "object") {
        const result = {};

        for (const [key, val] of Object.entries(value)) {
            const originalKey = REVERSE_KEY_MAP[key] || key;
            result[originalKey] = decompressObject(val);
        }

        return result;
    }

    return value;
}

// Compress metadata into JSON.
export function compressMetadata(metadata) {
    return JSON.stringify(compressObject(metadata));
}

// Restore original metadata.
export function decompressMetadata(compressedJson) {
    return decompressObject(JSON.parse(compressedJson));
}

// Browser-compatible size calculation.
export function getCompressedSize(metadata) {
    const compressed = compressMetadata(metadata);

    return new TextEncoder().encode(compressed).length;
}

// Check delivery budget.
export function isWithinBudget(
    metadata,
    budgetBytes = 7 * 1024 * 1024
) {
    return getCompressedSize(metadata) <= budgetBytes;
}

// Return compression statistics.
export function getCompressionStats(metadata) {
    const original = JSON.stringify(metadata);
    const compressed = compressMetadata(metadata);

    const originalSize = new TextEncoder().encode(original).length;
    const compressedSize = new TextEncoder().encode(compressed).length;

    return {
        originalSize,
        compressedSize,
        savedBytes: originalSize - compressedSize,
        reductionPercent:
            originalSize === 0
                ? 0
                : ((originalSize - compressedSize) / originalSize) * 100,
        withinBudget: compressedSize <= 7 * 1024 * 1024
    };
}
