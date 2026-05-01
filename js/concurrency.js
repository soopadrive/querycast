// Promise queue with concurrency limit. Used to cap the number of in-flight
// RSS fetches so we don't fire 200+ parallel requests when refreshing.

export function createQueue(concurrency = 3) {
  let active = 0;
  const pending = [];

  function next() {
    if (active >= concurrency || pending.length === 0) return;
    const { task, resolve, reject } = pending.shift();
    active += 1;
    Promise.resolve()
      .then(task)
      .then(
        (value) => {
          active -= 1;
          resolve(value);
          next();
        },
        (err) => {
          active -= 1;
          reject(err);
          next();
        }
      );
  }

  return {
    add(task) {
      return new Promise((resolve, reject) => {
        pending.push({ task, resolve, reject });
        next();
      });
    },
  };
}
