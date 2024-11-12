import type { CDP } from '../cdp';
import { log } from '../logger';
import createLocalFulfill from './fulfill';

export default async (
  CDP: CDP,
  { sessionId, basePath, url, csp }: { sessionId: string; basePath: string; url: string; csp?: string }
) => {
  const localFulfill = createLocalFulfill(basePath, csp);

  CDP.onMessage(async (msg) => {
    if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params as any;
      const { status, body, headers } = await localFulfill(request.url);

      return await CDP.sendMessage('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        body: Buffer.from(body).toString('base64'),
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

  log('local setup cdp');
};
