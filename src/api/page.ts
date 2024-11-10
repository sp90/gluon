interface PrintToPDFOptions {
  landscape?: boolean;
  displayHeaderFooter?: boolean;
  printBackground?: boolean;
  scale?: number;
  paperWidth?: number;
  paperHeight?: number;
  margins?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  pageRanges?: string;
  ignoreInvalidPageRanges?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  preferCSSPageSize?: boolean;
  transferMode?: 'ReturnAsBase64' | 'ReturnAsStream';
  // Add other supported options as needed
}

export default async (
  CDP: {
    send: (method: string, params?: any) => Promise<any>;
  },
  evaluate: (expression: string) => Promise<any>,
  { pageLoadPromise }: { pageLoadPromise: Promise<void> }
) => {
  return {
    eval: evaluate,
    loaded: pageLoadPromise,

    title: (val?: string) => {
      if (!val) return evaluate('document.title');
      return evaluate(`document.title = \`${val}\``);
    },

    reload: async (ignoreCache = false) => {
      await CDP.send('Page.reload', {
        ignoreCache,
      });
    },

    printToPDF: async (options: PrintToPDFOptions = {}) => {
      if (options.margins) {
        const { top, bottom, left, right } = options.margins;
        options.marginTop = top;
        options.marginBottom = bottom;
        options.marginLeft = left;
        options.marginRight = right;

        delete options.margins;
      }

      const { data } = await CDP.send('Page.printToPDF', options);
      const buffer = Buffer.from(data, 'base64');

      return buffer;
    },
  };
};
