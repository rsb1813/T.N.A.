// 타입이 지정된 이벤트 버스.
export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends { [K in keyof Events]: unknown }> {
  private map = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    this.map.get(type)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Listener<Events[K]>)(payload);
      } catch (err) {
        console.error(`[events] '${String(type)}' 리스너 오류`, err);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}
