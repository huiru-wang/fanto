const path = require("node:path");

const root = __dirname;

module.exports = {
  apps: [
    {
      name: "fanto-server",
      cwd: path.join(root, "apps/server"),
      script: "src/bootstrap/main.ts",
      interpreter: "node",
      node_args: "--env-file=.env --import tsx",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      exp_backoff_restart_delay: 1000,
      min_uptime: "1s",
      max_restarts: 20,
      max_memory_restart: "512M",
      kill_timeout: 15000,
      listen_timeout: 10000,
      out_file: path.join(root, "logs/server.log"),
      error_file: path.join(root, "logs/server-error.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
