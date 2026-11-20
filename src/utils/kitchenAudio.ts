// Web Audio API synthesizer for the "Comandas Digitales" tablet bell chime

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

/**
 * Unlocks AudioContext on user gesture (entering "Comandas Digitales" fullscreen).
 */
export async function unlockKitchenAudio(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch {
    // Ignore audio unlock errors when browser restricts autoplay
  }
}

/**
 * Plays a crisp, pleasant two-tone service bell chime when a new comanda arrives.
 */
export function playKitchenBellChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    const triggerTone = (freq: number, startOffset: number, duration: number, peakGain: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + startOffset);

      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    // Classic pleasant restaurant pass bell: Ding-Dong (C6 -> G5 harmonic chime)
    triggerTone(1046.5, 0, 0.35, 0.25);
    triggerTone(783.99, 0.16, 0.55, 0.22);
  } catch {
    // Silent fallback if audio playback fails
  }
}
