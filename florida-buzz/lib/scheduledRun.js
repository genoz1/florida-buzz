const childProcess = require('child_process');

function createScheduledRunner({ cwd, exec = childProcess.exec, logger = console } = {}) {
  const activeRuns = new Set();

  function runScheduledCommand(name, command) {
    if (activeRuns.has(name)) {
      logger.warn(`[schedule] Skipping overlapping ${name} run; the previous run is still active.`);
      return false;
    }
    activeRuns.add(name);
    exec(command, { cwd }, (err, stdout, stderr) => {
      try {
        if (stdout) logger.log(stdout);
        if (stderr) logger.error(stderr);
        if (err) logger.error(`[schedule] ${name} exited with an error: ${err.message}`);
      } finally {
        activeRuns.delete(name);
      }
    });
    return true;
  }

  return { runScheduledCommand, activeRuns };
}

module.exports = { createScheduledRunner };
