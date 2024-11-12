import { dirname, extname, isAbsolute, join } from 'node:path';
import { dangerousAPI, log } from './lib/logger'; // Assuming logger.ts exists

import Chromium, { type BrowserOptions } from './browser/chromium'; // Assuming chromium.ts exists

import * as ExtensionsAPI from './extensions'; // Assuming extensions.ts exists
import type { WindowOptions } from './launcher/inject';
import { findBrowserPath, getBrowserType } from './lib/browserPaths'; // Assuming browserPaths.ts exists
import LocalHTTP from './lib/local/http'; // Assuming http.ts exists

declare global {
  interface ProcessVersions {
    gluon: string;
  }
}

process.versions.gluon = '0.15.0-bun-dev';

const __dirname = new URL('.', import.meta.url).pathname; // Use URL object for __dirname

const getFriendlyName = (whichBrowser: string): string =>
  whichBrowser[0].toUpperCase() + whichBrowser.slice(1).replace(/[a-z]_[a-z]/g, (_) => _[0] + ' ' + _[2].toUpperCase());

const ranJsDir = !process.argv[1] ? __dirname : extname(process.argv[1]) ? dirname(process.argv[1]) : process.argv[1];
const getDataPath = (browser: string): string => join(ranJsDir, 'gluon_data', browser, Date.now().toString());

const portRange = [10000, 60000];
const generatePort = (): number => Math.floor(Math.random() * (portRange[1] - portRange[0] + 1)) + portRange[0];

// default CSP policy. tl;dr: allow everything if same-origin, and allow all mostly non-dangerous things for all domains (images, css, requests)
const defaultCSP = ['upgrade-insecure-requests']
  .concat(['default-src'].map((x) => `${x} 'self' 'unsafe-inline'`))
  .concat(
    ['connect-src', 'font-src', 'img-src', 'media-src', 'style-src', 'form-action'].map(
      (x) => `${x} https: data: blob: 'unsafe-inline'`
    )
  )
  .join('; ');

export interface StartBrowserOptions {
  allowHTTP?: boolean;
  allowNavigation?: string;
  windowSize?: [number, number];
  forceBrowser?: string;
  forceEngine?: 'firefox' | 'chromium';
  localCSP?: string;
  devtools?: boolean;
  userAgent?: string;
  incognito?: boolean;
}

export interface PathOptions {
  browserPath: string;
  dataPath: string;
}

const startBrowser = async (
  url: string,
  parentDir: string,
  transport: 'stdio' | 'websocket',
  {
    allowHTTP = false,
    allowNavigation = 'same-origin',
    windowSize,
    forceBrowser,
    forceEngine,
    localCSP = defaultCSP,
    devtools,
    userAgent,
    incognito,
  }: StartBrowserOptions
) => {
  const [browserPath, browserName] = await findBrowserPath(forceBrowser, forceEngine);
  if (!browserPath || !browserName) {
    throw new Error('Failed to find a usable browser installed');
  }

  const browserFriendlyName = getFriendlyName(browserName);
  const browserType = getBrowserType(browserName);

  let dataPath = getDataPath(browserName);
  if (incognito) dataPath = join(dataPath, 'incognito-' + Math.random().toString().slice(2));

  log('found browser', browserName, `(${browserType} based)`, 'at path:', browserPath);
  log('data path:', dataPath);

  const openingLocal = !url.includes('://') && !url.includes('data:');
  const localUrl = browserType === 'firefox' ? `http://localhost:${generatePort()}` : 'https://app.gluon';
  const basePath = isAbsolute(url) ? url : join(parentDir, url);

  const closeHandlers: (() => Promise<void>)[] = [];
  if (openingLocal && browserType === 'firefox') {
    closeHandlers.push(await LocalHTTP({ url: localUrl, basePath, csp: localCSP }));
  }

  const windowOptions: WindowOptions = {
    browserName: browserFriendlyName,
    url: openingLocal ? localUrl : url,
    basePath,
    openingLocal,
    closeHandlers,
    browserType,
    dataPath,
    allowNavigation,
    localCSP,
  };

  const browserOptions: BrowserOptions = {
    url: openingLocal ? localUrl : url,
    transport,
    windowSize,
    allowHTTP,
    extensions: ExtensionsAPI._extensions[browserType],
    devtools: devtools === false ? process.argv.includes('--enable-devtools') : true,
    userAgent: userAgent ?? '',
  };

  const pathOptions: PathOptions = {
    browserPath,
    dataPath,
  };

  if (browserType === 'chromium') {
    return await Chromium(pathOptions, browserOptions, windowOptions);
  }

  // if (browserType === 'firefox') {
  //   return await Firefox(pathOptions, browserOptions, windowOptions);
  // }

  throw new Error('Invalid browser type');
};

// get parent directory of where function was called from
const getParentDir = (): string => {
  let parentDir = new URL('.', import.meta.url).pathname;

  // Remove trailing slash if it exists
  if (parentDir.endsWith('/')) {
    parentDir = parentDir.slice(0, -1);
  }

  return parentDir;
};

const checkForDangerousOptions = ({ allowHTTP, allowNavigation, localCSP }: StartBrowserOptions, url: string): void => {
  if (allowHTTP === true) {
    dangerousAPI('Gluon.open', 'allowHTTP', 'true');
  } else if (allowHTTP !== false && url.startsWith('http://')) {
    throw new Error(
      `HTTP URLs are blocked by default. Please use HTTPS, or if not possible, enable the 'allowHTTP' option.`
    );
  }
  if (allowNavigation !== 'same-origin') dangerousAPI('Gluon.open', 'allowNavigation', 'true');
  if (localCSP === '') dangerousAPI('Gluon.open', 'localCSP', "''");
};

async function waitForGluonLoadedInBrowser(browser: any): Promise<void> {
  return new Promise<void>((resolve) => {
    const listener = () => {
      browser.ipc.removeListener('gluonLoadedInBrowser', listener);
      resolve();
    };

    browser.ipc.on('gluonLoadedInBrowser', listener);
  });
}

export const open = async (
  url: string,
  transport: 'stdio' | 'websocket' = 'stdio',
  opts: StartBrowserOptions = {
    allowHTTP: false,
    allowNavigation: 'same-origin',
  }
) => {
  log('opts: ', opts);
  checkForDangerousOptions(opts, url);
  log('starting browser...');

  const Browser = await startBrowser(url, getParentDir(), transport, opts);

  await waitForGluonLoadedInBrowser(Browser);

  return Browser;
};

// export const extensions = {
//   add: ExtensionsAPI.add,
//   remove: ExtensionsAPI.remove,
// };

// export { default as openAbout } from './menus/about'; // Assuming about.ts exists
