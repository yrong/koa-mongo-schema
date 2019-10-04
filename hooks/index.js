/* eslint camelcase: 0 */
const common = require('scirichon-common')
const schema = require('scirichon-json-schema')
const ScirichonWarning = common.ScirichonWarning
const ScirichonError = common.ScirichonError
const logger = require('log4js-wrapper-advanced').getLogger()
const responseHandler = require('scirichon-response-mapper')
const requestHandler = require('./requestHandler')
const requestPostHandler = require('./requestPostHandler')
const cache = require('scirichon-cache')
const search = require('scirichon-search')
const config = require('config')

module.exports = {
  requestHandler,
  requestPostHandler,
  setHandlers: function (handlers) {
    global._scirichonHandlers = handlers
  },
  getHandlers: function () {
    return global._scirichonHandlers || {}
  },
  cudItem_preProcess: async function (params, ctx) {
    logger.trace(`before preprocess:\n` + JSON.stringify(params, null, 2))
    params = await requestHandler.handleRequest(params, ctx)
    let customizedHandler = global._scirichonHandlers && global._scirichonHandlers[params.category]
    if (customizedHandler) {
      if (params.procedure && params.procedure.ignoreCustomizedHandler) {
      } else {
        params = await customizedHandler.preProcess(params, ctx)
      }
    }
    logger.trace(`after preprocess:\n` + JSON.stringify(params, null, 2))
    return params
  },
  cudItem_postProcess: async function (result, params, ctx) {
    logger.trace(`before postprocess:\n` + JSON.stringify(params, null, 2))
    let customizedHandler = global._scirichonHandlers && global._scirichonHandlers[params.category]
    if (customizedHandler) {
      if (params.procedure && params.procedure.ignoreCustomizedHandler) {
      } else {
        params = await customizedHandler.postProcess(params, ctx)
      }
    }
    if (ctx.batch === true) {
      return params
    } else {
      try {
        logger.trace(`before es operation`)
        await requestPostHandler.updateSearch(params, ctx)
        logger.trace(`after es operation`)
      } catch (e) {
        logger.error(e.stack || e)
        if (config.get('globalTransaction')) {
          throw new ScirichonError(String(e))
        } else {
          throw new ScirichonWarning(String(e))
        }
      } try {
        logger.trace(`before cache operation`)
        await Promise.all([requestPostHandler.updateCache(params, ctx), requestPostHandler.addNotification(params, ctx)])
        logger.trace(`after cache operation`)
      } catch (e) {
        logger.error(e.stack || e)
      }
      logger.trace(`after postprocess:\n` + JSON.stringify(params, null, 2))
      return { uuid: params.uuid } || {}
    }
  },
  queryItems_preProcess: async function (params, ctx) {
    params = await requestHandler.handleRequest(params, ctx)
    return params
  },
  queryItems_postProcess: async function (result, params, ctx) {
    if (params.uuid) {
      if (result) {
        result = await responseHandler.responseMapper(result, params, ctx)
      }
    } else {
      if (params.pagination) {
        result = result && result.length ? result[0] : undefined
        if (result && result.results) { result.results = await responseHandler.responseMapper(result.results, params, ctx) }
      } else {
        result = await responseHandler.responseMapper(result, params, ctx)
      }
    }
    return result
  },
  clean: async function (ctx) {
    await cache.flushAll()
    let route_schemas = schema.getApiRouteSchemas()
    for (let route_schema of route_schemas) {
      if (route_schema.service === process.env['NODE_NAME']) {
        if (route_schema.collection) {
          await ctx.db.collection(route_schema.collection).deleteMany({})
        }
        if (route_schema.search && route_schema.search.index) {
          await search.deleteAll(route_schema.search.index)
        }
      }
    }
    return {}
  },
  getLicense: async function (params, ctx) {
    return (ctx.state && ctx.state.license) || {}
  }
}
