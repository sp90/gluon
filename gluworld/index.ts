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
  // if (Bun.argv.length > 2) {
  //   for (const forceBrowser of Bun.argv.slice(2)) {
  //     await Gluon.open(join(__dirname, 'index.html'), {
  //       windowSize: [800, 500],
  //       // forceBrowser,
  //     });
  //   }

  //   return;
  // }

  const startTime = performance.now();

  const Browser = await Gluon.open(join(__dirname, 'index.html'), 'websocket', {
    windowSize: [800, 500],
  });

  // console.log('Browser: ', Browser);

  log(`Took ${performance.now() - startTime}ms to open browser`);

  const size = await dirSize(__dirname);
  console.log('size: ', size);

  setTimeout(async () => {
    Browser.ipc.send('build size', size);
  }, 1000);

  Browser.ipc.on('comms', (type) => {
    console.log('comms: ', type);
  });
})();
