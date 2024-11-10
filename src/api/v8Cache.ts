import { access, readFile, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { log } from '../lib/logger'; // Assuming logger.js is a TypeScript file or has a declaration file

interface CompilationCacheEntry {
  url: string;
  data: any; // Replace 'any' with the specific type of data if known
}

export default async (
  CDP: {
    on: (event: string, listener: (data: any) => void, once?: boolean) => void; // Replace 'any' with the specific event data type if known
    send: (method: string, params?: any) => Promise<any>;
  },
  evaluate: (expression: string) => Promise<any>,
  { browserType, dataPath }: { browserType: string; dataPath: string }
) => {
  if (browserType !== 'chromium') {
    // current implementation is for chromium-based only
    const warning = () => log(`Warning: V8 Cache API is only for Chromium (running on ${browserType})`);

    // TODO: fix any
    return {
      build: () => (warning() as any) || {},
      load: () => (warning() as any) || false,
      exists: () => (warning() as any) || false,
    };
  }

  const getDefaultPath = () => join(dataPath, 'v8Cache.json');
  const getScriptUrls = async (includePreload = true) =>
    (
      await evaluate(
        `[...document.querySelectorAll('script[src]${
          includePreload ? ', link[as=script]' : ''
        }')].map(x => x.src ?? x.href).join(';')`
      )
    ).split(';');

  const build = async ({
    path = getDefaultPath(),
    eager = true,
    urls = [],
    reload = true,
    includePreload = true,
    finishOnLoad = true,
  } = {}) => {
    const startTime = performance.now();

    log('v8Cache: beginning cache build...');
    urls ??= await getScriptUrls(includePreload);

    log(`v8Cache: found ${urls.length} scripts`);

    const cache = await new Promise<CompilationCacheEntry[]>(async (resolve) => {
      let produced: CompilationCacheEntry[] = [];
      let done = false;

      const unhook = CDP.on('Page.compilationCacheProduced', ({ params: { url, data } }) => {
        produced.push({ url, data });

        process.stdout.write(`v8Cache: caching... (${produced.length}/${urls.length})\r`);

        if (produced.length >= urls.length) {
          done = true;
          // @ts-ignore
          unhook();
          resolve(produced);
        }
      });

      await CDP.send('Page.produceCompilationCache', {
        scripts: urls.map((url) => ({ url, eager })),
      });

      if (reload) {
        if (finishOnLoad)
          CDP.on(
            'Page.frameStoppedLoading',
            async () => {
              await new Promise((res) => setTimeout(res, 2000));
              if (done) return;

              log('v8Cache: forcing caching to end early as loading is done');

              // @ts-ignore
              unhook();
              resolve(produced);
            },
            true
          );

        log('v8Cache: reloading to force script loads...');
        await CDP.send('Page.reload');
      }

      process.stdout.write(`v8Cache: starting cache...\r`);
    });

    log(`v8Cache: cached ${cache.length}/${urls.length} scripts in ${(performance.now() - startTime).toFixed(2)}ms`);

    const raw = JSON.stringify(cache, null, 2);
    await writeFile(path, raw);

    log(
      `v8Cache: saved to .../${path.split(sep).slice(-3).join('/')} (${(
        Buffer.byteLength(raw, 'utf8') /
        1024 /
        1024
      ).toFixed(2)}MB)`
    );
  };

  const exists = (path = getDefaultPath()) =>
    access(path)
      .then(() => true)
      .catch(() => false);

  const load = async (path = getDefaultPath()) => {
    if (!(await exists(path))) return false;
    const startTime = performance.now();

    const cache = JSON.parse(await readFile(path, 'utf8'));

    for (const entry of cache) {
      CDP.send('Page.addCompilationCache', entry);
    }

    log(`v8Cache: loaded ${cache.length} scripts in ${(performance.now() - startTime).toFixed(2)}ms`);

    return true;
  };

  // try to load default ASAP in background
  load();

  return {
    build,
    load,
    exists,
  };
};
