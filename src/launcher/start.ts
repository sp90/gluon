import { spawn } from 'node:child_process';
import { log } from '../lib/logger'; // Assuming logger.ts exists

import ConnectCDP, { type CDP, type Pipe } from '../lib/cdp'; // Assuming cdp.ts exists
import InjectInto, { type WindowOptions } from './inject'; // Assuming inject.ts exists

const portRange = [10000, 60000];
const generatePort = (): number => Math.floor(Math.random() * (portRange[1] - portRange[0] + 1)) + portRange[0];

export default async (browserPath: string, args: string[], transport: 'websocket' | 'stdio', extra: WindowOptions) => {
  // const port = transport === 'websocket' ? generatePort() : null;
  const port = transport === 'websocket' ? 3000 : null;

  const proc = spawn(
    browserPath,
    [
      transport === 'stdio' ? `--remote-debugging-pipe` : `--remote-debugging-port=${port}`,
      // `--dbus-launch=${process.env.DBUS_SESSION_BUS_ADDRESS} --autolaunch`,
      // '--no-sandbox',
      ...args.filter((x) => x),
    ].filter((x) => x),
    {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    }
  );

  // Capture stdout and stderr
  proc.stdout?.on('data', (data) => {
    console.log(`[Chromium stdout]: ${data}`);
  });

  proc.stderr?.on('data', (data) => {
    console.error(`[Chromium stderr]: ${data}`);
  });

  log(`connecting to CDP over ${transport === 'stdio' ? 'stdio pipe' : `websocket (${port})`}`);

  let CDP: CDP | undefined;

  switch (transport) {
    case 'websocket':
      CDP = await ConnectCDP({ port: port ?? undefined });
      break;

    case 'stdio':
      const { 3: pipeWrite, 4: pipeRead } = proc.stdio;

      CDP = await ConnectCDP({ pipe: { pipeWrite, pipeRead } as Pipe });
      break;
  }

  if (!CDP) throw new Error('CDP connection failed');

  return await InjectInto(CDP as CDP, proc, 'browser', extra);
};
