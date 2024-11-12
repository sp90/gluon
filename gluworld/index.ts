import * as Gluon from '../src/index';

import { readdir, stat } from 'node:fs/promises';
import { join } from 'path';

import { log } from '../src/lib/logger';

const __dirname = import.meta.dir;
const dirSize = async (directory: string): Promise<number> => {
  const files = await readdir(directory);
  const stats = files.map((file) => stat(join(directory, file)));

  return (await Promise.all(stats)).reduce((accumulator, { size }) => accumulator + size, 0);
};

(async () => {
  const startTime = performance.now();

  const Browser = await Gluon.open(join(__dirname, 'index.html'), 'websocket', {
    windowSize: [800, 500],
  });

  log(`Took ${performance.now() - startTime}ms to open browser`);

  const size = await dirSize(__dirname);
  console.log('size: ', size);

  Browser.ipc.send('build size', size);
  // Listen for IPC events
  Browser.ipc.on('comms', (type) => {
    log('comms: ', type);
  });
})();
