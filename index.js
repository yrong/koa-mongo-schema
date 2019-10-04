/* eslint camelcase: 0 */

const config = require('config')
const path = require('path')
const log4js_wrapper = require('log4js-wrapper-advanced')
const scirichonSchema = require('scirichon-json-schema')
const scirichonCache = require('scirichon-cache')
const hooks = require('./hooks')
const route = require('./route')
const middleware = require('./middleware')
const http = require('http')
const Koa = require('koa')

const initApp = async () => {
  /**
     * init logger
     */
  log4js_wrapper.initialize(Object.assign({}, config.get('logger')))

  /**
     * load middleware
     */
  const app = new Koa()
  const middlewares = require(path.resolve('./middlewares'))
  middlewares.load(app)

  /**
     * load schema
     */
  const schema_option = { redisOption: config.get('redis'), prefix: process.env['SCHEMA_TYPE'] || 'scirichon-schema' }
  await scirichonSchema.initSchemas(schema_option)
  await scirichonCache.initialize(schema_option)

  /**
   * load route
   */
  const routes = require(path.resolve('./routes'))
  routes.load(app)
  app.server = http.createServer(app.callback())
  return app
}

module.exports = { hooks, route, middleware, initApp }
