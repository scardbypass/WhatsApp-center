module.exports = {
  apps: [{
    name: "wa-center",
    script: "./server.js",
    env: {
      NODE_ENV: "production"
    },
    max_memory_restart: "1500M",
    time: true
  }]
};
