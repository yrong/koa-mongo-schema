/* eslint camelcase: 0 */
const config = require('config')
const schema = require('scirichon-json-schema')
const es_config = config.get('elasticsearch')
const search = require('scirichon-search')
const hooks = require('../hooks')
const compose = require('koa-compose')
const Router = require('koa-router')
const requestHandler = hooks.requestHandler

const schema_checker = (params) => {
  schema.checkObject(params.data.category, params.data.fields)
  return params
}

const handleRequest = async (ctx) => {
  let params = { ...{}, ...ctx.query, ...ctx.params, ...ctx.request.body }
  if (ctx.method === 'POST') {
    await schema_checker(params)
  }
  if (es_config.mode === 'strict') {
    await search.checkStatus()
  }
  params = await hooks.cudItem_preProcess(params, ctx)
  let colname = requestHandler.getCollectionByCategory(params.category)
  let result
  if (colname) {
    if (ctx.method === 'POST') {
      result = await ctx.db.collection(colname).insert(params.fields)
    } else if (ctx.method === 'PUT') {
      result = await ctx.db.collection(colname).updateOne({ uuid: params.uuid }, { $set: params.change })
    } else if (ctx.method === 'DELETE') {
      result = await ctx.db.collection(colname).deleteOne({ uuid: params.uuid })
    }
  }
  if (params.fields && params.fields['_id']) {
    delete params.fields['_id']
  }
  result = await hooks.cudItem_postProcess(result, params, ctx)
  return result
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
  return result || {}
}

module.exports = (app) => {
  let routesDef = schema.getApiRouteSchemas()

  let allowed_methods = ['Add', 'Modify', 'Delete', 'FindOne', 'FindAll']

  let router = app.router = new Router()

  /* common route */
  routesDef.forEach((val) => {
    if (val.service === process.env['NODE_NAME']) {
      allowed_methods.forEach((method) => {
        switch (method) {
          case 'Add':
            router.post(val.route, async (ctx, next) => {
              ctx.body = await handleRequest(ctx)
            })
            break
          case 'Modify':
            router.put(val.route + '/:uuid', async (ctx, next) => {
              ctx.body = await handleRequest(ctx)
            })
            break
          case 'Delete':
            router.del(val.route + '/:uuid', async (ctx, next) => {
              ctx.body = await handleRequest(ctx)
            })
            break
          case 'FindOne':
            router.get(val.route + '/:uuid', async (ctx, next) => {
              ctx.body = await handleQuery(ctx)
            })
            break
          case 'FindAll':
            router.get(val.route, async (ctx, next) => {
              ctx.body = await handleQuery(ctx)
            })
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
    let result = await search.searchItem(params, ctx)
    ctx.body = result
  })

  router.post('/api/searchByMql', async (ctx) => {
    let params = { ...{}, ...ctx.query, ...ctx.params, ...ctx.request.body },result
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
