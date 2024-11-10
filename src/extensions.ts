interface Extension {
  chromium?: any; // Replace 'any' with the actual type of chromium extension
  firefox?: any; // Replace 'any' with the actual type of firefox extension
}

export const _extensions: { chromium: any[]; firefox: any[] } = {
  chromium: [],
  firefox: [],
};

const parseArgs = (args: (Extension | (() => Extension[]))[]): Extension[] =>
  args.flatMap((x) => (typeof x === 'function' ? x() : x));

export const add = (..._args: (Extension | (() => Extension[]))[]): void => {
  const args = parseArgs(_args);

  for (const ext of args) {
    if (ext.chromium) _extensions.chromium.push(ext.chromium);
    if (ext.firefox) _extensions.firefox.push(ext.firefox);
  }
};

export const remove = (..._args: (Extension | (() => Extension[]))[]): void => {
  const args = parseArgs(_args);

  for (const ext of args) {
    if (ext.chromium) _extensions.chromium.splice(_extensions.chromium.indexOf(ext.chromium), 1);
    if (ext.firefox) _extensions.firefox.splice(_extensions.firefox.indexOf(ext.firefox), 1);
  }
};
