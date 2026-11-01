// 플레이어 조종석 경고음 상태. 바뀔 때만 AudioService.setTone 을 부른다.
import type { AudioService, ToneId } from '../../core/services';

export const AVIONICS_TONES: readonly ToneId[] = [
  'ir_search',
  'ir_lock',
  'radar_lock',
  'rwr_search',
  'rwr_lock',
  'missile_launch',
  'missile_incoming',
];

export class CockpitTones {
  private readonly on = new Map<ToneId, boolean>();

  set(audio: AudioService, id: ToneId, value: boolean): void {
    if ((this.on.get(id) ?? false) === value) return;
    this.on.set(id, value);
    audio.setTone(id, value);
  }

  isOn(id: ToneId): boolean {
    return this.on.get(id) ?? false;
  }

  silence(audio: AudioService): void {
    for (const id of AVIONICS_TONES) this.set(audio, id, false);
  }
}
