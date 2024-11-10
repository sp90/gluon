import { createServer, IncomingMessage, ServerResponse } from 'http';
import { log } from '../logger'; // Assuming logger.js is a TypeScript file or has a declaration file
import createLocalFulfill from './fulfill'; // Assuming fulfill.js is a TypeScript file or has a declaration file

export default async ({ basePath, url, csp }: { basePath: string; url: string; csp?: string }): Promise<() => void> => {
  const localFulfill = createLocalFulfill(basePath, csp);

  const port = parseInt(url.split(':').pop()!); // Assuming url will always have a port
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const { status, body, headers } = await localFulfill(url + decodeURI(req.url!)); // Assuming req.url is always defined

    res.writeHead(status, headers);
    res.end(body, 'utf8');
  }).listen(port, '127.0.0.1');

  log('local setup');

  return () => server.close();
};
