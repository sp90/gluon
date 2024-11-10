import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import StartBrowser from '../launcher/start'; // Assuming start.js is a TypeScript file or has a declaration file

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export default async (
  { browserPath, dataPath }: { browserPath: string; dataPath: string },
  {
    url,
    windowSize,
    allowHTTP,
    extensions,
    userAgent,
  }: {
    url: string;
    windowSize?: [number, number];
    allowHTTP: boolean | 'mixed';
    extensions: Promise<string | string[]>[];
    userAgent: string;
  },
  extra: any // Replace 'any' with the actual type of extra if known
) => {
  await mkdir(dataPath, { recursive: true });
  await writeFile(
    join(dataPath, 'user.js'),
    `
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
user_pref('devtools.chrome.enabled', true);
user_pref('devtools.debugger.prompt-connection', false);
user_pref('devtools.debugger.remote-enabled', true);
user_pref('toolkit.telemetry.reportingpolicy.firstRun', false);
user_pref('browser.shell.checkDefaultBrowser', false);
${
  !windowSize
    ? ''
    : `user_pref('privacy.window.maxInnerWidth', ${windowSize[0]});
user_pref('privacy.window.maxInnerHeight', ${windowSize[1]});`
}
user_pref('privacy.resistFingerprinting', false);
user_pref('fission.bfcacheInParent', false);
user_pref('fission.webContentIsolationStrategy', 0);
user_pref('ui.key.menuAccessKeyFocuses', false);
user_pref('extensions.autoDisableScopes', 0);
user_pref('media.autoplay.blocking_policy', 0);
${process.platform === 'darwin' ? `user_pref('browser.tabs.inTitlebar', 0);` : ``}

user_pref('security.mixed_content.block_active_content', ${[true, 'mixed'].includes(allowHTTP) ? 'false' : 'true'});
user_pref('security.mixed_content.block_display_content', ${[true, 'mixed'].includes(allowHTTP) ? 'false' : 'true'});
user_pref('security.mixed_content.block_object_subrequest', ${[true, 'mixed'].includes(allowHTTP) ? 'false' : 'true'});
user_pref('security.mixed_content.upgrade_display_content', true);

user_pref('general.useragent.override', '${userAgent}');
`
  );

  await mkdir(join(dataPath, 'chrome'), { recursive: true });
  await writeFile(
    join(dataPath, 'chrome', 'userChrome.css'),
    `
.titlebar-spacer, #firefox-view-button, #alltabs-button, #tabbrowser-arrowscrollbox-periphery, .tab-close-button {
  display: none;
}

#nav-bar, #urlbar-container, #searchbar { visibility: collapse !important; }

.tab-background, .tab-content, #tabbrowser-tabs {
  background: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  box-shadow: none !important;
}

#tabbrowser-tabs {
  margin: 0 6px !important;
}

.tab-icon-image {
  width: 16px;
  height: 16px;
}

.tabbrowser-tab { /* Stop being able to drag around tab like browser, acts as part of titlebar */
  pointer-events: none;
}

#titlebar, .tabbrowser-tab {
  height: 20px;
}

.tab-content {
  height: 42px;
}

html:not([tabsintitlebar="true"]) #titlebar,
html:not([tabsintitlebar="true"]) .tabbrowser-tab,
html:not([tabsintitlebar="true"]) .tab-background,
html:not([tabsintitlebar="true"]) .tab-content,
html:not([tabsintitlebar="true"]) #tabbrowser-tabs,
html:not([tabsintitlebar="true"]) .tab-icon-image {
  display: none !important;
}
`
  );

  await mkdir(join(dataPath, 'extensions'), { recursive: true });
  for (const ext of (await Promise.all(extensions)).flat()) {
    const installPath = join(dataPath, 'extensions', basename(ext));
    if (!(await exists(installPath))) await copyFile(ext, installPath);
  }

  const args = [
    ...(!windowSize ? [] : ['-width', windowSize[0].toString(), '-height', windowSize[1].toString()]),
    '-profile',
    dataPath,
    '-new-window',
    url,
    '-new-instance',
    '-no-remote',
  ];

  return await StartBrowser(browserPath, args, 'websocket', extra);
};
