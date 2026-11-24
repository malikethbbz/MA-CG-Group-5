/*
 * Typed client for the frame API (docs/frame-api.md): POST /init, GET /city, GET /step.
 * Every failure becomes an ApiError with a message that can be shown on the page.
 */

import { SERVER_URL } from '../config';
import type { CityData, StepFrame } from './contract';
import { parseCity, parseStep } from './parse';

export class ApiError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

async function serverMessage(response: Response): Promise<string> {
    try {
        const body: unknown = await response.json();
        if (typeof body === 'object' && body !== null && 'message' in body
            && typeof body.message === 'string') {
            return body.message;
        }
    } catch {
        // The body was not JSON; the status line alone describes the failure.
    }
    return response.statusText || 'no details';
}

async function request(endpoint: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(SERVER_URL + endpoint, init);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new ApiError(`Cannot reach the server at ${SERVER_URL} (${reason}).`);
    }
    if (!response.ok) {
        const message = await serverMessage(response);
        throw new ApiError(`/${endpoint} failed with ${response.status}: ${message}`, response.status);
    }
    try {
        return await response.json();
    } catch {
        throw new ApiError(`/${endpoint} did not return JSON.`, response.status);
    }
}

async function parsed<T>(endpoint: string, parse: (v: unknown) => T, init?: RequestInit): Promise<T> {
    const body = await request(endpoint, init);
    try {
        return parse(body);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new ApiError(`/${endpoint}: ${reason}`);
    }
}

// Creates a fresh model on the server with its default map and seed.
export async function initModel(): Promise<void> {
    await request('init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
}

export function fetchCity(): Promise<CityData> {
    return parsed('city', parseCity);
}

export function fetchStep(): Promise<StepFrame> {
    return parsed('step', parseStep);
}
