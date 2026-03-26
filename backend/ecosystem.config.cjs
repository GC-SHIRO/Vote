module.exports = {
  apps: [
    {
      name: "vote-api",
      script: "src/server.js",
      cwd: "/srv/vote/api/current",
      instances: 1,
      exec_mode: "fork",
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
