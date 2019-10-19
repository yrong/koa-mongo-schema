/* eslint camelcase: 0 */
const config = require('config')
const apiSchema = require('api-schema-core')
const apiSchemaSearch = require('api-schema-search')
const hooks = require('../hooks')
const compose = require('koa-compose')
const Router = require('koa-router')
const requestHandler = hooks.requestHandler
const createProcedure = require('../hooks/procedure').createProcedure

const handleRequest = async (ctx) => {
  let params = { ...{}, ...ctx.query, ...ctx.params, ...ctx.request.body }
  let procedure = createProcedure({
    check: hooks.check,
    preProcess: hooks.cudItem_preProcess,
    dbProcess: hooks.dbProcess,
    postProcess: hooks.cudItem_postProcess,
    route: ctx.path,
    timeout: config.get('timeout')
  })
  let result = await procedure(params, ctx)
  ctx.body = result
}

const handleQuery = async (ctx) => {
  let params = { ...{}, ...ctx.query, ...ctx.params, ...ctx.request.body }; let colname; let result
  params = await hooks.queryItems_preProcess(params, ctx)
  colname = requestHandler.getCollectionByCategory(params.category)
  if (params.uuid) {
    result = await ctx.db.collection(colname).findOne({ uuid: params.uuid })
  } else {
    if (params.pagination) {
      result = await ctx.db.collection(colname).find({}).sort(params.sort).limit(params.limit).skip(params.skip).toArray()
    } else {
      result = await ctx.db.collection(colname).find({}).sort(params.sort).toArray()
    }
  }
  result = await hooks.queryItems_postProcess(result, params, ctx)
  ctx.body = result || {}
}

module.exports = (app) => {
  let routesDef = apiSchema.getApiRouteSchemas()

  let allowed_methods = ['Add', 'Modify', 'Delete', 'FindOne', 'FindAll']

  let router = app.router = new Router()

  /* common route */
  routesDef.forEach((val) => {
    if (val.service === process.env['NODE_NAME']) {
      allowed_methods.forEach((method) => {
        switch (method) {
          case 'Add':
            router.post(val.route, handleRequest)
            break
          case 'Modify':
            router.put(val.route + '/:uuid', handleRequest)
            break
          case 'Delete':
            router.del(val.route + '/:uuid', handleRequest)
            break
          case 'FindOne':
            router.get(val.route + '/:uuid', handleQuery)
            break
          case 'FindAll':
            router.get(val.route, handleQuery)
            break
        }
      })
    }
  })

  router.del('/hidden/clean', async (ctx) => {
    await hooks.clean(ctx)
    ctx.body = {}
  })

  router.post('/api/searchByEql', async (ctx) => {
    let params = { ...{}, ...ctx.query, ...ctx.params, ...ctx.request.body }
    params = await requestHandler.assignFields4Query(params, ctx)
    let result = await apiSchemaSearch.searchItem(params, ctx)
    ctx.body = result
  })

  router.post('/api/searchByMql', async (ctx) => {
    let params = { ...{}, ...ctx.query, ...ctx.params, ...ctx.request.body }; let result
    params = await requestHandler.assignFields4Query(params, ctx)
    let colname = requestHandler.getCollectionByCategory(params.category)
    if (params.pagination) {
      result = await ctx.db.collection(colname).find(params.body || {}).sort(params.sort).limit(params.limit).skip(params.skip).toArray()
    } else {
      result = await ctx.db.collection(colname).find(params.body || {}).sort(params.sort).toArray()
    }
    result = await hooks.queryItems_postProcess(result, params, ctx)
    ctx.body = result || {}
  })

  app.use(compose(
    [
      router.routes(),
      router.allowedMethods()
    ]))

  return app
}
