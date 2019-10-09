/* eslint camelcase: 0 */
const schema = require('scirichon-json-schema')
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
  check: async (params, ctx) => {
    if (ctx.method === 'POST') {
      schema.checkObject(params.data.category, params.data.fields)
    }
    if (config.get('elasticsearch').mode === 'strict') {
      await search.checkStatus()
    }
    return params
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
  dbProcess: async (params, ctx) => {
    let colname = requestHandler.getCollectionByCategory(params.category)
    if (!colname) {
      throw new ScirichonError(`no mongo collection found for category ${params.category}`)
    }
    const collections = await ctx.db.collections()
    const colnames = collections.map(c => c.s.namespace.collection)
    if (!colnames.includes(colname)) {
      await ctx.db.createCollection(colname)
    }
    let result
    if (ctx.method === 'POST') {
      result = await ctx.db.collection(colname).insertOne(params.fields, { session:ctx.session })
    } else if (ctx.method === 'PUT') {
      result = await ctx.db.collection(colname).updateOne({ uuid: params.uuid }, { $set: params.change }, { session:ctx.session })
    } else if (ctx.method === 'DELETE') {
      result = await ctx.db.collection(colname).deleteOne({ uuid: params.uuid }, { session:ctx.session })
    }
    if (params.fields && params.fields['_id']) {
      delete params.fields['_id']
    }
    return result
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
    if (ctx.batch !== true) {
      await requestPostHandler.updateSearch(params, ctx)
      await Promise.all([requestPostHandler.updateCache(params, ctx), requestPostHandler.addNotification(params, ctx)])
    }
    logger.trace(`after postprocess:\n` + JSON.stringify(params, null, 2))
    return params
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
  }
}
