import { log, logInline } from './logger'; // Assuming logger.js is a TypeScript file or has a declaration file

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

export default async ({ pipe = {} as Pipe, port }: { pipe?: Pipe; port?: number }) => {
  const messageCallbacks: ((msg: CDPMessage) => void)[] = [];
  const onReply: { [key: number]: (msg: CDPMessage) => void } = {};

  const onMessage = (msg: string) => {
    if (closed) return; // closed, ignore

    const parsedMsg: CDPMessage = JSON.parse(msg);

    if (logCDP) log('received', parsedMsg);
    if (onReply[parsedMsg.id]) {
      onReply[parsedMsg.id](parsedMsg);
      delete onReply[parsedMsg.id];
      return;
    }

    for (const callback of messageCallbacks) callback(parsedMsg);
  };

  let closed = false;
  let _send: (data: string) => void;
  let _close: () => void;

  let msgId = 0;
  const sendMessage = async (method: string, params: any = {}, sessionId?: string) => {
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
  };

  const logCDP = process.argv.includes('--cdp-logging');

  if (port) {
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

    logInline('fetching websocket url');

    const listURL = `http://127.0.0.1:${port}/json/list`;
    const targets = await continualTrying(async () => (await fetch(listURL)).json());
    const target = targets[0];
    const ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise<void>((resolve) => (ws.onopen = () => resolve()));

    _send = (data) => !closed && ws.send(data);
    ws.onmessage = ({ data }) => onMessage(data);

    _close = () => ws.close();
  } else {
    let pending = '';
    pipe.pipeRead?.on('data', (buf: Buffer) => {
      if (closed) return; // closed, ignore

      let end = buf.indexOf('\0'); // messages are null separated

      if (end === -1) {
        // no complete message yet
        pending += buf.toString();
        return;
      }

      let start = 0;
      while (end !== -1) {
        // while we have pending complete messages, dispatch them
        const message = pending + buf.toString(undefined, start, end); // get next whole message
        onMessage(message);

        start = end + 1; // find next ending
        end = buf.indexOf('\0', start);
        pending = '';
      }

      pending = buf.toString(undefined, start);
    });

    pipe.pipeRead?.on('close', () => log('pipe read closed'));
    pipe.pipeWrite?.on('error', () => {}); // ignore write error, likely just closed

    _send = (data) => {
      if (closed) return new Error('CDP connection closed');

      pipe.pipeWrite?.write(data);
      pipe.pipeWrite?.write('\0');
    };

    _close = () => {};
  }

  return {
    onMessage: (callback: (msg: CDPMessage) => void) => {
      messageCallbacks.push(callback);

      // return function to unhook
      return () => {
        messageCallbacks.splice(messageCallbacks.indexOf(callback), 1);
      };
    },

    sendMessage,

    close: () => {
      closed = true;
      _close();
    },
  };
};
