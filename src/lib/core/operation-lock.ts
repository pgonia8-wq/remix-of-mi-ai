// Share a queue across wrappers of the same database; rejected operations never poison it.
const queues = new WeakMap<object, Promise<unknown>>();
export async function exclusive<T>(owner: object, task: () => Promise<T>): Promise<T> {
  const before = queues.get(owner) ?? Promise.resolve();
  const current = before.catch(() => undefined).then(task);
  queues.set(owner, current);
  try { return await current; }
  finally { if (queues.get(owner) === current) queues.delete(owner); }
}