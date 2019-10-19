#!/usr/bin/env node

/* eslint eqeqeq: 0 */
const config = require('config')
const apiSchemaCache = require('api-schema-cache')
const apiHandler = require('./index')

apiHandler.initApp().then((app) => {
  const NODE_NAME = process.env['NODE_NAME'] || 'scirichon-node'
  app.server.listen(config.get(`${NODE_NAME}.port`), async function () {
    if (process.env['INIT_CACHE'] == 1) {
      await apiSchemaCache.loadAll()
    }
  })
}).catch(err => console.log(err.stack || err))
