import { afterEach, describe, expect, it, vi } from 'vitest';
import { initModel } from './client';

function okResponse(): Response {
    return new Response(JSON.stringify({ message: 'ok' }), { status: 200 });
}

function postedBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string);
}

describe('initModel', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts the chosen spawn interval as the /init body', async () => {
        const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
        vi.stubGlobal('fetch', fetchMock);
        await initModel({ spawnInterval: 3 });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url.endsWith('init')).toBe(true);
        expect(init.method).toBe('POST');
        expect(postedBody(fetchMock)).toEqual({ spawnInterval: 3 });
    });

    it('posts an empty object so the server keeps its defaults', async () => {
        const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
        vi.stubGlobal('fetch', fetchMock);
        await initModel();
        expect(postedBody(fetchMock)).toEqual({});
    });
});
