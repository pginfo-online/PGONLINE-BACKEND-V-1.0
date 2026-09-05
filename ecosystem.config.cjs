module.exports = {
  apps: [
    {
      name: "pginfo-backend",
      script: "./server.js",
      instances: process.env.PM2_INSTANCES || "max",
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "500M",
      wait_ready: true,
      listen_timeout: 30000,
      kill_timeout: 5000,
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "development",
        PORT: 5001,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5001,
      },
    },
  ],
};
