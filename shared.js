function normalizePageUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        url.hash = "";
        return url.toString();
    } catch (err) {
        console.error("Failed to normalize URL", rawUrl, err);
        return null;
    }
}

globalThis.normalizePageUrl = normalizePageUrl;
