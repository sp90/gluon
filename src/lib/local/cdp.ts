import { log } from '../logger'; // Assuming logger.js is a TypeScript file or has a declaration file
import createLocalFulfill from './fulfill'; // Assuming fulfill.js is a TypeScript file or has a declaration file

// Define the structure of the CDP message
interface CDPMessage {
  method: string;
  params: any;
}

export default async (
  CDP: {
    onMessage: (callback: (msg: CDPMessage) => void) => void;
    sendMessage: (method: string, params?: any, sessionId?: string) => Promise<any>;
  },
  { sessionId, basePath, url, csp }: { sessionId: string; basePath: string; url: string; csp?: string }
) => {
  const localFulfill = createLocalFulfill(basePath, csp);

  CDP.onMessage(async (msg: CDPMessage) => {
    if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params;

      const { status, body, headers } = await localFulfill(request.url);

      return await CDP.sendMessage('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        body: Buffer.from(body).toString('base64'), // CDP uses base64 encoding for request body
        responseHeaders: Object.keys(headers).map((x) => ({ name: x, value: headers[x] })),
      });
    }
  });

  await CDP.sendMessage('Fetch.enable', {
    patterns: [
      {
        urlPattern: `${url}*`,
      },
    ],
  });

  await CDP.sendMessage('Page.reload', {}, sessionId);

  log('local setup');
};
