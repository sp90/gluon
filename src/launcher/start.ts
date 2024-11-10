import { spawn } from 'node:child_process';
import { log } from '../lib/logger'; // Assuming logger.ts exists

import ConnectCDP from '../lib/cdp'; // Assuming cdp.ts exists
import InjectInto, { type WindowOptions } from './inject'; // Assuming inject.ts exists

const portRange = [10000, 60000];
const generatePort = (): number => Math.floor(Math.random() * (portRange[1] - portRange[0] + 1)) + portRange[0];

interface ExtraOptions {
  // Define the structure of 'extra' here
  // For example:
  // dataPath: string;
  // browserName: string;
  // ...
}

export default async (browserPath: string, args: string[], transport: 'websocket' | 'stdio', extra: WindowOptions) => {
  // Replace 'any' with the actual return type of InjectInto
  const port = transport === 'websocket' ? generatePort() : null;

  console.log('port: ', port);
  console.log('browserPath: ', browserPath);

  const proc = spawn(
    browserPath,
    [
      transport === 'stdio' ? `--remote-debugging-pipe` : `--remote-debugging-port=${port}`,
      ...args.filter((x) => x),
    ].filter((x) => x),
    {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    }
  );

  log(`connecting to CDP over ${transport === 'stdio' ? 'stdio pipe' : `websocket (${port})`}`);

  let CDP: any; // Replace 'any' with the actual type of CDP
  switch (transport) {
    case 'websocket':
      CDP = await ConnectCDP({ port: port ?? undefined });
      break;

    case 'stdio':
      const { 3: pipeWrite, 4: pipeRead } = proc.stdio;

      // @ts-ignore
      CDP = await ConnectCDP({ pipe: { pipeWrite, pipeRead } });
      break;
  }

  return await InjectInto(CDP, proc, 'browser', extra);
};
