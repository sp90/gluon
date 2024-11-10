import { log, logInline } from '../lib/logger'; // Assuming logger.ts exists

import IPCApi, { type IPCAPI } from '../lib/ipc'; // Assuming ipc.ts exists
import LocalCDP from '../lib/local/cdp'; // Assuming cdp.ts exists

import ControlsApi from '../api/controls'; // Assuming controls.ts exists
import IdleApi from '../api/idle'; // Assuming idle.ts exists
import PageApi from '../api/page'; // Assuming page.ts exists
import ResourcesApi from '../api/resources'; // Assuming resources.ts exists
import V8CacheApi from '../api/v8Cache'; // Assuming v8Cache.ts exists

interface BrowserInfo {
  product: string;
  jsVersion: string;
}

interface CDP {
  sendMessage: (method: string, params?: any, sessionId?: string) => Promise<any>;
  onMessage: (handler: (msg: any) => void) => () => void;
  close: () => void;
}

export interface WindowOptions {
  dataPath: string;
  browserName: string;
  browserType: string;
  openingLocal: boolean;
  url: string;
  basePath: string;
  allowNavigation: boolean | 'same-origin';
  localCSP: string;
  closeHandlers: (() => Promise<void>)[];
}

interface VersionInfo {
  name: string;
  version: string;
  major: number;
}

interface Window {
  close: () => boolean;
  closed: boolean;
  ipc: IPCAPI;
  versions: {
    product: VersionInfo;
    engine: VersionInfo;
    jsEngine: VersionInfo;
  };
  cdp: {
    send: (method: string, params?: any, useSessionId?: boolean) => Promise<any>;
    on: (method: string, handler: (msg: any) => void, once?: boolean) => () => void;
  };
  page: any; // Replace 'any' with the actual type from PageApi
  idle: any; // Replace 'any' with the actual type from IdleApi
  controls: any; // Replace 'any' with the actual type from ControlsApi
  resources: any; // Replace 'any' with the actual type from ResourcesApi
  v8Cache: any; // Replace 'any' with the actual type from V8CacheApi
}

const acquireTarget = async (CDP: CDP, filter: (target: any) => boolean = () => true): Promise<string> => {
  let target;

  logInline('acquiring target');

  while (!target) {
    process.stdout.write('.');
    // TODO: fix any
    target = (await CDP.sendMessage('Target.getTargets')).targetInfos
      .filter((x: any) => x.type === 'page')
      .filter(filter)[0];
    if (!target) await new Promise((res) => setTimeout(res, 200));
  }

  return (
    await CDP.sendMessage('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })
  ).sessionId;
};

export default async (
  CDP: CDP,
  proc: any, // Replace 'any' with the actual type of 'proc'
  injectionType: 'browser' | 'renderer' = 'browser',
  {
    dataPath,
    browserName,
    browserType,
    openingLocal,
    url,
    basePath,
    allowNavigation,
    localCSP,
    closeHandlers,
  }: WindowOptions
) => {
  // Replace 'any' with the actual type of 'Window'
  let pageLoadCallback: () => void,
    pageLoadPromise = new Promise<void>((res) => (pageLoadCallback = res));
  let frameLoadCallback: (params?: any) => void,
    frameLoadPromise = new Promise<void>((res) => (frameLoadCallback = res));

  CDP.onMessage(async (msg) => {
    if (msg.method === 'Page.frameStoppedLoading') frameLoadCallback(msg.params);
    if (msg.method === 'Page.loadEventFired') pageLoadCallback();
    if (msg.method === 'Runtime.executionContextCreated') {
      try {
        // @ts-ignore
        injectIPC(); // ensure IPC injection again
      } catch {}
    }

    if (msg.method === 'Page.frameScheduledNavigation' || msg.method === 'Page.frameNavigated') {
      let newUrl = msg.params?.frame?.url ?? msg.params?.url;

      if (allowNavigation === true) return; // always allow redirects
      if (allowNavigation === 'same-origin' && new URL(newUrl).origin === new URL(url).origin) return; // only allow if same origin
      if (allowNavigation === false && newUrl === url) return; // only allow if identical open() url
      if (newUrl === 'about:blank') return; // allow blank urls

      CDP.sendMessage('Page.stopLoading');

      if (msg.method === 'Page.frameNavigated') {
        // Page.frameNavigated will never be fired if we intercept the scheduled navigation
        // but Firefox does not support that so this is a fallback

        // load about:blank whilst we do things
        // CDP.sendMessage('Page.navigate', { url: 'about:blank' }, sessionId);

        const history = await CDP.sendMessage('Page.getNavigationHistory');
        let oldUrl = history.entries[history.currentIndex - 1]?.url;
        if (!oldUrl) return;
        // if (oldUrl === 'about:blank') oldUrl = history.entries[history.currentIndex - 2].url;

        CDP.sendMessage('Page.navigate', {
          url: oldUrl,
          frameId: msg.params.frame.id,
        });
      }
    }
  });

  const browserInfo: BrowserInfo = await CDP.sendMessage('Browser.getVersion');
  log('browser:', browserInfo.product);

  let sessionId: string;
  if (injectionType === 'browser') sessionId = await acquireTarget(CDP, (target) => target.url !== 'about:blank');

  await CDP.sendMessage('Runtime.enable'); // enable runtime API
  await CDP.sendMessage('Page.enable'); // enable page API

  // @ts-ignore
  if (openingLocal && browserType === 'chromium') await LocalCDP(CDP, { sessionId, url, basePath, csp: localCSP });

  const evalInWindow = async (func: string | (() => any)): Promise<any> => {
    console.log('evalInWindow');
    // await frameLoadPromise; // wait for page to load before eval, otherwise fail
    const reply = await CDP.sendMessage(`Runtime.evaluate`, {
      expression: typeof func === 'string' ? func : `(${func.toString()})()`,
    });

    console.log('reply: ', reply);

    if (reply.exceptionDetails)
      return new ((global as any)[reply.result?.className] ?? Error)(
        (reply.result?.description?.split(':').slice(1).join(':').trim() ?? reply.exceptionDetails.text) + '\n'
      );

    return reply.result?.value ?? reply;
  };

  const evalOnNewDocument = async (source: string): Promise<() => Promise<void>> => {
    const { identifier } = await CDP.sendMessage('Page.addScriptToEvaluateOnNewDocument', {
      source,
    });

    return async () => {
      await CDP.sendMessage('Page.removeScriptToEvaluateOnNewDocument', {
        identifier,
      });
    };
  };

  const Window = {
    close: () => {
      if (Window.closed) return false;

      for (const handler of closeHandlers) handler(); // extra api handlers which need to be closed

      CDP.sendMessage('Browser.close'); // request graceful close to browser (incase process is not attached)
      CDP.close(); // close CDP connection
      proc.kill(); // kill browser process

      return (Window.closed = true);
    },
    closed: false,
  } as Window;

  // when the process has exited (all windows closed), clean up window internally
  proc.on('exit', () => {
    Window.close();
  });

  // Close window fully internally if browser process closes
  proc.on('close', Window.close);

  // Close browser fully if Node exits
  process.on('exit', Window.close);

  const interruptHandler = () => {
    Window.close();
    process.exit();
  };

  process.on('SIGINT', interruptHandler);
  process.on('SIGUSR1', interruptHandler);
  process.on('SIGUSR2', interruptHandler);
  process.on('SIGTERM', interruptHandler);
  // process.on('uncaughtException', interruptHandler);

  const [injectIPC, IPC] = await IPCApi(
    { browserName, browserInfo, browserType },
    { evalInWindow, evalOnNewDocument },
    CDP,
    // @ts-ignore
    sessionId,
    () => (typeof Window === 'undefined' ? false : Window.closed)
  );
  Window.ipc = IPC;

  // check if already loaded, if so trigger page load promise
  evalInWindow('document.readyState').then((readyState: string) => {
    if (readyState === 'complete' || readyState === 'ready') pageLoadCallback();
    frameLoadCallback();
  });

  const generateVersionInfo = (name: string, version: string) => ({
    name,
    version,
    major: parseInt(version.split('.')[0]),
  });

  Window.versions = {
    product: generateVersionInfo(browserName, browserInfo.product.split('/')[1]),
    engine: generateVersionInfo(browserType, browserInfo.product.split('/')[1]),
    jsEngine: generateVersionInfo(browserType === 'chromium' ? 'v8' : 'spidermonkey', browserInfo.jsVersion),
  };

  Window.cdp = {
    send: (method: string, params?: any, useSessionId = true) =>
      CDP.sendMessage(method, params, useSessionId ? sessionId : undefined),
    on: (method: string, handler: (msg: any) => void, once = false) => {
      const unhook = CDP.onMessage((msg) => {
        if (msg.method === method) {
          handler(msg);
          if (once) unhook();
        }
      });

      return unhook;
    },
  };

  Window.page = await PageApi(Window.cdp, evalInWindow, { pageLoadPromise });
  Window.idle = await IdleApi(Window.cdp, { browserType, closeHandlers });
  Window.controls = await ControlsApi(Window.cdp);
  Window.resources = await ResourcesApi(Window.cdp);
  Window.v8Cache = await V8CacheApi(Window.cdp, evalInWindow, { browserType, dataPath });

  log('finished window');

  return Window;
};
