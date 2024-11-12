import { dirname, extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'url';
import { dangerousAPI, log } from './lib/logger'; // Assuming logger.ts exists

import Chromium from './browser/chromium'; // Assuming chromium.ts exists
import Firefox from './browser/firefox'; // Assuming firefox.ts exists

import * as ExtensionsAPI from './extensions'; // Assuming extensions.ts exists
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

interface BrowserOptions {
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
  }: BrowserOptions
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

  const Window = await (browserType === 'firefox' ? Firefox : Chromium)(
    {
      dataPath,
      browserPath,
    },
    {
      url: openingLocal ? localUrl : url,
      transport,
      windowSize,
      allowHTTP,
      extensions: ExtensionsAPI._extensions[browserType],
      devtools: devtools === false ? process.argv.includes('--enable-devtools') : true,
      userAgent: userAgent ?? '',
    },
    {
      browserName: browserFriendlyName,
      url: openingLocal ? localUrl : url,
      basePath,
      openingLocal,
      closeHandlers,
      browserType,
      dataPath,
      allowNavigation,
      localCSP,
    }
  );

  return Window;
};

// get parent directory of where function was called from
const getParentDir = (): string => {
  let place = new Error().stack!.split('\n')[3].slice(7).trim().split(':').slice(0, -2).join(':');
  if (place.includes('(') && place.includes(')')) {
    place = place.split('(').slice(1).join('(');
  }

  if (place.startsWith('file://')) place = fileURLToPath(place);
  return dirname(place);
};

const checkForDangerousOptions = ({ allowHTTP, allowNavigation, localCSP }: BrowserOptions): void => {
  if (allowHTTP === true) dangerousAPI('Gluon.open', 'allowHTTP', 'true');
  if (allowNavigation !== 'same-origin') dangerousAPI('Gluon.open', 'allowNavigation', 'true');
  if (localCSP === '') dangerousAPI('Gluon.open', 'localCSP', "''");
};

export const open = async (url: string, transport: 'stdio' | 'websocket' = 'stdio', opts: BrowserOptions = {}) => {
  const { allowHTTP = false } = opts;

  if (allowHTTP !== true && url.startsWith('http://'))
    throw new Error(
      `HTTP URLs are blocked by default. Please use HTTPS, or if not possible, enable the 'allowHTTP' option.`
    );

  checkForDangerousOptions(opts);
  log('starting browser...');

  const Browser = await startBrowser(url, getParentDir(), transport, opts);

  return Browser;
};

export const extensions = {
  add: ExtensionsAPI.add,
  remove: ExtensionsAPI.remove,
};

export { default as openAbout } from './menus/about'; // Assuming about.ts exists
