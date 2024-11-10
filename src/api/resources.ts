export default async (CDP: { send: (method: string, params?: any) => Promise<any> }) => {
  const run = async (js: string | Function) => {
    await CDP.send('Runtime.evaluate', {
      expression: typeof js === 'string' ? js : `(${js.toString()})()`,
    });
  };

  const injectJS = async (code: string) => {
    const toRun = `(async () => {
if (window.self !== window.top) return;
await new Promise(res => {
  const check = () => {
    if (!window.Gluon) return setTimeout(check, 20);
    res();
  };

  check();
});

await new Promise(res => {
  if (document.readyState !== 'loading') {
    res();
  } else {
    document.addEventListener('DOMContentLoaded', res);
  }
});

${code}
})();`;

    await run(toRun);

    const { identifier } = await CDP.send('Page.addScriptToEvaluateOnNewDocument', {
      source: toRun,
    });

    return async () => {
      await CDP.send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier,
      });
    };
  };

  const escapeCSS = (code: string) => code.replaceAll('`', '\\`').replaceAll('\\', '\\\\');

  const injectCSS = async (code: string, id = 'gluon-resource-' + Math.random().toString().split('.')[1]) => {
    const js = `const el = document.querySelector('style#${id}') ?? document.createElement('style');
el.id = '${id}';
el.textContent = \`${escapeCSS(code)}\`;
if (!el.isConnected) document.head.appendChild(el);`;

    return [id, await injectJS(js)] as [string, () => Promise<void>];
  };

  return {
    js: async (inp: string | Function) => {
      const code = typeof inp === 'function' ? `(${inp.toString()})()` : inp;
      const remove = await injectJS(code);

      return {
        remove,
      };
    },

    css: async (css: string) => {
      let [id, removeJS] = await injectCSS(css);

      return {
        remove: async () => {
          await removeJS(); // do not add in future
          await run(`document.querySelector('style#${id}').remove()`); // remove current element
        },

        modify: async (newCss: string) => {
          await removeJS(); // do not add old in future
          [id, removeJS] = await injectCSS(newCss, id); // inject new css with same id
        },
      };
    },
  };
};
