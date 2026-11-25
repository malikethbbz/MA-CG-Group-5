/*
 * Synthesized sirens with the Web Audio API, no sound files. Each voice is an
 * oscillator whose pitch is swept by a low-frequency oscillator:
 *   wail (ambulance): a slow sine sweep up and down
 *   yelp (police):    a square LFO, so the pitch jumps hi-lo
 * Off by default; the AudioContext is only created from the GUI toggle, a user
 * gesture, so browsers allow it to play.
 */

import type { SirenVoice } from '../world/siren';
import { SILENT, type VoiceGains } from './siren_mix';

interface VoiceSound {
    readonly carrier: OscillatorType;
    readonly baseHz: number;
    readonly sweepHz: number;
    readonly lfo: OscillatorType;
    readonly lfoHz: number;
}

const VOICES: Readonly<Record<SirenVoice, VoiceSound>> = {
    wail: { carrier: 'triangle', baseHz: 900, sweepHz: 420, lfo: 'sine', lfoHz: 0.22 },
    yelp: { carrier: 'square', baseHz: 820, sweepHz: 160, lfo: 'square', lfoHz: 1.6 },
};

// Seconds for a gain change to settle, so volume follows the camera without clicks
const GAIN_SMOOTHING = 0.15;
// Takes the edge off the square wave
const LOWPASS_HZ = 2200;

function startVoice(context: AudioContext, sound: VoiceSound, out: AudioNode): GainNode {
    const carrier = context.createOscillator();
    carrier.type = sound.carrier;
    carrier.frequency.value = sound.baseHz;
    const lfo = context.createOscillator();
    lfo.type = sound.lfo;
    lfo.frequency.value = sound.lfoHz;
    const depth = context.createGain();
    depth.gain.value = sound.sweepHz;
    lfo.connect(depth).connect(carrier.frequency);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = LOWPASS_HZ;
    const volume = context.createGain();
    volume.gain.value = 0;
    carrier.connect(filter).connect(volume).connect(out);
    carrier.start();
    lfo.start();
    return volume;
}

export class SirenAudio {
    private context: AudioContext | null = null;
    private volumes: Record<SirenVoice, GainNode> | null = null;
    private enabled = false;

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (enabled) {
            this.start().catch((error: unknown) => console.error('Could not start the siren audio:', error));
        } else {
            this.context?.suspend().catch((error: unknown) => console.error('Could not pause the siren audio:', error));
        }
    }

    // Called every animation frame; cheap when the sound is off.
    update(gains: VoiceGains): void {
        if (!this.context || !this.volumes) {
            return;
        }
        const target = this.enabled ? gains : SILENT;
        const now = this.context.currentTime;
        for (const voice of Object.keys(this.volumes) as SirenVoice[]) {
            this.volumes[voice].gain.setTargetAtTime(target[voice], now, GAIN_SMOOTHING);
        }
    }

    private async start(): Promise<void> {
        if (!this.context) {
            const context = new AudioContext();
            this.volumes = {
                wail: startVoice(context, VOICES.wail, context.destination),
                yelp: startVoice(context, VOICES.yelp, context.destination),
            };
            this.context = context;
        }
        await this.context.resume();
    }
}
