const DB_NAME = "quicksilver";
const DB_VERSION = 1;
const RUNTIME_STATE_STORE = "runtime_state";
const DETECTION_HISTORY_STORE = "detection_history";
const LATEST_DETECTION_STORE = "latest_detection_by_url";
const ACTIVE_CAPTURE_KEY = "activeCaptureSession";

let databasePromise;

export async function getActiveCaptureSession() {
    const db = await getDatabase();
    return requestToPromise(
        db.transaction(RUNTIME_STATE_STORE, "readonly")
            .objectStore(RUNTIME_STATE_STORE)
            .get(ACTIVE_CAPTURE_KEY)
    ).then((record) => record?.value ?? null);
}

export async function setActiveCaptureSession(session) {
    const db = await getDatabase();
    const transaction = db.transaction(RUNTIME_STATE_STORE, "readwrite");
    transaction.objectStore(RUNTIME_STATE_STORE).put({
        key: ACTIVE_CAPTURE_KEY,
        value: session
    });
    await transactionToPromise(transaction);
}

export async function clearActiveCaptureSession() {
    const db = await getDatabase();
    const transaction = db.transaction(RUNTIME_STATE_STORE, "readwrite");
    transaction.objectStore(RUNTIME_STATE_STORE).delete(ACTIVE_CAPTURE_KEY);
    await transactionToPromise(transaction);
}

export async function appendDetectionHistory(entry) {
    const db = await getDatabase();
    const transaction = db.transaction(
        [DETECTION_HISTORY_STORE, LATEST_DETECTION_STORE],
        "readwrite"
    );

    transaction.objectStore(DETECTION_HISTORY_STORE).put(entry);
    transaction.objectStore(LATEST_DETECTION_STORE).put(entry);

    await transactionToPromise(transaction);
}

export async function getLatestDetectionForUrl(normalizedUrl) {
    if (!normalizedUrl) {
        return null;
    }

    const db = await getDatabase();
    return requestToPromise(
        db.transaction(LATEST_DETECTION_STORE, "readonly")
            .objectStore(LATEST_DETECTION_STORE)
            .get(normalizedUrl)
    ).then((record) => record ?? null);
}

export async function getDetectionHistoryForUrl(normalizedUrl) {
    if (!normalizedUrl) {
        return [];
    }

    const db = await getDatabase();
    const index = db.transaction(DETECTION_HISTORY_STORE, "readonly")
        .objectStore(DETECTION_HISTORY_STORE)
        .index("by_url_and_completed_at");
    const range = IDBKeyRange.bound(
        [normalizedUrl, 0],
        [normalizedUrl, Number.MAX_SAFE_INTEGER]
    );

    return requestToPromise(index.getAll(range)).then((records) =>
        records.sort((left, right) => right.completedAt - left.completedAt)
    );
}

async function getDatabase() {
    if (!databasePromise) {
        databasePromise = openDatabase();
    }

    return databasePromise;
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;

            if (!db.objectStoreNames.contains(RUNTIME_STATE_STORE)) {
                db.createObjectStore(RUNTIME_STATE_STORE, { keyPath: "key" });
            }

            if (!db.objectStoreNames.contains(DETECTION_HISTORY_STORE)) {
                const historyStore = db.createObjectStore(DETECTION_HISTORY_STORE, {
                    keyPath: "sessionId"
                });
                historyStore.createIndex(
                    "by_url_and_completed_at",
                    ["normalizedUrl", "completedAt"]
                );
            }

            if (!db.objectStoreNames.contains(LATEST_DETECTION_STORE)) {
                db.createObjectStore(LATEST_DETECTION_STORE, {
                    keyPath: "normalizedUrl"
                });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
    });
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
}

function transactionToPromise(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    });
}
