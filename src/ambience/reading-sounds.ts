import { useEffect, useRef } from "react";

let context: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
const pageVoices = new Set<AudioBufferSourceNode>();
function audioContext() {
  return (context ??= new AudioContext());
}
function recording(name: string) {
  let pending = buffers.get(name);
  if (!pending) {
    pending = fetch(`/audio/${name}`).then(async (response) => {
      if (!response.ok) throw new Error("音效无法加载");
      const decoded = await audioContext().decodeAudioData(
        await response.arrayBuffer(),
      );
      if (name !== "rain.ogg" || decoded.duration <= 30) return decoded;
      const excerpt = audioContext().createBuffer(
        decoded.numberOfChannels,
        Math.floor(decoded.sampleRate * 30),
        decoded.sampleRate,
      );
      for (let channel = 0; channel < excerpt.numberOfChannels; channel++)
        excerpt.copyToChannel(
          decoded.getChannelData(channel).subarray(0, excerpt.length),
          channel,
        );
      return excerpt;
    });
    buffers.set(name, pending);
    void pending.catch(() => buffers.delete(name));
  }
  return pending;
}

/** Real paper, decoded once. Two voices at most, independent of navigation. */
export function playPageSound() {
  try {
    const audio = audioContext();
    void Promise.all([audio.resume(), recording("page-turn.wav")])
      .then(([, buffer]) => {
        if (pageVoices.size >= 2) pageVoices.values().next().value?.stop();
        const source = audio.createBufferSource(),
          gain = audio.createGain();
        source.buffer = buffer;
        gain.gain.value = 0.45;
        source.connect(gain).connect(audio.destination);
        pageVoices.add(source);
        source.onended = () => {
          pageVoices.delete(source);
          source.disconnect();
          gain.disconnect();
        };
        source.start();
      })
      .catch(() => {});
  } catch {
    /* Audio may be unavailable; reading still works. */
  }
}

/** Crossfade a real rain recording rather than repeating a hard audio seam. */
export function useRainSound(
  enabled: boolean,
  volume: number,
  fail: (error: unknown) => void,
) {
  const output = useRef<GainNode>(null);
  const level = useRef(volume);
  level.current = volume;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const voices = new Set<AudioBufferSourceNode>();
    let audio: AudioContext;
    let gain: GainNode;
    try {
      audio = audioContext();
      gain = audio.createGain();
      gain.gain.value = level.current * 0.65;
      gain.connect(audio.destination);
      output.current = gain;
      void Promise.all([audio.resume(), recording("rain.ogg")])
        .then(([, buffer]) => {
          if (stopped) return;
          // A 30-second excerpt keeps scheduling and memory bounded; the file is
          // the author's original recording, retained with its licence notice.
          const length = Math.min(30, buffer.duration),
            fade = Math.min(2, length / 4);
          let when = audio.currentTime + 0.05;
          const schedule = () => {
            if (stopped) return;
            if (when < audio.currentTime) when = audio.currentTime + 0.05;
            while (when < audio.currentTime + 2) {
              const source = audio.createBufferSource(),
                envelope = audio.createGain();
              source.buffer = buffer;
              source.connect(envelope).connect(gain);
              envelope.gain.setValueAtTime(0, when);
              envelope.gain.linearRampToValueAtTime(1, when + fade);
              envelope.gain.setValueAtTime(1, when + length - fade);
              envelope.gain.linearRampToValueAtTime(0, when + length);
              voices.add(source);
              source.onended = () => {
                voices.delete(source);
                source.disconnect();
                envelope.disconnect();
              };
              source.start(when, 0, length);
              when += length - fade;
            }
            timer = setTimeout(schedule, 1000);
          };
          schedule();
        })
        .catch((error) => {
          if (!stopped) fail(error);
        });
    } catch (error) {
      fail(error);
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
      output.current = null;
      voices.forEach((source) => source.stop());
      gain?.disconnect();
    };
  }, [enabled, fail]);
  useEffect(() => {
    if (output.current)
      output.current.gain.setTargetAtTime(
        volume * 0.65,
        output.current.context.currentTime,
        0.15,
      );
  }, [volume]);
}
