import fs from 'node:fs';
import path from 'node:path';

export function assertNoSymlinkPathComponents(inputPath, label = 'path') {
  const resolved = path.resolve(inputPath);
  let cursor = path.parse(resolved).root;
  for (const component of resolved.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(label + ' must not contain symlink components');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return resolved;
}
