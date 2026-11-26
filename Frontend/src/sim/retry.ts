/*
 * Runs a task until it succeeds, reporting each failure. Used for the start-up
 * requests so a page opened before the server is up connects once it is. A failure
 * that `isRetryable` rejects (e.g. the server refused the request) is thrown instead.
 */

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryUntilOk<T>(
    task: () => Promise<T>,
    onError: (error: unknown, attempt: number) => void,
    delayMs: number,
    sleep: Sleep = defaultSleep,
    isRetryable: (error: unknown) => boolean = () => true,
): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await task();
        } catch (error) {
            if (!isRetryable(error)) {
                throw error;
            }
            onError(error, attempt);
            await sleep(delayMs);
        }
    }
}
