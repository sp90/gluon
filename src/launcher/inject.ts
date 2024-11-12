import IPCApi from '../lib/ipc';
import LocalCDP from '../lib/local/cdp';
import { log } from '../lib/logger';

import ControlsApi from '../api/controls';
import IdleApi from '../api/idle';
import PageApi from '../api/page';
import ResourcesApi from '../api/resources';
import V8CacheApi from '../api/v8Cache';
import type { ChildProcess } from '../lib/cdp';

interface BrowserInfo {
  product: string;
  jsVersion: string;
}

export interface CDP {
  sendMessage: (method: string, params?: any, sessionId?: string) => Promise<any>;
  onMessage: (handler: (msg: any) => void) => () => void;
  close: () => void;
}

export interface PublicCDP {
  send: (method: string, params?: any, useSessionId?: boolean) => Promise<any>;
  on: (method: string, handler: (msg: any) => void, once?: boolean) => () => void;
}

export interface WindowOptions {
  dataPath: string;
  browserName: string;
  browserType: string;
  openingLocal: boolean;
  url: string;
  basePath: string;
  allowNavigation: boolean | string;
  localCSP: string;
  closeHandlers: (() => Promise<void>)[];
}

interface VersionInfo {
  name: string;
  version: string;
  major: number;
}

// interface Window {
//   close: () => boolean;
//   closed: boolean;
//   ipc: IPCAPI;
//   versions: {
//     product: VersionInfo;
//     engine: VersionInfo;
//     jsEngine: VersionInfo;
//   };
//   cdp: PublicCDP;
//   page: any; // Replace 'any' with the actual type from PageApi
//   idle: any; // Replace 'any' with the actual type from IdleApi
//   controls: any; // Replace 'any' with the actual type from ControlsApi
//   resources: any; // Replace 'any' with the actual type from ResourcesApi
//   v8Cache: any; // Replace 'any' with the actual type from V8CacheApi
// }

//  Helper function to acquire target with optional filter
const acquireTarget = async (CDP: CDP, filter: (target: any) => boolean = () => true): Promise<string> => {
  log('acquiring target');

  while (true) {
    const targets = (await CDP.sendMessage('Target.getTargets')).targetInfos;
    const target = targets.filter((x: any) => x.type === 'page' && filter(x))[0];

    if (target)
      return (await CDP.sendMessage('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await new Promise((res) => setTimeout(res, 200));
  }
};

//  Helper function to generate version info
const generateVersionInfo = (name: string, version: string): VersionInfo => ({
  name,
  version,
  major: parseInt(version.split('.')[0]),
});

//  Helper function to evaluate code in window
const evalInWindow = async (
  CDP: CDP,
  sessionId: string | undefined,
  expression: string | (() => any)
): Promise<any> => {
  console.log('expression: ', expression);

  const reply = await CDP.sendMessage(`Runtime.evaluate`, {
    expression: typeof expression === 'string' ? expression : `(${expression.toString()})()`,
    sessionId: sessionId,
  });

  if (reply.exceptionDetails) {
    const errorMessage =
      (reply.result?.description?.split(':').slice(1).join(':').trim() ?? reply.exceptionDetails.text) + '\n';
    return new ((global as any)[reply.result?.className] ?? Error)(errorMessage);
  }

  return reply.result?.value ?? reply;
};

export const injectInto = async (
  CDP: CDP,
  proc: ChildProcess,
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
  let pageLoadResolver: () => void;
  let frameLoadResolver: (params?: any) => void;

  const pageLoadPromise = new Promise<void>((resolve, reject) => {
    pageLoadResolver = resolve;
    setTimeout(() => reject(new Error('Page load timeout')), 10000); // 10-second timeout
  });

  const frameLoadPromise = new Promise<void>((resolve, reject) => {
    frameLoadResolver = resolve;
    setTimeout(() => reject(new Error('Frame load timeout')), 10000); // 10-second timeout
  });

  CDP.onMessage(async (msg) => {
    if (msg.method === 'Page.frameStoppedLoading') frameLoadResolver(msg.params);
    if (msg.method === 'Page.loadEventFired') pageLoadResolver();

    if (msg.method === 'Page.frameScheduledNavigation' || msg.method === 'Page.frameNavigated') {
      const newUrl = msg.params?.frame?.url ?? msg.params?.url;

      if (
        allowNavigation === true ||
        (allowNavigation === 'same-origin' && new URL(newUrl).origin === new URL(url).origin) ||
        (allowNavigation === false && newUrl === url) ||
        newUrl === 'about:blank'
      ) {
        return;
      }

      CDP.sendMessage('Page.stopLoading');

      if (msg.method === 'Page.frameNavigated') {
        const history = await CDP.sendMessage('Page.getNavigationHistory');
        const oldUrl = history.entries[history.currentIndex - 1]?.url;
        if (oldUrl) {
          CDP.sendMessage('Page.navigate', { url: oldUrl, frameId: msg.params.frame.id });
        }
      }
    }
  });

  const browserInfo = (await CDP.sendMessage('Browser.getVersion')) as BrowserInfo;
  const sessionId = await acquireTarget(CDP, (target) => target.url !== 'about:blank');

  log('sessionId: ', sessionId);

  await CDP.sendMessage('Runtime.enable');
  await CDP.sendMessage('Page.enable');

  if (openingLocal && browserType === 'chromium' && sessionId) {
    await LocalCDP(CDP, { sessionId, url, basePath, csp: localCSP });
  }

  await Promise.all([pageLoadPromise, frameLoadPromise]).catch((error) => {
    console.error('Error during frame load:', error);
  });

  const cdp = {
    send: (method, params, useSessionId = true) =>
      CDP.sendMessage(method, params, useSessionId ? sessionId : undefined),
    on: (method, handler, once = false) => {
      const unhook = CDP.onMessage((msg) => {
        if (msg.method === method) {
          handler(msg);
          if (once) unhook();
        }
      });
      return unhook;
    },
  } as PublicCDP;

  const page = await PageApi(cdp, (expression) => evalInWindow(CDP, sessionId, expression), { pageLoadPromise });
  const idle = await IdleApi(cdp, { browserType, closeHandlers });
  const controls = await ControlsApi(cdp);
  const resources = await ResourcesApi(cdp);
  const v8Cache = await V8CacheApi(cdp, (expression) => evalInWindow(CDP, sessionId, expression), {
    browserType,
    dataPath,
  });

  let closed = false;
  const Window = {
    close: () => {
      if (closed) return false;
      closeHandlers.forEach((handler) => handler());
      CDP.sendMessage('Browser.close');
      CDP.close();
      proc.kill();
      return (closed = true);
    },
    closed: false,
    versions: {
      product: generateVersionInfo(browserName, browserInfo.product.split('/')[1]),
      engine: generateVersionInfo(browserType, browserInfo.product.split('/')[1]),
      jsEngine: generateVersionInfo(browserType === 'chromium' ? 'v8' : 'spidermonkey', browserInfo.jsVersion),
    },
    ipc: IPCApi({ browserName, browserInfo, browserType }, evalInWindow, CDP, sessionId!, closed),
    cdp,
    page,
    idle,
    controls,
    resources,
    v8Cache,
  };

  proc.on('exit', Window.close);
  proc.on('close', Window.close);
  process.on('exit', Window.close);

  const interruptHandler = () => {
    Window.close();
    process.exit();
  };

  process.on('SIGINT', interruptHandler);
  process.on('SIGUSR1', interruptHandler);
  process.on('SIGUSR2', interruptHandler);
  process.on('SIGTERM', interruptHandler);

  log('finished window');

  return Window ;
};
