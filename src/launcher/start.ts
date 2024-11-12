import { spawn } from 'node:child_process';
import { log } from '../lib/logger'; // Assuming logger.ts exists

import ConnectCDP, { type CDP } from '../lib/cdp'; // Assuming cdp.ts exists
import { type WindowOptions, injectInto } from './inject'; // Assuming inject.ts exists

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
  // proc.stdout?.on('data', (data) => {
  //   console.log(`[Chromium stdout]: ${data}`);
  // });

  // proc.stderr?.on('data', (data) => {
  //   console.error(`[Chromium stderr]: ${data}`);
  // });

  log(`connecting to CDP over ${transport === 'stdio' ? 'stdio pipe' : `websocket (${port})`}`);

  const CDP = await ConnectCDP({ port: port ?? undefined });

  if (!CDP) throw new Error('CDP connection failed');

  return await injectInto(CDP as CDP, proc, extra);
};
