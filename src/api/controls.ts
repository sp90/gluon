interface Bounds {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export default async (CDP: { send: (method: string, params?: any) => Promise<any> }) => {
  const { windowId } = await CDP.send('Browser.getWindowForTarget');

  const setWindowState = (state?: string, bounds: Bounds = {}) =>
    CDP.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        windowState: state,
        ...bounds,
      },
    });

  return {
    minimize: async () => {
      await setWindowState('minimized');
    },

    maximize: async () => {
      await setWindowState('maximized');
    },

    show: async (bounds?: Bounds) => {
      await setWindowState('minimized');
      await setWindowState('normal');
      if (bounds) await setWindowState(undefined, bounds);
    },
  };
};
