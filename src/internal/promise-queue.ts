export class PromiseQueue {
  #queue: Array<() => Promise<void>> = [];
  #isRunning = false;

  push(fn: () => Promise<void>) {
    this.#queue.push(fn);
    void this.#run();
  }

  get size() {
    return this.#queue.length;
  }

  async #run() {
    if (this.#isRunning) return;
    this.#isRunning = true;

    while (this.#queue.length > 0) {
      const job = this.#queue.shift();
      if (!job) continue;
      try {
        await job();
      } catch (err) {
        console.error('PromiseQueue error:', err);
      }
    }

    this.#isRunning = false;
  }
}
