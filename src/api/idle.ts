import { exec } from 'node:child_process';
import type { PublicCDP } from '../launcher/inject';
import { log } from '../lib/logger'; // Assuming logger.js is a TypeScript file or has a declaration file

const killProcesses = async (pids: number[]): Promise<string> =>
  new Promise((resolve) =>
    exec(
      process.platform !== 'win32'
        ? `kill -9 ${pids.join(' ')}`
        : `taskkill /F ${pids.map((x) => `/PID ${x}`).join(' ')}`,
      (e, out) => resolve(out)
    )
  );

interface ProcessInfo {
  id: number;
  type: string;
  // Add other properties of ProcessInfo as needed
}

interface NavigationHistoryEntry {
  url: string;
  // Add other properties of NavigationHistoryEntry as needed
}

interface NavigationHistory {
  currentIndex: number;
  entries: NavigationHistoryEntry[];
  // Add other properties of NavigationHistory as needed
}

interface WindowBounds {
  windowState: string;
  // Add other properties of WindowBounds as needed
}

export default async (
  CDP: PublicCDP,
  { browserType, closeHandlers }: { browserType: string; closeHandlers: (() => void)[] }
) => {
  if (browserType !== 'chromium') {
    // current implementation is for chromium-based only
    const warning = () => log(`Warning: Idle API is currently only for Chromium (running on ${browserType})`);

    return {
      hibernate: warning,
      sleep: warning,
      wake: warning,
      auto: warning,
      freeze: warning, // Add freeze to the returned object
    };
  }

  const killNonCrit = async () => {
    // kill non-critical processes to save memory - crashes chromium internally but not fully
    const procs: { processInfo: ProcessInfo[] } = await CDP.send('SystemInfo.getProcessInfo', {}, false);
    const nonCriticalProcs = procs.processInfo.filter((x) => x.type !== 'browser'); // browser = the actual main chromium binary

    await killProcesses(nonCriticalProcs.map((x) => x.id));
    log(`killed ${nonCriticalProcs.length} processes`);
  };

  const purgeMemory = async () => {
    // purge most memory we can
    await CDP.send('Memory.forciblyPurgeJavaScriptMemory');
    await CDP.send('HeapProfiler.collectGarbage');
  };

  const getScreenshot = async (): Promise<string> => {
    // get a screenshot a webm base64 data url
    const { data } = await CDP.send(`Page.captureScreenshot`, {
      format: 'webp',
    });

    return `data:image/webp;base64,${data}`;
  };

  const getLastUrl = async (): Promise<string> => {
    const history: NavigationHistory = await CDP.send('Page.getNavigationHistory');
    return history.entries[history.currentIndex].url;
  };

  let wakeUrl: string | undefined;
  let hibernating = false;
  let frozen = false;

  const hibernate = async () => {
    // hibernate - crashing chromium internally to save max memory. users will see a crash/gone wrong page but we hopefully "reload" quick enough once visible again for not much notice.
    if (hibernating) return;
    // if (process.platform !== 'win32') return sleep(); // sleep instead - full hibernation is windows only for now due to needing to do native things

    hibernating = true;

    const startTime = performance.now();

    wakeUrl = await getLastUrl();

    purgeMemory();
    await killNonCrit();
    purgeMemory();

    log(`hibernated in ${(performance.now() - startTime).toFixed(2)}ms`);
  };

  const sleep = async () => {
    // light hibernate - instead of killing chromium processes we just navigate to a screenshot of the current page.
    if (hibernating) return;
    hibernating = true;

    const startTime = performance.now();

    wakeUrl = await getLastUrl();

    purgeMemory();

    await CDP.send(`Page.navigate`, {
      url: lastScreenshot,
    });

    purgeMemory();

    log(`slept in ${(performance.now() - startTime).toFixed(2)}ms`);
  };

  const freeze = async () => {
    if (frozen) return;
    frozen = true;

    const startTime = performance.now();

    wakeUrl = await getLastUrl();

    // use web lifecycle state to freeze page
    await CDP.send(`Page.setWebLifecycleState`, {
      state: 'frozen',
    });

    purgeMemory();

    log(`froze in ${(performance.now() - startTime).toFixed(2)}ms`);
  };

  const wake = async () => {
    if (frozen) {
      // update web lifecycle state to unfreeze
      await CDP.send(`Page.setWebLifecycleState`, {
        state: 'active',
      });

      frozen = false;
      return;
    }

    if (!hibernating) return;

    // wake up from hibernation/sleep by navigating to the original page
    const startTime = performance.now();

    await CDP.send('Page.navigate', {
      url: wakeUrl,
    });

    log(`began wake in ${(performance.now() - startTime).toFixed(2)}ms`);

    hibernating = false;
  };

  const { windowId } = await CDP.send('Browser.getWindowForTarget');

  let autoEnabled = process.argv.includes('--force-auto-idle');
  let autoOptions = {
    timeMinimizedToHibernate: 5,
  };

  let autoInterval: Timer | null = null;
  const startAuto = () => {
    if (autoInterval) return; // already started

    let lastState = '';
    let lastStateWhen = performance.now();

    autoInterval = setInterval(async () => {
      const { bounds }: { bounds: WindowBounds } = await CDP.send('Browser.getWindowBounds', { windowId });
      const windowState = bounds.windowState;

      if (windowState !== lastState) {
        lastState = windowState;
        lastStateWhen = performance.now();
      }

      if (
        !hibernating &&
        windowState === 'minimized' &&
        performance.now() - lastStateWhen > autoOptions.timeMinimizedToHibernate * 1000
      )
        await hibernate();
      else if (hibernating && windowState !== 'minimized') await wake();
    }, 200);

    log('started auto idle');
  };

  const stopAuto = () => {
    if (!autoInterval) return; // already stopped

    clearInterval(autoInterval);
    autoInterval = null;

    log('stopped auto idle');
  };

  let lastScreenshot: string | undefined;
  let takingScreenshot = false;
  const screenshotInterval = setInterval(async () => {
    if (takingScreenshot) return;

    takingScreenshot = true;
    lastScreenshot = await getScreenshot();
    takingScreenshot = false;
  }, 10000);

  getScreenshot().then((x) => (lastScreenshot = x));

  closeHandlers.push(() => {
    clearInterval(screenshotInterval);
    stopAuto();
  });

  log(`idle API active (window id: ${windowId})`);
  if (autoEnabled) startAuto();

  return {
    hibernate,
    sleep,
    wake,
    freeze,

    auto: (enabled: boolean, options?: { timeMinimizedToHibernate?: number }) => {
      autoEnabled = enabled;

      autoOptions = {
        ...autoOptions,
        ...options,
      };

      if (enabled) startAuto();
      else stopAuto();
    },
  };
};
