export default (versions: string) => `(() => {
if (window.Gluon) return;
let onIPCReply = {}, ipcListeners = {}, ipcQueue = [], ipcQueueRes;
const Gluon = {
  versions: ${versions},

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
