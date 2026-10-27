const fs = require('node:fs');
const path = require('node:path');
const { NotificationError } = require('./client');

class Store {
  constructor(filename, binding) {
    this.filename = filename;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (this.data.version !== 1 || JSON.stringify(this.data.binding) !== JSON.stringify(binding)) {
        throw new Error('Invalid state binding');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new NotificationError('Translator notification state could not be read; refusing to discard pending notices.');
      this.data = { version: 1, binding, baselineId: null, cursorAt: null, seen: {}, pending: {},
        quietUntil: 0, outbox: null, delivered: {}, lastPoll: 0 };
    }
  }

  save(value = this.data) {
    const temporary = this.filename + '.tmp';
    const fd = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, this.filename);
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(this.filename), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
    this.data = value;
  }
}

module.exports = { Store };
