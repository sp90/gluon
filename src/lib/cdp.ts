import { log } from './logger'; // Assuming logger.js is a TypeScript file or has a declaration file

import type { spawn } from 'node:child_process';

export type ChildProcess = ReturnType<typeof spawn>;

export interface Pipe {
  pipeWrite: ChildProcess['stdin'];
  pipeRead: ChildProcess['stdout'];
}

interface CDPMessage {
  id: number;
  method: string;
  params?: unknown;
  error?: Error;
  result?: {
    // For basic results
    data?: string;

    // For structured results
    result?: {
      type: 'undefined' | 'string' | 'object';
      value?: string;
      subtype?: 'promise';
      className?: string;
      description?: string;
      objectId?: string;
    };

    // For identifier results
    identifier?: string;
  };
  sessionId?: string;
}

export type SendMessage = (
  method: string,
  params?: any,
  sessionId?: string
) => Promise<
  | Error
  | {
      data?: string;
      result?: {
        type: 'undefined' | 'string' | 'object';
        value?: string;
        subtype?: 'promise';
        className?: string;
        description?: string;
        objectId?: string;
      };
      identifier?: string;
      sessionId?: string;
    }
>;

export interface CDP {
  onMessage: (callback: (msg: CDPMessage) => void) => () => void;
  sendMessage: SendMessage;
  close: () => void;
}

const continualTrying = async (func: () => Promise<any>) => {
  while (true) {
    try {
      log('attempting1');
      return await func();
    } catch (e) {
      await new Promise((res) => setTimeout(res, 200));
    }
  }
};

const onReply: { [key: number]: (msg: CDPMessage) => void } = {};
const messageCallbacks: ((msg: CDPMessage) => void)[] = [];

export default async ({ port }: { port?: number }) => {
  const logCDP = process.argv.includes('--cdp-logging');

  const listURL = `http://127.0.0.1:${port}/json/list`;
  const targets = await continualTrying(async () => (await fetch(listURL)).json());
  const target = targets[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise<void>((resolve) => (ws.onopen = () => resolve()));

  let closed = false;
  let msgId = 0;

  const _send = (data: string) => !closed && ws.send(data);
  const _close = () => ws.close();
  ws.onmessage = ({ data }) => {
    if (closed) return;

    const parsedMsg: CDPMessage = JSON.parse(data);

    if (logCDP) log('received', parsedMsg);
    if (onReply[parsedMsg.id]) {
      onReply[parsedMsg.id](parsedMsg);
      delete onReply[parsedMsg.id];
      return;
    }

    for (const callback of messageCallbacks) callback(parsedMsg);
  };

  log('fetching websocket url');

  return {
    onMessage: (callback: (msg: CDPMessage) => void) => {
      messageCallbacks.push(callback);

      // return function to unhook
      return () => {
        messageCallbacks.splice(messageCallbacks.indexOf(callback), 1);
      };
    },

    sendMessage: async (method: string, params: any = {}, sessionId?: string) => {
      if (closed) return new Error('CDP connection closed');

      const id = msgId++;

      const msg: CDPMessage = {
        id,
        method,
        params,
      };

      if (sessionId) msg.sessionId = sessionId;

      _send(JSON.stringify(msg));

      if (logCDP) log('sent', msg);

      const reply = await new Promise<CDPMessage>((res) => {
        onReply[id] = (msg) => res(msg);
      });

      if (reply.error) {
        log(
          'warn: CDP reply error.',
          'method:',
          method,
          'error:',
          reply.error,
          '\n' + new Error()?.stack?.split('\n').slice(3).join('\n')
        );
        return new Error(reply.error.message);
      }

      return reply.result!;
    },

    close: () => {
      closed = true;
      _close();
    },
  };
};
