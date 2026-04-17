module.exports = {
  apps: [
    {
      name: "vote-api",
      script: "src/server.js",
      cwd: "/home/Vote/backend",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production"
      },
      error_file: "/srv/vote/logs/api/error.log",
      out_file: "/srv/vote/logs/api/out.log",
      merge_logs: true,
      time: true,
      max_memory_restart: "300M"
    }
  ]
};
