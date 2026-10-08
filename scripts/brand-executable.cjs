const path = require('node:path');
const fs = require('node:fs/promises');

module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  const { rcedit } = await import('rcedit');
  const { productFilename, version } = context.packager.appInfo;
  await rcedit(path.join(context.appOutDir, `${productFilename}.exe`), {
    icon: path.join(context.packager.projectDir, 'public', 'icon.ico'),
    'file-version': version,
    'product-version': version,
    'version-string': { ProductName: 'TierFlow', FileDescription: 'TierFlow Desktop', CompanyName: '清枢智汇 · TsingShu.AI' },
  });
  const files = [], directories = [];
  async function walk(relative = '') {
    for (const entry of await fs.readdir(path.join(context.appOutDir, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) { directories.push(name); await walk(name); }
      else files.push(name);
    }
  }
  await walk();
  const escape = name => name.replaceAll('$', '$$').replaceAll('"', '$\\"');
  const lines = files.map(name => `Delete "$INSTDIR\\${escape(name)}"`);
  directories.sort((a, b) => b.length - a.length).forEach(name => lines.push(`RMDir "$INSTDIR\\${escape(name)}"`));
  await fs.writeFile(path.join(context.appOutDir, '..', 'uninstall-files.nsh'), lines.join('\n') + '\n');
};
