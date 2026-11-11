import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import yaml from 'js-yaml';

const directory = resolve(process.argv[2] || 'assets/output/releases');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const expected = {
  'latest.yml': [`NEU-Dot-${version}-win-x64.exe`],
  'latest-mac.yml': [`NEU-Dot-${version}-mac-arm64.zip`, `NEU-Dot-${version}-mac-arm64.dmg`],
};
for (const [name, required] of Object.entries(expected)) {
  const info = yaml.load(await readFile(join(directory, name), 'utf8'));
  assert.equal(info.version, version, `${name} version`);
  assert.ok(Array.isArray(info.files) && info.files.length, `${name} files`);
  for (const file of required)
    assert.ok(
      info.files.some((item) => item.url === file),
      `${name} missing ${file}`,
    );
  for (const file of info.files) {
    assert.equal(basename(file.url), file.url, 'Update artifacts must use relative filenames');
    assert.ok(required.includes(file.url), `Unexpected update artifact ${file.url}`);
    const path = join(directory, file.url);
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    assert.equal(hash.digest('base64'), file.sha512, `${file.url} SHA-512`);
    if (file.size !== undefined)
      assert.equal((await stat(path)).size, file.size, `${file.url} size`);
  }
}
assert.ok((await stat(join(directory, `NEU-Dot-${version}-win-x64.exe.blockmap`))).size > 0);
console.log(
  `Verified Windows/macOS update manifests, versions, file sizes and SHA-512 for ${version}`,
);
