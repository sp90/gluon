import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import mimeType from '../mimeType'; // Assuming mimeType.js is a TypeScript file or has a declaration file

const generatePath = (pathname: string, indexFile: string): string => {
  if (pathname === '/') return indexFile;
  if (extname(pathname) === '') return pathname + '.html';

  return pathname;
};

export default (givenPath: string, csp?: string) => {
  const basePath = extname(givenPath) ? dirname(givenPath) : givenPath;
  const indexFile = extname(givenPath) ? basename(givenPath) : 'index.html';

  return async (
    url: string
  ): Promise<{
    status: number;
    error?: boolean;
    body: string;
    headers: { [key: string]: string };
  }> => {
    const parsedUrl = new URL(url);

    const path = join(basePath, generatePath(parsedUrl.pathname, indexFile));
    const ext = extname(path).slice(1);

    let error = false;

    const body = await readFile(path, 'utf8').catch(() => {
      error = true;
      return '';
    });

    if (error)
      return {
        status: 404,
        error: true,
        body: '',
        headers: {},
      };

    return {
      status: 200,
      body,
      headers: {
        'Content-Type': mimeType(ext),
        'Content-Security-Policy': csp || '', // Use empty string if csp is undefined
      },
    };
  };
};
