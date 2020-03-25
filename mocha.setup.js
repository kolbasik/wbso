// @ts-nocheck
require("ts-node").register()
const { performance } = require("perf_hooks")
Object.assign(global, { window: global, performance })