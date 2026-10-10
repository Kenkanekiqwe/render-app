process.env.RENDER_DESKTOP = '1';
process.env.RENDER_SILENT = '1';
process.env.PORT = process.env.PORT || '5000';

const path = require('path');

if (process.pkg) {
  process.chdir(path.dirname(process.execPath));
}

require('../server/index.js').startServer();
