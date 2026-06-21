const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

const timestamp = () => new Date().toISOString();

const logger = {
  info: (msg) => console.log(`${colors.green}[INFO]${colors.reset} ${timestamp()} ${msg}`),
  warn: (msg) => console.warn(`${colors.yellow}[WARN]${colors.reset} ${timestamp()} ${msg}`),
  error: (msg) => console.error(`${colors.red}[ERROR]${colors.reset} ${timestamp()} ${msg}`),
  debug: (msg) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`${colors.blue}[DEBUG]${colors.reset} ${timestamp()} ${msg}`);
    }
  },
};

module.exports = { logger };
