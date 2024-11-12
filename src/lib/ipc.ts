import { log } from './logger'; // Assuming logger.ts exists

const logIPC = process.argv.includes('--ipc-logging');

interface BrowserInfo {
  product: string;
  jsVersion: string;
}

interface BrowserParams {
  browserName: string;
  browserInfo: BrowserInfo;
  browserType: string;
}

interface EvalParams {
  evalInWindow: (code: string) => void;
  evalOnNewDocument: (code: string) => void;
}

interface CDP {
  sendMessage: (method: string, params: any, sessionId: string) => Promise<any>;
}

interface IPCMessage {
  id: string;
  type: string;
  data: any;
}

type ListenerCallback = (data: any) => any;

export interface IPCAPI {
  on: (type: string, cb: ListenerCallback) => void;
  removeListener: (type: string, cb: ListenerCallback) => boolean;
  send: (channel: string, ...args: any[]) => void; // Replace 'any[]' with specific types if known
  expose: (...args: any[]) => void | Error;
  unexpose: (key: string) => void;
  store: {
    [key: string]: any;
    get: (key: string) => any;
    set: (key: string, value: any) => any;
    keys: () => string[];
    toJSON: () => { [key: string]: any };
  };
}

export default (
  { browserName, browserInfo, browserType }: BrowserParams,
  { evalInWindow, evalOnNewDocument }: EvalParams,
  CDP: CDP,
  sessionId: string,
  isClosed: () => boolean
): [(code?: string) => void, IPCAPI] => {
  const injection = `(() => {
if (window.Gluon) return;
let onIPCReply = {}, ipcListeners = {}, ipcQueue = [], ipcQueueRes;
const Gluon = {
  versions: {
    gluon: '${process.versions.gluon}',
    builder: '${'GLUGUN_VERSION' === 'GLUGUN_VERSION' ? 'nothing' : 'Glugun GLUGUN_VERSION'}',
    bun: '${Bun.version}',
    browser: '${browserInfo.product.split('/')[1]}',
    browserType: '${browserType}',
    product: '${browserName}',

    js: {
      bun: '${process.versions.webkit?.slice(0, 7)}',
      browser: '${browserInfo.jsVersion}'
    },

    embedded: {      
      bun: '${!!process.versions.bun}',
      browser: false
    }
  },

  ipc: {
    send: async (type, data, id = undefined) => {
      const isReply = !!id;
      id = id ?? Math.random().toString().split('.')[1];

      ipcQueue.push({
        id,
        type,
        data
      });
      if (ipcQueueRes) {
        ipcQueueRes();
        ipcQueueRes = null;
      }

      if (isReply) return;

      const reply = await new Promise(res => {
        onIPCReply[id] = msg => res(msg);
      });

      return reply.data;
    },

    on: (type, cb) => {
      if (!ipcListeners[type]) ipcListeners[type] = [];
      ipcListeners[type].push(cb);
    },

    removeListener: (type, cb) => {
      if (!ipcListeners[type]) return false;
      ipcListeners[type].splice(ipcListeners[type].indexOf(cb), 1);
    },

    _get: async () => {
      if (ipcQueue.length === 0) await new Promise(res => ipcQueueRes = res);
      return JSON.stringify(ipcQueue.shift());
    },

    _receive: async msg => {
      const { id, type, data } = msg;

      if (onIPCReply[id]) {
        onIPCReply[id]({ type, data });
        delete onIPCReply[id];
        return;
      }

      if (ipcListeners[type]) {
        let reply;

        for (const cb of ipcListeners[type]) {
          const ret = await cb(data);
          if (!reply) reply = ret; // use first returned value as reply
        }

        if (reply) return Gluon.ipc.send('reply', reply, id); // reply with wanted reply
      }

      Gluon.ipc.send('pong', null, id);
    },

    _send: window._gluonSend
  },
};

let _store = {};
Gluon.ipc.send('web store sync').then(syncedStore => _store = syncedStore);
const updateBackend = (key, value) => { // update backend with a key/value change
  Gluon.ipc.send('web store write', { key, value });
};

Gluon.ipc.store = new Proxy({
  get: (key) => {
    return _store[key];
  },

  set: (key) => {
    _store[key] = value;

    updateBackend(key, value);
    return value;
  },

  keys: () => Object.keys(_store),
  toJSON: () => _store
}, {
  get(target, key) {
    return target[key] ?? _store[key];
  },

  set(target, key, value) {
    if (target[key]) throw new Error('Cannot overwrite Gluon functions');

    _store[key] = value;

    updateBackend(key, value);
    return true;
  },

  deleteProperty(target, key) {
    if (target[key]) throw new Error('Cannot overwrite Gluon functions');

    delete _store[key];

    updateBackend(key, undefined);
    return true;
  }
});

Gluon.ipc.on('backend store write', ({ key, value }) => {
  if (value === undefined) delete _store[key];
    else _store[key] = value;
});

Gluon.ipc = new Proxy(Gluon.ipc, {
  get(target, key) {
    return (Gluon.ipc[key] = target[key] ?? ((...args) => Gluon.ipc.send('exposed ' + key, args)));
  }
});

window.Gluon = Gluon;

delete window._gluonSend;
})();`;

  evalInWindow(injection);
  evalOnNewDocument(injection);

  const onWindowMessage = async ({ id, type, data }: IPCMessage): Promise<void> => {
    // if (logIPC) log('IPC: recv', { type, data, id });

    if (onIPCReply[id]) {
      onIPCReply[id]({ type, data });
      delete onIPCReply[id];
      return;
    }

    if (ipcListeners[type]) {
      let reply;

      for (const cb of ipcListeners[type]) {
        const ret = await cb(data);
        if (!reply) reply = ret; // use first returned value as reply
      }

      if (reply) return sendToWindow('reply', reply, id); // reply with wanted reply
    }

    sendToWindow('pong', null, id); // send simple pong to confirm
  };

  (async () => {
    while (!isClosed()) {
      const msg = await CDP.sendMessage(
        'Runtime.evaluate',
        {
          expression: 'window.Gluon.ipc._get()',
          awaitPromise: true,
        },
        sessionId
      );

      if (msg.result.value) {
        onWindowMessage(JSON.parse(msg.result.value));
      }
    }
  })();

  let onIPCReply: { [key: string]: (msg: any) => void } = {},
    ipcListeners: { [key: string]: ((data: any) => any)[] } = {};

  const sendToWindow = async (type: string, data: any, id: string | undefined = undefined) => {
    const isReply = !!id;
    id = id ?? Math.random().toString().split('.')[1];

    if (logIPC) log('IPC: send', { type, data, id });

    evalInWindow(
      `window.Gluon.ipc._receive(${JSON.stringify({
        id,
        type,
        data,
      })})`
    );

    if (isReply) return; // we are replying, don't expect reply back

    const reply = await new Promise((res) => {
      onIPCReply[id!] = (msg) => res(msg);
    });

    // TODO: fix any
    return (reply as any).data;
  };

  // Expose API
  const makeExposeKey = (key: string) => 'exposed ' + key;

  const expose = (key: string, func: (...args: any[]) => any): void => {
    if (typeof func !== 'function') throw new Error('Invalid arguments (expected string, function)');
    if (logIPC) log('IPC: expose', key);

    const exposeKey = makeExposeKey(key);

    API.on(exposeKey, (args: any[]) => func(...args)); // handle IPC events
  };

  const unexpose = (key: string): void => {
    const exposeKey = makeExposeKey(key);
    API.removeListener(exposeKey, () => {});
  };

  let API: IPCAPI = {
    on: (type: string, cb: ListenerCallback): void => {
      if (!ipcListeners[type]) ipcListeners[type] = [];
      ipcListeners[type].push(cb);
    },

    removeListener: (type: string, cb: ListenerCallback): boolean => {
      if (!ipcListeners[type]) return false;
      ipcListeners[type].splice(ipcListeners[type].indexOf(cb), 1);

      if (ipcListeners[type].length === 0) delete ipcListeners[type]; // clean up - remove type from listeners if 0 listeners left
      return true;
    },

    send: sendToWindow,

    expose: (...args: any[]): void | Error => {
      if (args.length === 1) {
        // given object to expose
        for (const key in args[0]) expose(key, args[0][key]); // expose all keys given

        return;
      }

      if (args.length === 2) return expose(args[0], args[1]);

      return new Error('Invalid arguments (expected object or key and function)');
    },

    unexpose: unexpose,

    store: new Proxy(
      {
        get: (key: string) => {
          return _store[key];
        },

        set: (key: string, value: any) => {
          _store[key] = value;

          updateWeb(key, value);
          return value;
        },

        keys: () => Object.keys(_store),
        toJSON: () => _store,
      },
      {
        get(target: any, key: string) {
          return target[key] ?? _store[key];
        },

        set(target: any, key: string, value: any) {
          if (target[key]) throw new Error('Cannot overwrite Gluon functions');

          _store[key] = value;

          updateWeb(key, value);
          return true;
        },

        deleteProperty(target: any, key: string) {
          if (target[key]) throw new Error('Cannot overwrite Gluon functions');

          delete _store[key];

          updateWeb(key, undefined);
          return true;
        },
      }
    ),
  };

  const _store: { [key: string]: any } = {};
  const updateWeb = (key: string, value: any): void => {
    // update web with a key/value change
    if (logIPC) log('IPC: store write (backend)', key, value);

    API.send('backend store write', { key, value });
  };

  API = new Proxy(API, {
    // setter and deleter API
    set(_obj: any, key: string, value: any) {
      expose(key, value);
      return true;
    },

    deleteProperty(_obj: any, key: string) {
      unexpose(key);
      return true;
    },
  });

  return [() => evalInWindow(injection), API];
};
