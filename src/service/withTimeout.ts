/** Resolves to `undefined` on rejection *or* on timeout, unifying both into the same
 * degradation path — OandaClient (and any other bare fetch-based client) has no timeout of
 * its own, so a hung request would otherwise never settle and block whatever awaits it. */
export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(undefined); },
    );
  });
